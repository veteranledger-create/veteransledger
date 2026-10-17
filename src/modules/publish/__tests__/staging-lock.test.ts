import fs from "fs";
import os from "os";
import path from "path";
import { KeyedAsyncLock, stagingLock, publicationLock, AsyncLock } from "../publication-lock";
import {
  beginStagingRun,
  completeStagingRun,
  readStagingProvenance,
  assertStagingPromotable,
  fingerprintOutput,
  fingerprintSource,
  provenancePath,
  SourceFingerprint,
  StagingProvenanceError,
} from "../staging-provenance";
import { writeStagedFilesAtomically } from "../atomic-stage-writer";

/**
 * M-2 — two publish runs of the same type must not interleave.
 *
 * A run is a read-modify-write across two artefacts: invalidate the
 * provenance record, replace the staging directory, record completion.
 * Unserialised, the orders that end with one run's directory beside
 * another run's record are reachable. The provenance gate refuses that
 * mismatch — so nothing unsafe was ever promotable — but the type is left
 * stranded in a refusing state until it is published again.
 *
 * The control below runs the same two publishes unlocked and shows the
 * strand actually happens; without it, the locked test would pass against
 * a hazard that never fired.
 *
 * Interleaving is driven by explicit barriers, not timing, so a pass is a
 * property rather than a coincidence. Everything runs in throwaway
 * directories: no real publish, no promotion, no database.
 */

const TYPE = "awards";

let tmp: string;
let stagingRoot: string;
let typeDir: string;
let openBarriers: Array<() => void>;

const SOURCE: SourceFingerprint = fingerprintSource("database", [["rec-a", "v1"]]);

const barrier = (): { wait: Promise<void>; open: () => void } => {
  let open!: () => void;
  const wait = new Promise<void>((resolve) => { open = resolve; });
  openBarriers.push(open);
  return { wait, open };
};

const settle = async (): Promise<void> => {
  for (let i = 0; i < 8; i++) await new Promise((r) => setImmediate(r));
};

/**
 * Waits for a condition rather than for a fixed number of ticks.
 *
 * The provenance write is real I/O — open, write, fsync, rename, directory
 * sync — and does not reliably complete within a fixed tick budget. Polling
 * the actual condition keeps these tests about ordering rather than about
 * how long a filesystem takes.
 */
const waitFor = async (what: string, predicate: () => boolean): Promise<void> => {
  for (let i = 0; i < 200; i++) {
    if (predicate()) return;
    await new Promise((r) => setImmediate(r));
  }
  throw new Error(`timed out waiting for: ${what}`);
};

const file = (): string => provenancePath(stagingRoot, TYPE);
const onDisk = (): string[] => (fs.existsSync(typeDir) ? fs.readdirSync(typeDir).sort() : []);

/**
 * One publish run's staging lifecycle, using the real writer and the real
 * provenance calls in the real order, with an optional pause between
 * invalidation and directory replacement — the window where interleaving
 * does its damage.
 */
async function stagingRun(
  runId: string,
  files: Map<string, string>,
  opts: { pauseBeforeWrite?: Promise<void>; failWrite?: boolean } = {},
): Promise<void> {
  const startedAt = new Date().toISOString();
  await beginStagingRun(file(), { type: TYPE, runId, source: SOURCE, startedAt });
  if (opts.pauseBeforeWrite) await opts.pauseBeforeWrite;
  if (opts.failWrite) throw new Error(`publish ${runId} failed to write staged output`);
  await writeStagedFilesAtomically(typeDir, files);
  await completeStagingRun(file(), {
    type: TYPE, runId, source: SOURCE, startedAt, intendedFiles: fingerprintOutput(files),
  });
}

const promotable = (): Promise<unknown> =>
  assertStagingPromotable({
    type: TYPE,
    provenanceFile: file(),
    staged: new Map(onDisk().map((n) => [n, fs.readFileSync(path.join(typeDir, n), "utf-8")])),
    recomputeSource: async () => SOURCE,
  });

const refusal = async (p: Promise<unknown>): Promise<StagingProvenanceError> =>
  p.then(() => { throw new Error("expected a refusal"); }, (e: unknown) => e as StagingProvenanceError);

beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "vl-staging-lock-"));
  stagingRoot = path.join(tmp, "publish-staging");
  typeDir = path.join(stagingRoot, TYPE);
  fs.mkdirSync(typeDir, { recursive: true });
  openBarriers = [];
});
afterEach(async () => {
  for (const open of openBarriers) open();
  await settle();
  fs.rmSync(tmp, { recursive: true, force: true });
});

describe("KeyedAsyncLock", () => {
  it("serialises the same key and never overlaps", async () => {
    const lock = new KeyedAsyncLock();
    let concurrent = 0;
    let peak = 0;
    const task = () => lock.run("a", async () => {
      concurrent++;
      peak = Math.max(peak, concurrent);
      await settle();
      concurrent--;
    });

    await Promise.all([task(), task(), task()]);
    expect(peak).toBe(1);
  });

  it("admits same-key callers in call order", async () => {
    const lock = new KeyedAsyncLock();
    const entered: string[] = [];
    const gates = { a: barrier(), b: barrier(), c: barrier() };
    const task = (n: "a" | "b" | "c") =>
      lock.run("k", async () => { entered.push(n); await gates[n].wait; });

    const all = Promise.all([task("a"), task("b"), task("c")]);
    await settle();
    expect(entered).toEqual(["a"]);
    gates.a.open(); await settle();
    expect(entered).toEqual(["a", "b"]);
    gates.b.open(); await settle();
    expect(entered).toEqual(["a", "b", "c"]);
    gates.c.open();
    await all;
  });

  it("does NOT serialise different keys", async () => {
    // Requirement 3: a campaigns publish must not wait on an armaments one.
    const lock = new KeyedAsyncLock();
    const held = barrier();
    let otherRan = false;

    const blocking = lock.run("armaments", async () => { await held.wait; });
    await settle();
    expect(lock.held("armaments")).toBe(true);

    await lock.run("campaigns", async () => { otherRan = true; });
    expect(otherRan).toBe(true);        // ran while armaments was held
    expect(lock.held("armaments")).toBe(true);

    held.open();
    await blocking;
  });

  it("releases on rejection and does not poison the key", async () => {
    const lock = new KeyedAsyncLock();
    await expect(lock.run("k", async () => { throw new Error("boom"); })).rejects.toThrow("boom");
    expect(lock.held("k")).toBe(false);
    await expect(lock.run("k", async () => "after")).resolves.toBe("after");
  });

  it("releases on a synchronous throw", async () => {
    const lock = new KeyedAsyncLock();
    await expect(lock.run("k", (() => { throw new Error("sync"); }) as () => Promise<never>))
      .rejects.toThrow("sync");
    expect(lock.held("k")).toBe(false);
  });

  it("reuses one lock instance per key", async () => {
    // Recreating a lock for a key that fell idle would serialise two callers
    // against different instances.
    const lock = new KeyedAsyncLock();
    await lock.run("k", async () => undefined);
    const gate = barrier();
    const first = lock.run("k", async () => { await gate.wait; });
    await settle();
    let secondStarted = false;
    const second = lock.run("k", async () => { secondStarted = true; });
    await settle();
    expect(secondStarted).toBe(false);   // queued behind the same instance
    gate.open();
    await Promise.all([first, second]);
  });

  it("reports active keys", async () => {
    const lock = new KeyedAsyncLock();
    const gate = barrier();
    const running = lock.run("armaments", async () => { await gate.wait; });
    await settle();
    expect(lock.activeKeys).toEqual(["armaments"]);
    gate.open();
    await running;
    expect(lock.activeKeys).toEqual([]);
  });
});

describe("two same-type publish runs cannot interleave", () => {
  const A = new Map([["a-one.json", "A1"], ["a-two.json", "A2"]]);
  const B = new Map([["b-only.json", "B1"]]);

  it("CONTROL: unserialised, the directory and the record end up from different runs", async () => {
    // The hazard, reproduced. Run A pauses after invalidating; B completes
    // fully; A then writes its directory and records its own completion.
    const pause = barrier();
    const a = stagingRun("run-A", A, { pauseBeforeWrite: pause.wait });
    await settle();

    await stagingRun("run-B", B);          // B completes end to end
    expect(onDisk()).toEqual(["b-only.json"]);
    expect((await readStagingProvenance(file(), TYPE)).runId).toBe("run-B");

    pause.open();
    await a;

    // A overwrote both, so this particular order self-heals — but the
    // record and directory were transiently from different runs, and the
    // order below shows the version that does not heal.
    expect(onDisk()).toEqual(["a-one.json", "a-two.json"]);
    expect((await readStagingProvenance(file(), TYPE)).runId).toBe("run-A");
  });

  it("CONTROL: unserialised, a run that dies mid-flight strands the type", async () => {
    const pause = barrier();
    // A invalidates, then stalls forever (a crashed request).
    void beginStagingRun(file(), { type: TYPE, runId: "run-A", source: SOURCE });
    await settle();

    // B now runs to completion against a record A already invalidated.
    await stagingRun("run-B", B);
    // B's own completion lands, so this order is fine...
    await expect(promotable()).resolves.toBeDefined();

    // ...but reverse it: B completes, then A's late invalidation lands.
    await beginStagingRun(file(), { type: TYPE, runId: "run-A", source: SOURCE });
    const err = await refusal(promotable());
    expect(err.reason).toBe("incomplete");
    expect(err.message).toContain("run-A");
    // The directory is B's, perfectly good, and now unpromotable.
    expect(onDisk()).toEqual(["b-only.json"]);
    pause.open();
  });

  it("serialised, the second run waits and the pair stays consistent", async () => {
    const lock = new KeyedAsyncLock();
    const pause = barrier();

    let bStarted = false;
    const a = lock.run(TYPE, () => stagingRun("run-A", A, { pauseBeforeWrite: pause.wait }));
    // Wait for A to actually reach its pause, i.e. its invalidation landed.
    await waitFor("run-A to invalidate the record", () => fs.existsSync(file()));

    const b = lock.run(TYPE, async () => { bStarted = true; await stagingRun("run-B", B); });
    await settle();

    // B has not begun: it cannot have invalidated A's record or touched the
    // directory while A is mid-run.
    expect(bStarted).toBe(false);
    expect(onDisk()).toEqual([]);                       // A has not written yet
    expect((await readStagingProvenance(file(), TYPE).catch((e: unknown) => e)))
      .toMatchObject({ reason: "incomplete" });         // A's own in-flight record

    pause.open();
    await Promise.all([a, b]);

    // One winner, consistent end to end.
    const record = await readStagingProvenance(file(), TYPE);
    expect(record.runId).toBe("run-B");
    expect(onDisk()).toEqual(["b-only.json"]);
    expect(Object.keys(record.intendedFiles).sort()).toEqual(["b-only.json"]);
    await expect(promotable()).resolves.toBeDefined();
  });

  it("serialised, neither run observes the other's intermediate state", async () => {
    const lock = new KeyedAsyncLock();
    const observations: string[] = [];

    const observe = (tag: string): void => {
      const record = fs.existsSync(file())
        ? (JSON.parse(fs.readFileSync(file(), "utf-8")) as { runId: string; complete: boolean })
        : null;
      observations.push(`${tag}:${record ? `${record.runId}/${record.complete}` : "none"}:${onDisk().join(",")}`);
    };

    const run = (id: string, files: Map<string, string>) =>
      lock.run(TYPE, async () => {
        observe(`${id}-enter`);
        await stagingRun(id, files);
        observe(`${id}-exit`);
      });

    await Promise.all([run("run-A", A), run("run-B", B)]);

    // Each run entered with the previous one's completed state, never a
    // half-finished one.
    expect(observations).toEqual([
      "run-A-enter:none:",
      "run-A-exit:run-A/true:a-one.json,a-two.json",
      "run-B-enter:run-A/true:a-one.json,a-two.json",
      "run-B-exit:run-B/true:b-only.json",
    ]);
  });

  it("ten concurrent runs leave exactly one consistent winner", async () => {
    const lock = new KeyedAsyncLock();
    await Promise.all(
      Array.from({ length: 10 }, (_u, i) =>
        lock.run(TYPE, () => stagingRun(`run-${i}`, new Map([[`file-${i}.json`, `C${i}`]]))),
      ),
    );

    const record = await readStagingProvenance(file(), TYPE);
    expect(onDisk()).toEqual([`file-${record.runId.split("-")[1]}.json`]);
    expect(Object.keys(record.intendedFiles)).toEqual(onDisk());
    await expect(promotable()).resolves.toBeDefined();
  });
});

describe("a failed first run leaves the second able to proceed", () => {
  const A = new Map([["a-one.json", "A1"]]);
  const B = new Map([["b-only.json", "B1"]]);

  it("the failure refuses, and the next run repairs the type", async () => {
    const lock = new KeyedAsyncLock();

    await expect(lock.run(TYPE, () => stagingRun("run-A", A, { failWrite: true })))
      .rejects.toThrow("publish run-A failed");

    // Fails closed: A invalidated the record and never completed.
    expect(lock.held(TYPE)).toBe(false);
    const err = await refusal(promotable());
    expect(err.reason).toBe("incomplete");
    expect(err.message).toContain("run-A");

    // And the lock is free, so the next run proceeds normally.
    await lock.run(TYPE, () => stagingRun("run-B", B));
    const record = await readStagingProvenance(file(), TYPE);
    expect(record.runId).toBe("run-B");
    expect(record.complete).toBe(true);
    expect(onDisk()).toEqual(["b-only.json"]);
    await expect(promotable()).resolves.toBeDefined();
  });

  it("a queued run starts only after the failing one has released", async () => {
    const lock = new KeyedAsyncLock();
    const pause = barrier();
    const order: string[] = [];

    const failing = lock.run(TYPE, async () => {
      order.push("A-enter");
      await pause.wait;
      order.push("A-fail");
      throw new Error("A exploded");
    }).catch(() => order.push("A-rejected"));

    const queued = lock.run(TYPE, async () => { order.push("B-enter"); });

    await settle();
    expect(order).toEqual(["A-enter"]);

    pause.open();
    await Promise.all([failing, queued]);

    // B enters only after A's section has finished executing. It enters
    // before A's caller observes the rejection, because the lock is
    // released in a finally — promptly, rather than waiting on whatever the
    // caller does with the error. That ordering is the desirable one.
    expect(order.indexOf("B-enter")).toBeGreaterThan(order.indexOf("A-fail"));
    expect(order.slice(0, 2)).toEqual(["A-enter", "A-fail"]);
    expect(order).toContain("A-rejected");
  });
});

describe("lock ordering cannot deadlock", () => {
  const publishSource = fs.readFileSync(path.resolve(__dirname, "../publish.service.ts"), "utf-8");
  const promotionSource = fs.readFileSync(path.resolve(__dirname, "../promotion.service.ts"), "utf-8");
  const siteContentSource = fs.readFileSync(
    path.resolve(__dirname, "../../site-content/site-content.service.ts"), "utf-8",
  );

  it("no module takes both locks, so no cycle exists", () => {
    // Deadlock needs someone holding two locks. Nobody does.
    expect(publishSource).toContain("stagingLock.run(type,");
    expect(publishSource).not.toContain("publicationLock");

    expect(promotionSource).toContain("publicationLock.run(");
    expect(promotionSource).not.toContain("stagingLock");

    expect(siteContentSource).toContain("publicationLock.run(fn)");
    expect(siteContentSource).not.toContain("stagingLock");
  });

  it("the two locks are genuinely independent objects", async () => {
    const gate = barrier();
    const holding = stagingLock.run("armaments", async () => { await gate.wait; });
    await settle();
    expect(stagingLock.held("armaments")).toBe(true);

    // The global lock is unaffected by a staging lock being held.
    let ran = false;
    await publicationLock.run(async () => { ran = true; });
    expect(ran).toBe(true);

    gate.open();
    await holding;
    expect(stagingLock.held("armaments")).toBe(false);
  });

  it("promotion deliberately does not take the staging lock", () => {
    // It reads staging, but a publish invalidates the record before touching
    // the directory and promotion reads the directory before the record, so
    // catching a replace mid-flight necessarily refuses. Taking both locks
    // to tidy that up is exactly what would create a cycle.
    const body = promotionSource.slice(
      promotionSource.indexOf("private async promoteLocked("),
      promotionSource.indexOf("private async rollbackLocked("),
    );
    expect(body).toContain("listFilesRecursive(stagingDir(type))");
    expect(body).toContain("assertStagingPromotable");
    expect(body.indexOf("listFilesRecursive(stagingDir(type))"))
      .toBeLessThan(body.indexOf("assertStagingPromotable"));
    expect(body).not.toContain("stagingLock");
  });

  it("sourceFingerprint stays outside the lock, so promotion cannot block on a publish", () => {
    const method = publishSource.slice(
      publishSource.indexOf("async sourceFingerprint("),
      publishSource.indexOf("private async loadSourceRows("),
    );
    expect(method).not.toContain("stagingLock");
  });

  it("the shared lock instance is the one publish uses", () => {
    expect(stagingLock).toBeInstanceOf(KeyedAsyncLock);
    expect(publicationLock).toBeInstanceOf(AsyncLock);
    expect(stagingLock as unknown).not.toBe(publicationLock as unknown);
  });
});

describe("publish routes through the lock", () => {
  const source = fs.readFileSync(path.resolve(__dirname, "../publish.service.ts"), "utf-8");

  it("wraps the whole staging lifecycle, not a part of it", () => {
    expect(source).toContain("return stagingLock.run(type, () => this.runLocked(type, userId));");
    expect(source).toContain("private async runLocked(");
    // Called exactly once — from inside the lock.
    expect(source.match(/this\.runLocked\(/g)).toHaveLength(1);

    const locked = source.slice(
      source.indexOf("private async runLocked("),
      source.indexOf("}\n}"),
    );
    for (const step of [
      "await this.sourceFingerprint(type)", "beginStagingRun",
      "writeStagedFilesAtomically", "completeStagingRun",
    ]) {
      expect(locked).toContain(step);
    }
  });

  it("validates the type before queueing, so a bad type fails fast", () => {
    const run = source.slice(source.indexOf("async run(type: string"), source.indexOf("private async runLocked("));
    expect(run.indexOf("this.assertSupported(type)")).toBeLessThan(run.indexOf("stagingLock.run"));
  });
});
