import { AsyncLock, REGENERATED_INDEX_KEYS, isRegeneratedIndexKey, publicationLock } from "../publication-lock";
import { INDEX_SCHEMAS } from "../index-schema";
import { VERSIONED_TYPES, isVersionedType } from "../version-store";

/**
 * R3a — the lock itself.
 *
 * The hazard it exists for is two writers on one published tree: a promotion
 * capturing a version while another is mid-write, and an editorial save
 * interleaving with the regeneration of the same manifest. Those are proven
 * where they happen (publication-concurrency.test.ts); this file proves the
 * primitive they rely on, because a mutex that leaks on failure or admits
 * overlap would make every guarantee built on it false.
 *
 * Nothing here touches the filesystem, the database, or promotion.
 */

/** Resolves after `n` microtask turns, to interleave cooperating tasks. */
const tick = async (n = 1): Promise<void> => {
  for (let i = 0; i < n; i++) await Promise.resolve();
};

const deferred = <T = void>(): { promise: Promise<T>; resolve: (v: T) => void; reject: (e: unknown) => void } => {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
};

describe("AsyncLock — mutual exclusion", () => {
  it("never runs two critical sections at once, however they interleave", async () => {
    const lock = new AsyncLock();
    let concurrent = 0;
    let peak = 0;

    const task = async (turns: number): Promise<void> => {
      await lock.run(async () => {
        concurrent++;
        peak = Math.max(peak, concurrent);
        // Yield repeatedly inside the section: an unlocked implementation
        // would let another task in at any of these points.
        await tick(turns);
        concurrent--;
      });
    };

    await Promise.all([task(5), task(1), task(3), task(8), task(2)]);

    expect(peak).toBe(1);
    expect(concurrent).toBe(0);
  });

  it("admits callers in the order they called, not the order they finish", async () => {
    const lock = new AsyncLock();
    const entered: string[] = [];
    const gates = { a: deferred(), b: deferred(), c: deferred() };

    const task = (name: "a" | "b" | "c") =>
      lock.run(async () => {
        entered.push(name);
        await gates[name].promise;
      });

    const all = Promise.all([task("a"), task("b"), task("c")]);

    await tick(3);
    expect(entered).toEqual(["a"]); // b and c are queued, not running

    // Finish them out of order; entry order must still be a, b, c.
    gates.a.resolve();
    await tick(3);
    expect(entered).toEqual(["a", "b"]);

    gates.b.resolve();
    await tick(3);
    expect(entered).toEqual(["a", "b", "c"]);

    gates.c.resolve();
    await all;
  });

  it("holds the second caller until the first has actually finished", async () => {
    const lock = new AsyncLock();
    const gate = deferred();
    const order: string[] = [];

    const first = lock.run(async () => {
      await gate.promise;
      order.push("first-done");
    });
    const second = lock.run(async () => {
      order.push("second-start");
    });

    await tick(5);
    expect(order).toEqual([]); // second has not started

    gate.resolve();
    await Promise.all([first, second]);
    expect(order).toEqual(["first-done", "second-start"]);
  });
});

describe("AsyncLock — release", () => {
  it("releases after success", async () => {
    const lock = new AsyncLock();
    await lock.run(async () => undefined);

    expect(lock.held).toBe(false);
    expect(lock.waiting).toBe(0);
    // And is usable again.
    await expect(lock.run(async () => "second")).resolves.toBe("second");
  });

  it("releases after a rejection, and does not swallow it", async () => {
    const lock = new AsyncLock();

    await expect(lock.run(async () => { throw new Error("section exploded"); }))
      .rejects.toThrow("section exploded");

    expect(lock.held).toBe(false);
    expect(lock.waiting).toBe(0);
    await expect(lock.run(async () => "after failure")).resolves.toBe("after failure");
  });

  it("releases after a synchronous throw inside the section", async () => {
    const lock = new AsyncLock();

    await expect(lock.run((() => { throw new Error("threw before awaiting"); }) as () => Promise<never>))
      .rejects.toThrow("threw before awaiting");

    expect(lock.held).toBe(false);
    await expect(lock.run(async () => "still works")).resolves.toBe("still works");
  });

  it("a failing section does not poison the queue behind it", async () => {
    const lock = new AsyncLock();
    const ran: string[] = [];

    const failing = lock.run(async () => { ran.push("failing"); throw new Error("boom"); });
    const after = lock.run(async () => { ran.push("after"); return "ok"; });

    await expect(failing).rejects.toThrow("boom");
    await expect(after).resolves.toBe("ok");
    expect(ran).toEqual(["failing", "after"]);
  });

  it("survives a long run of alternating successes and failures", async () => {
    const lock = new AsyncLock();
    let peak = 0;
    let concurrent = 0;

    const results = await Promise.allSettled(
      Array.from({ length: 20 }, (_unused, i) =>
        lock.run(async () => {
          concurrent++;
          peak = Math.max(peak, concurrent);
          await tick(2);
          concurrent--;
          if (i % 3 === 0) throw new Error(`fail ${i}`);
          return i;
        }),
      ),
    );

    expect(peak).toBe(1);
    expect(results.filter((r) => r.status === "rejected")).toHaveLength(7);
    expect(lock.held).toBe(false);
    expect(lock.waiting).toBe(0);
  });
});

describe("AsyncLock — reported state", () => {
  it("reports held while a section runs and not before or after", async () => {
    const lock = new AsyncLock();
    const gate = deferred();

    expect(lock.held).toBe(false);
    const running = lock.run(async () => { await gate.promise; });

    await tick(3);
    expect(lock.held).toBe(true);

    gate.resolve();
    await running;
    expect(lock.held).toBe(false);
  });

  it("counts queued callers", async () => {
    const lock = new AsyncLock();
    const gate = deferred();

    const all = Promise.all([
      lock.run(async () => { await gate.promise; }),
      lock.run(async () => undefined),
      lock.run(async () => undefined),
    ]);

    await tick(3);
    expect(lock.held).toBe(true);
    expect(lock.waiting).toBe(2);

    gate.resolve();
    await all;
    expect(lock.waiting).toBe(0);
  });
});

describe("REGENERATED_INDEX_KEYS is derived, not restated", () => {
  it("is exactly one key per schema in INDEX_SCHEMAS", () => {
    const expected = Object.values(INDEX_SCHEMAS).map((s) => `${s.type}/index.json`);
    expect([...REGENERATED_INDEX_KEYS].sort()).toEqual([...expected].sort());
    expect(REGENERATED_INDEX_KEYS.size).toBe(Object.keys(INDEX_SCHEMAS).length);
  });

  it("covers the eight section manifests the Admin can also write", () => {
    expect([...REGENERATED_INDEX_KEYS].sort()).toEqual([
      "armaments/index.json",
      "articles/index.json",
      "awards/index.json",
      "campaigns/index.json",
      "letters/index.json",
      "maps/index.json",
      "personnel/index.json",
      "political-docs/index.json",
    ]);
  });

  it("matches the keys content-validation derives from the same source", async () => {
    // Both are projections of INDEX_SCHEMAS. If they ever disagree, the API
    // would be rejecting generated-field writes on a file it does not
    // serialise, or serialising one it does not protect.
    const { GENERATED_FIELDS } = await import("../../editorial-history/content-validation");
    expect([...REGENERATED_INDEX_KEYS].sort()).toEqual(Object.keys(GENERATED_FIELDS).sort());
  });
});

describe("isRegeneratedIndexKey", () => {
  it.each([...REGENERATED_INDEX_KEYS])("recognises %s", (key) => {
    expect(isRegeneratedIndexKey(key)).toBe(true);
  });

  it.each([
    ["nsdap/index.json", "nsdap has no schema and no regenerator"],
    ["formations/index.json", "formations/index.json is static structural config"],
    ["navigation.json", "a plain editorial file"],
    ["homepage.json", "a plain editorial file"],
    ["about/overview.json", "an editorial subtree"],
    ["armaments/naval/germany.json", "a published record, not the manifest"],
    ["armaments/index.jsonx", "a near miss"],
    ["index.json", "the bare filename"],
    ["", "an empty key"],
  ])("does not recognise %s (%s)", (key) => {
    expect(isRegeneratedIndexKey(key)).toBe(false);
  });

  it("normalises separators, so a backslash variant cannot slip past", () => {
    expect(isRegeneratedIndexKey("armaments\\index.json")).toBe(true);
  });
});

describe("the application shares one lock", () => {
  it("exports a single instance", () => {
    expect(publicationLock).toBeInstanceOf(AsyncLock);
    // Re-importing yields the same object: two modules locking different
    // instances would serialise nothing.
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const again = require("../publication-lock").publicationLock as AsyncLock;
    expect(again).toBe(publicationLock);
  });

  it("is idle outside a publication", () => {
    expect(publicationLock.held).toBe(false);
    expect(publicationLock.waiting).toBe(0);
  });
});

describe("the versioned/non-versioned split this coordinates around", () => {
  it("nsdap is the one publishable type outside VERSIONED_TYPES", () => {
    expect(isVersionedType("nsdap")).toBe(false);
    for (const type of VERSIONED_TYPES) expect(isVersionedType(type)).toBe(true);
  });

  it("every type with a regenerated index is versioned", () => {
    // The manifests this lock coordinates are all inside the version store,
    // so a save to one really is racing a regeneration that a version will
    // then capture.
    for (const schema of Object.values(INDEX_SCHEMAS)) {
      expect(isVersionedType(schema.type)).toBe(true);
    }
  });
});
