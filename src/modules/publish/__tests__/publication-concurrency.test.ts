import fs from "fs";
import fsp from "fs/promises";
import os from "os";
import path from "path";
import { AsyncLock, publicationLock } from "../publication-lock";
import { createVersionStore, VersionStore, MIN_RETAINED_PRIOR } from "../version-store";
import { applyFileChangesAtomically, restoreFromSnapshot, PromotionSnapshot } from "../promote-atomic";
import { regenerateIndex } from "../index-schema";
import { completeAfterActivation } from "../promotion.service";
import { SiteContentService } from "../../site-content/site-content.service";
import { createRevisionStore } from "../../editorial-history/revision-store";
import { AppError } from "../../../middleware/error.middleware";

/**
 * R3a and R3b — concurrent publication, and what a non-versioned one costs.
 *
 * What these tests are, stated plainly: promote() and rollback() cannot be
 * executed here, because PROMOTION_ENABLED is false and flipping it to make a
 * test pass would be the opposite of what it is for. So each case drives the
 * *real* units a publication is built from — the real version store, the real
 * atomic apply, the real index regenerator, the real editorial service, and
 * the one real publicationLock the service itself uses — through the same
 * sequence, in the same order, that the critical section performs. That the
 * methods actually enter that lock is asserted separately against the source,
 * which is the established pattern in this suite for a boundary a disabled
 * pipeline puts out of reach.
 *
 * Every race is driven by explicit gates rather than by timing, so a pass is
 * a property and not a coincidence. Where the fix is the whole point, the
 * unlocked path is run as a control, so a test that would pass either way is
 * not mistaken for proof.
 *
 * Nothing here touches public/data, the version store on disk, or the
 * database.
 */

let tmp: string;
let src: string;
let store: VersionStore;
/** Gates opened in afterEach, so a failed assertion cannot wedge the lock. */
let openGates: Array<() => void>;

const deferred = (): { promise: Promise<void>; open: () => void } => {
  let open!: () => void;
  const promise = new Promise<void>((resolve) => { open = resolve; });
  openGates.push(open);
  return { promise, open };
};

const tick = async (n = 1): Promise<void> => {
  for (let i = 0; i < n; i++) await Promise.resolve();
};

/** Settles pending filesystem work without depending on a wall-clock delay. */
const settle = async (): Promise<void> => {
  for (let i = 0; i < 8; i++) await new Promise((r) => setImmediate(r));
};

const writeFile = (rel: string, content: string): void => {
  const p = path.join(src, rel);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, content, "utf-8");
};

beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "vl-pub-conc-"));
  src = path.join(tmp, "public-data");
  fs.mkdirSync(src, { recursive: true });
  store = createVersionStore(path.join(tmp, "published"));
  openGates = [];
});

afterEach(async () => {
  for (const open of openGates) open();
  await settle();
  fs.rmSync(tmp, { recursive: true, force: true });
});

// ── a model of one promotion's critical section ───────────────
//
// Applies this type's files and then captures the whole tree, which is what
// promote() does: content first, version second. The pause is the window a
// second operation could observe, made explicit instead of hoped for.

interface Capture { files: (gen: string) => Map<string, string>; }

const FILES: Record<string, Capture> = {
  armaments: { files: (gen) => new Map([
    ["armaments/naval.json", `${gen}`],
    ["armaments/aircraft.json", `${gen}`],
    ["armaments/panzer.json", `${gen}`],
  ]) },
  campaigns: { files: (gen) => new Map([
    ["campaigns/east.json", `${gen}`],
    ["campaigns/west.json", `${gen}`],
    ["campaigns/africa.json", `${gen}`],
  ]) },
};

async function applyThenCapture(
  type: keyof typeof FILES,
  gen: string,
  pauseAfterFirstFile?: Promise<void>,
): Promise<string> {
  const entries = [...FILES[type].files(gen)];
  for (let i = 0; i < entries.length; i++) {
    const [rel, content] = entries[i];
    await fsp.writeFile(path.join(src, rel), content, "utf-8");
    if (i === 0 && pauseAfterFirstFile) await pauseAfterFirstFile;
    await tick(2);
  }
  return store.createVersionFrom(src);
}

/** Every generation marker present for one type inside one version. */
function generationsIn(versionId: string, type: string): string[] {
  const dir = path.join(store.versionDir(versionId), type);
  if (!fs.existsSync(dir)) return [];
  return [...new Set(fs.readdirSync(dir).map((f) => fs.readFileSync(path.join(dir, f), "utf-8")))].sort();
}

describe("R3a — concurrent promotions cannot capture each other half-written", () => {
  beforeEach(() => {
    for (const type of ["armaments", "campaigns"] as const) {
      for (const [rel] of FILES[type].files("gen0")) writeFile(rel, "gen0");
    }
  });

  it("CONTROL: unserialised, one promotion captures and activates the other's torn state", async () => {
    // The unfixed behaviour, reproduced exactly: no lock, the same two
    // operations, the same order. Without this the locked test below would
    // pass against a hazard that never occurred.
    const gate = deferred();

    const slow = applyThenCapture("campaigns", "gen1", gate.promise);
    await settle(); // campaigns/east.json is gen1; west and africa are still gen0

    const fast = await applyThenCapture("armaments", "gen1");

    // The version the second promotion captured contains the first's
    // half-written campaigns directory.
    expect(generationsIn(fast, "campaigns")).toEqual(["gen0", "gen1"]);
    expect(generationsIn(fast, "armaments")).toEqual(["gen1"]);

    gate.open();
    await slow;
  });

  it("serialised, every captured version holds a complete set for every type", async () => {
    const lock = new AsyncLock();
    const gate = deferred();

    const first = lock.run(() => applyThenCapture("campaigns", "gen1", gate.promise));
    await settle();

    const secondStarted = { value: false };
    const second = lock.run(async () => {
      secondStarted.value = true;
      return applyThenCapture("armaments", "gen1");
    });

    await settle();
    // The second operation has not begun, so it cannot have captured
    // anything — and no version exists yet at all.
    expect(secondStarted.value).toBe(false);
    expect(await store.listVersions()).toEqual([]);

    gate.open();
    const [a, b] = await Promise.all([first, second]);

    // Neither version contains a mixture within a type.
    for (const id of [a, b]) {
      expect(generationsIn(id, "campaigns")).toHaveLength(1);
      expect(generationsIn(id, "armaments")).toHaveLength(1);
    }
    // And they went in the order they were called.
    expect(generationsIn(a, "campaigns")).toEqual(["gen1"]);
    expect(generationsIn(a, "armaments")).toEqual(["gen0"]);
    expect(generationsIn(b, "armaments")).toEqual(["gen1"]);
    expect(generationsIn(b, "campaigns")).toEqual(["gen1"]);
  });

  it("serialises two promotions of the same type", async () => {
    const lock = new AsyncLock();
    const gate = deferred();

    const first = lock.run(() => applyThenCapture("armaments", "genA", gate.promise));
    await settle();
    const second = lock.run(() => applyThenCapture("armaments", "genB"));
    await settle();

    expect(await store.listVersions()).toEqual([]);
    gate.open();

    const [a, b] = await Promise.all([first, second]);
    expect(generationsIn(a, "armaments")).toEqual(["genA"]);
    expect(generationsIn(b, "armaments")).toEqual(["genB"]);
  });
});

describe("R3a — a rollback is a publication and takes the same turn", () => {
  beforeEach(() => {
    for (const type of ["armaments", "campaigns"] as const) {
      for (const [rel] of FILES[type].files("gen0")) writeFile(rel, "gen0");
    }
  });

  /** A model of rollback()'s critical section: restore, then capture. */
  async function restoreThenCapture(
    snapshot: PromotionSnapshot,
    pauseBeforeCapture?: Promise<void>,
  ): Promise<string> {
    await restoreFromSnapshot(src, snapshot);
    if (pauseBeforeCapture) await pauseBeforeCapture;
    return store.createVersionFrom(src);
  }

  it("a rollback in progress blocks a promotion from capturing mid-restore", async () => {
    const lock = new AsyncLock();
    const gate = deferred();

    // Pretend campaigns was promoted to gen1 and is being rolled back to gen0.
    for (const [rel] of FILES.campaigns.files("gen1")) writeFile(rel, "gen1");
    const snapshot: PromotionSnapshot = Object.fromEntries(
      [...FILES.campaigns.files("gen0")].map(([rel]) => [rel, "gen0"]),
    );

    const rolling = lock.run(() => restoreThenCapture(snapshot, gate.promise));
    const promoting = lock.run(() => applyThenCapture("armaments", "gen1"));

    await settle();
    expect(await store.listVersions()).toEqual([]);

    gate.open();
    const [rolled, promoted] = await Promise.all([rolling, promoting]);

    // The rollback's version holds the fully restored campaigns.
    expect(generationsIn(rolled, "campaigns")).toEqual(["gen0"]);
    // The promotion's version holds it too, plus its own change.
    expect(generationsIn(promoted, "campaigns")).toEqual(["gen0"]);
    expect(generationsIn(promoted, "armaments")).toEqual(["gen1"]);
  });

  it("two rollbacks do not interleave", async () => {
    const lock = new AsyncLock();
    const running: string[] = [];
    let peak = 0;
    let concurrent = 0;

    const rollbackOf = (type: keyof typeof FILES) =>
      lock.run(async () => {
        concurrent++;
        peak = Math.max(peak, concurrent);
        running.push(type);
        const snapshot: PromotionSnapshot = Object.fromEntries(
          [...FILES[type].files("gen0")].map(([rel]) => [rel, "gen0"]),
        );
        await restoreThenCapture(snapshot);
        concurrent--;
      });

    await Promise.all([rollbackOf("armaments"), rollbackOf("campaigns")]);
    expect(peak).toBe(1);
    expect(running).toEqual(["armaments", "campaigns"]);
  });
});

describe("R3a — an editorial save and index regeneration do not lose each other", () => {
  let contentRoot: string;
  let service: SiteContentService;

  const KEY = "armaments/index.json";
  const indexOnDisk = (): { categories: Array<Record<string, unknown>> } =>
    JSON.parse(fs.readFileSync(path.join(contentRoot, "armaments", "index.json"), "utf-8"));

  beforeEach(() => {
    contentRoot = path.join(tmp, "editorial-root");
    fs.mkdirSync(path.join(contentRoot, "armaments", "naval"), { recursive: true });
    // Two published records, so regeneration has a real `nations` list to write.
    fs.writeFileSync(path.join(contentRoot, "armaments", "naval", "germany.json"), "{}", "utf-8");
    fs.writeFileSync(path.join(contentRoot, "armaments", "naval", "italy.json"), "{}", "utf-8");
    fs.writeFileSync(
      path.join(contentRoot, "armaments", "index.json"),
      `${JSON.stringify({ categories: [{ id: "naval", label: "Naval", nations: [] }] }, null, 2)}\n`,
      "utf-8",
    );
    service = new SiteContentService(createRevisionStore(path.join(tmp, "revisions")), contentRoot);
  });

  /**
   * Exactly what promote() does for the index: regenerate from the published
   * directory, then apply the result. The pause is the read-modify-write
   * window.
   */
  async function regenerateAndApply(pauseBeforeWrite?: Promise<void>): Promise<void> {
    const dir = path.join(contentRoot, "armaments");
    const change = await regenerateIndex("armaments", dir);
    if (pauseBeforeWrite) await pauseBeforeWrite;
    if (change) await applyFileChangesAtomically(dir, new Map([[change.relPath, change.content]]));
  }

  it("CONTROL: unserialised, regeneration silently discards a save that reported success", async () => {
    // The save path without coordination — the same recordAndApply call
    // write() makes, with nothing holding the two writers apart.
    const gate = deferred();
    const regenerating = regenerateAndApply(gate.promise); // has read "Naval"
    await settle();

    const revisions = createRevisionStore(path.join(tmp, "control-revisions"));
    const saved = await revisions.recordAndApply({
      key: KEY,
      targetFile: path.join(contentRoot, "armaments", "index.json"),
      content: `${JSON.stringify({ categories: [{ id: "naval", label: "Naval Forces", nations: [] }] }, null, 2)}\n`,
      actor: null, note: null, source: "save",
    });
    expect(saved.id).toBeTruthy();                       // the save reported success
    expect(indexOnDisk().categories[0].label).toBe("Naval Forces");

    gate.open();
    await regenerating;

    // …and is gone, overwritten by a regeneration that read the file first.
    expect(indexOnDisk().categories[0].label).toBe("Naval");
    expect(indexOnDisk().categories[0].nations).toEqual(["germany", "italy"]);
  });

  it("serialised, a save cannot land inside the regeneration's window", async () => {
    const gate = deferred();
    const regenerating = publicationLock.run(() => regenerateAndApply(gate.promise));
    await settle();

    let settledEarly = false;
    const saving = service
      .write(KEY, { categories: [{ id: "naval", label: "Naval Forces", nations: [] }] })
      .then(
        () => { settledEarly = true; },
        () => { settledEarly = true; },
      );

    await settle();
    // Queued, not running: the file still holds neither writer's result.
    expect(settledEarly).toBe(false);
    expect(indexOnDisk().categories[0].label).toBe("Naval");
    expect(indexOnDisk().categories[0].nations).toEqual([]);

    gate.open();
    await regenerating;
    await saving;

    // Regeneration completed in full. The save was then evaluated against
    // what regeneration actually produced, rather than silently overwriting
    // it or being silently overwritten.
    expect(indexOnDisk().categories[0].nations).toEqual(["germany", "italy"]);
    expect(publicationLock.held).toBe(false);
  });

  it("the queued save is rejected rather than clobbering the regenerated fields", async () => {
    const gate = deferred();
    const regenerating = publicationLock.run(() => regenerateAndApply(gate.promise));
    await settle();

    // A body prepared before regeneration ran: its nations are stale.
    const stale = service.write(KEY, { categories: [{ id: "naval", label: "Naval Forces", nations: [] }] });
    await settle();
    gate.open();
    await regenerating;

    await expect(stale).rejects.toBeInstanceOf(AppError);
    // Regeneration's output stands.
    expect(indexOnDisk().categories[0].nations).toEqual(["germany", "italy"]);
    expect(indexOnDisk().categories[0].label).toBe("Naval");
  });

  it("a save made against the current state succeeds, and both changes survive", async () => {
    // The ordinary retry: re-read, re-edit, save again.
    await publicationLock.run(() => regenerateAndApply());
    const current = indexOnDisk();

    await service.write(KEY, {
      categories: [{ ...current.categories[0], label: "Naval Forces" }],
    });

    expect(indexOnDisk().categories[0].label).toBe("Naval Forces");  // editorial
    expect(indexOnDisk().categories[0].nations).toEqual(["germany", "italy"]); // generated
  });

  it("a second regeneration preserves the editorial label it finds", async () => {
    await publicationLock.run(() => regenerateAndApply());
    const current = indexOnDisk();
    await service.write(KEY, { categories: [{ ...current.categories[0], label: "Naval Forces" }] });

    fs.writeFileSync(path.join(contentRoot, "armaments", "naval", "japan.json"), "{}", "utf-8");
    await publicationLock.run(() => regenerateAndApply());

    expect(indexOnDisk().categories[0].label).toBe("Naval Forces");
    expect(indexOnDisk().categories[0].nations).toEqual(["germany", "italy", "japan"]);
  });

  it("leaves the lock free after a save that was rejected", async () => {
    await expect(service.write(KEY, { categories: "not an array" })).rejects.toBeInstanceOf(AppError);
    expect(publicationLock.held).toBe(false);
    expect(publicationLock.waiting).toBe(0);
  });

  it("does not serialise editorial files that regeneration never touches", async () => {
    // navigation.json has no second writer, so it must not queue behind a
    // publication — otherwise every unrelated save waits on a promotion.
    fs.writeFileSync(path.join(contentRoot, "navigation.json"), '{"items":[]}\n', "utf-8");
    const gate = deferred();
    const blocking = publicationLock.run(async () => { await gate.promise; });
    await settle();

    await expect(service.write("navigation.json", { items: [{ id: "home" }] })).resolves.toBeDefined();
    expect(JSON.parse(fs.readFileSync(path.join(contentRoot, "navigation.json"), "utf-8")).items)
      .toEqual([{ id: "home" }]);

    gate.open();
    await blocking;
  });
});

describe("R3b — a non-versioned publication captures nothing and costs nothing", () => {
  const ok = async (): Promise<void> => undefined;

  /** Five real versions, with the newest active. */
  async function seedVersions(count: number): Promise<string[]> {
    writeFile("armaments/naval.json", "gen0");
    const ids: string[] = [];
    for (let i = 0; i < count; i++) {
      fs.writeFileSync(path.join(src, "armaments", "naval.json"), `gen${i}`, "utf-8");
      ids.push(await store.createVersionFrom(src));
    }
    await store.writeActiveVersion(ids[ids.length - 1]);
    return ids;
  }

  it("consumes no retention slot: every existing version survives", async () => {
    const ids = await seedVersions(5);
    expect(ids).toHaveLength(5);

    const out = await completeAfterActivation({
      runId: "nsdap-run",
      recoveryMetadata: "persisted",
      activation: "not-applicable",
      prune: null,
      recordHistory: ok,
    });

    expect(await store.listVersions()).toEqual(ids);
    expect(await store.readActiveVersion()).toBe(ids[4]);
    expect(out.steps.cleanup).toBe("not-applicable");
    expect(out.steps.activation).toBe("not-applicable");
    expect(out.status).toBe("success");
    expect(out.warnings).toEqual([]);
  });

  it("CONTRAST: the same operation with pruning evicts the oldest version", async () => {
    // Proves the test above is measuring something: run unchanged, this is
    // what a non-versioned promotion used to do to the retention window.
    const ids = await seedVersions(5);

    await completeAfterActivation({
      runId: "versioned-run",
      recoveryMetadata: "persisted",
      activation: "activated",
      prune: () => store.pruneVersions(),
      recordHistory: ok,
    });

    // active + MIN_RETAINED_PRIOR, so the oldest goes.
    expect(await store.listVersions()).toEqual(ids.slice(1));
    expect(await store.listVersions()).toHaveLength(MIN_RETAINED_PRIOR + 1);
  });

  it("three non-versioned publications in a row leave the window intact", async () => {
    const ids = await seedVersions(5);
    for (let i = 0; i < 3; i++) {
      await completeAfterActivation({
        runId: `nsdap-${i}`,
        recoveryMetadata: "persisted",
        activation: "not-applicable",
        prune: null,
        recordHistory: ok,
      });
    }
    expect(await store.listVersions()).toEqual(ids);
  });

  it("still reports history failure as a warning, with the content live", async () => {
    // Skipping activation must not skip the honesty of the rest of the report.
    const out = await completeAfterActivation({
      runId: "nsdap-run",
      recoveryMetadata: "persisted",
      activation: "not-applicable",
      prune: null,
      recordHistory: async () => { throw new Error("audit row rejected"); },
    });

    expect(out.status).toBe("activated-with-warnings");
    expect(out.steps.history).toBe("failed");
    expect(out.steps.cleanup).toBe("not-applicable");
    expect(out.warnings[0]).toContain("audit row rejected");
    expect(out.warnings[0]).toContain("nsdap-run");
  });

  it("defaults to activated, so every existing versioned caller is unchanged", async () => {
    const out = await completeAfterActivation({
      runId: "r1", recoveryMetadata: "persisted", prune: ok, recordHistory: ok,
    });
    expect(out.steps).toEqual({
      contentApplied: true,
      recoveryMetadata: "persisted",
      activation: "activated",
      history: "recorded",
      cleanup: "completed",
    });
  });
});

describe("promote and rollback really do take the lock, and really do gate capture", () => {
  // The methods cannot be executed with PROMOTION_ENABLED false, and making
  // them executable for a test would weaken the one guard that keeps this
  // pipeline from writing to public/data. Asserted against the source
  // instead, as elsewhere in this suite.
  const source = fs.readFileSync(path.resolve(__dirname, "../promotion.service.ts"), "utf-8");

  it("routes both entry points through the shared lock", () => {
    expect(source).toContain('import { publicationLock } from "./publication-lock";');
    expect(source).toContain("return publicationLock.run(() => this.promoteLocked(type, userId, runId));");
    expect(source).toContain(
      "return publicationLock.run(() => this.rollbackLocked(type, targetRunId, userId, runId));",
    );
  });

  it("keeps the locked bodies private, so nothing can bypass the lock", () => {
    expect(source).toContain("private async promoteLocked(");
    expect(source).toContain("private async rollbackLocked(");
    // Called exactly once each — from inside the lock.
    expect(source.match(/this\.promoteLocked\(/g)).toHaveLength(1);
    expect(source.match(/this\.rollbackLocked\(/g)).toHaveLength(1);
  });

  it("takes the lock after the disabled gate, so a disabled call still returns at once", () => {
    const promoteBody = source.slice(source.indexOf("async promote("), source.indexOf("private async promoteLocked("));
    expect(promoteBody.indexOf("PROMOTION_ENABLED")).toBeLessThan(promoteBody.indexOf("publicationLock.run"));
  });

  it("gates capture and pruning on isVersionedType in both entry points", () => {
    expect(source).toContain('import { versionStore, isVersionedType } from "./version-store";');
    // Once in each locked body, and nowhere else.
    expect(source.match(/if \(isVersionedType\(type\)\) \{/g)).toHaveLength(2);
    // Capture is only ever reached inside that gate.
    expect(source.match(/await captureAndActivateVersion\(\)/g)).toHaveLength(2);
    // Pruning and the reported activation are both derived from whether a
    // version was produced, so they cannot disagree with what ran.
    expect(source.match(/prune: version \? \(\) => versionStore\.pruneVersions\(\) : null/g)).toHaveLength(2);
    expect(source.match(/activation: version \? "activated" : "not-applicable"/g)).toHaveLength(2);
  });

  it("no longer calls pruneVersions unconditionally", () => {
    expect(source).not.toContain("prune: () => versionStore.pruneVersions(),");
  });
});
