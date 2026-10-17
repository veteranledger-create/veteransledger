import fs from "fs";
import fsp from "fs/promises";
import os from "os";
import path from "path";
import {
  normalizeSnapshotKey,
  resolveSnapshotPath,
  applyFileChangesAtomically,
  restoreFromSnapshot,
  AtomicApplyError,
  PromotionSnapshot,
} from "../promote-atomic";

/**
 * Phase 1A — cross-platform snapshot key handling.
 *
 * Snapshot manifests written on Windows stored keys with backslashes, which
 * are not path separators on Linux. These tests prove that both conventions
 * (and a mixture) resolve correctly, that unsafe keys are rejected, and that
 * every manifest already on disk can be resolved without being rewritten.
 *
 * All filesystem writes go to a fresh directory under the OS temp dir. The
 * real snapshots under storage/publish-snapshots are only ever read.
 */

const REPO_ROOT = path.resolve(__dirname, "../../../..");
const SNAPSHOT_ROOT = path.join(REPO_ROOT, "storage", "publish-snapshots");

/** Every manifest.json under the snapshot root. Read-only discovery. */
function findManifests(): string[] {
  const out: string[] = [];
  const walk = (dir: string) => {
    if (!fs.existsSync(dir)) return;
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) walk(p);
      else if (e.name === "manifest.json") out.push(p);
    }
  };
  walk(SNAPSHOT_ROOT);
  return out;
}

/** Every key across every manifest already on disk. */
function manifestKeys(): string[] {
  return findManifests().flatMap((m) =>
    Object.keys(JSON.parse(fs.readFileSync(m, "utf-8")) as PromotionSnapshot),
  );
}

let tmpDir: string;
beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "vl-promote-atomic-"));
});
afterEach(() => {
  jest.restoreAllMocks();
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

/**
 * Rejects the rename that writes `basename`, leaving every other write real.
 *
 * Write failures used to be injected by putting a *directory* at the target
 * path. R8-1 stops that at the snapshot read instead — a directory is no
 * longer silently recorded as absent — so the call now aborts before writing
 * anything, and a test relying on that trick would exercise no write and no
 * reversal while still passing. Failing the rename puts the fault back where
 * these tests mean it to be.
 */
function failWriteOf(basename: string, message = `EIO writing ${basename}`): void {
  const realRename = jest.requireActual<typeof import("fs/promises")>("fs/promises").rename;
  jest.spyOn(fsp, "rename").mockImplementation(((from: string, to: string) => {
    if (path.basename(String(to)) === basename) return Promise.reject(new Error(message));
    return realRename(from, String(to));
  }) as never);
}

describe("normalizeSnapshotKey", () => {
  it("converts Windows separators to the portable form", () => {
    expect(normalizeSnapshotKey("naval\\germany.json")).toBe("naval/germany.json");
  });

  it("leaves POSIX separators unchanged", () => {
    expect(normalizeSnapshotKey("naval/germany.json")).toBe("naval/germany.json");
  });

  it("handles mixed and repeated separators", () => {
    expect(normalizeSnapshotKey("a\\b//c\\\\d.json")).toBe("a/b/c/d.json");
  });

  it("keeps a flat key flat", () => {
    expect(normalizeSnapshotKey("index.json")).toBe("index.json");
  });

  it("drops redundant current-directory segments", () => {
    expect(normalizeSnapshotKey("a/./b.json")).toBe("a/b.json");
  });

  it.each([
    ["empty string", ""],
    ["whitespace only", "   "],
    ["POSIX absolute", "/etc/passwd"],
    ["Windows absolute (backslash)", "\\Windows\\system32"],
    ["Windows drive absolute", "C:\\Windows\\system32"],
    ["Windows drive forward-slash", "C:/Windows/system32"],
    ["parent traversal", "../outside.json"],
    ["nested traversal", "a/../../outside.json"],
    ["backslash traversal", "a\\..\\..\\outside.json"],
    ["separators only", "///"],
  ])("rejects %s", (_label, key) => {
    expect(() => normalizeSnapshotKey(key)).toThrow();
  });
});

describe("resolveSnapshotPath", () => {
  it("resolves a nested key beneath the base directory", () => {
    const full = resolveSnapshotPath(tmpDir, "naval\\germany.json");
    expect(full).toBe(path.join(tmpDir, "naval", "germany.json"));
  });

  it("resolves both conventions to the identical path", () => {
    expect(resolveSnapshotPath(tmpDir, "a\\b.json")).toBe(resolveSnapshotPath(tmpDir, "a/b.json"));
  });

  it("refuses to escape the base directory", () => {
    expect(() => resolveSnapshotPath(tmpDir, "../escape.json")).toThrow();
  });
});

describe("applyFileChangesAtomically — legacy key round-trip", () => {
  it("writes a backslash key to a real nested path, not a literal filename", async () => {
    const changes = new Map<string, string | null>([["naval\\germany.json", '{"ok":true}']]);
    const { applied, snapshot } = await applyFileChangesAtomically(tmpDir, changes);

    const nested = path.join(tmpDir, "naval", "germany.json");
    expect(fs.existsSync(nested)).toBe(true);
    expect(fs.readFileSync(nested, "utf-8")).toBe('{"ok":true}');

    // No file literally named "naval\germany.json" at the top level.
    expect(fs.readdirSync(tmpDir)).toEqual(["naval"]);

    // Keys are persisted in the portable form for future manifests.
    expect(applied).toEqual(["naval/germany.json"]);
    expect(Object.keys(snapshot)).toEqual(["naval/germany.json"]);
    expect(snapshot["naval/germany.json"]).toBeNull(); // did not exist before
  });

  it("restores a legacy-keyed snapshot taken on another platform", async () => {
    const nested = path.join(tmpDir, "naval", "germany.json");
    fs.mkdirSync(path.dirname(nested), { recursive: true });
    fs.writeFileSync(nested, "ORIGINAL", "utf-8");

    // A manifest exactly as Windows wrote it.
    const legacy: PromotionSnapshot = { "naval\\germany.json": "ORIGINAL" };

    fs.writeFileSync(nested, "CHANGED", "utf-8");
    const { restored } = await restoreFromSnapshot(tmpDir, legacy);

    expect(fs.readFileSync(nested, "utf-8")).toBe("ORIGINAL");
    expect(restored).toEqual(["naval/germany.json"]);
  });

  it("matches onlyPaths against a legacy snapshot regardless of convention", async () => {
    const nested = path.join(tmpDir, "a", "b.json");
    fs.mkdirSync(path.dirname(nested), { recursive: true });
    fs.writeFileSync(nested, "RESTORED", "utf-8");

    const legacy: PromotionSnapshot = { "a\\b.json": "RESTORED", "a\\c.json": "OTHER" };
    fs.writeFileSync(nested, "DIRTY", "utf-8");

    // Caller asks using POSIX separators; snapshot stored backslashes.
    const { restored } = await restoreFromSnapshot(tmpDir, legacy, ["a/b.json"]);
    expect(restored).toEqual(["a/b.json"]);
    expect(fs.readFileSync(nested, "utf-8")).toBe("RESTORED");
    // The unrequested entry was not touched.
    expect(fs.existsSync(path.join(tmpDir, "a", "c.json"))).toBe(false);
  });

  it("rejects an unsafe key before writing anything", async () => {
    const changes = new Map<string, string | null>([
      ["safe.json", "A"],
      ["../escape.json", "B"],
    ]);
    await expect(applyFileChangesAtomically(tmpDir, changes)).rejects.toThrow();
    // Validation happens up front, so even the safe entry was never written.
    expect(fs.existsSync(path.join(tmpDir, "safe.json"))).toBe(false);
  });

  it("reverses applied changes when one fails partway through", async () => {
    const existing = path.join(tmpDir, "first.json");
    fs.writeFileSync(existing, "BEFORE", "utf-8");

    // The second write fails at the rename. This used to be injected with a
    // directory at the target, which R8-1 now stops at the snapshot read —
    // the call would abort before writing anything and this test would pass
    // without a reversal ever running, which is not what it claims to check.
    failWriteOf("second.json");

    const changes = new Map<string, string | null>([
      ["first.json", "AFTER"],
      ["second.json", "WILL FAIL"],
    ]);

    const err: unknown = await applyFileChangesAtomically(tmpDir, changes).catch((e) => e);

    // A reversal really did run: first.json was written and then put back.
    expect((err as AtomicApplyError).reverted).toEqual(["first.json"]);
    expect(fs.readFileSync(existing, "utf-8")).toBe("BEFORE");
  });
});

describe("every snapshot manifest already on disk", () => {
  const manifests = findManifests();

  it("finds the manifests to check", () => {
    expect(manifests.length).toBeGreaterThan(0);
  });

  it("resolves every key safely, without modifying any snapshot", () => {
    const before = manifests.map((m) => fs.statSync(m).mtimeMs);
    let keysChecked = 0;

    for (const manifestPath of manifests) {
      const snapshot = JSON.parse(fs.readFileSync(manifestPath, "utf-8")) as PromotionSnapshot;
      for (const key of Object.keys(snapshot)) {
        const normalized = normalizeSnapshotKey(key);
        expect(normalized).not.toContain("\\");

        const full = resolveSnapshotPath(tmpDir, key);
        expect(full.startsWith(path.resolve(tmpDir) + path.sep)).toBe(true);
        keysChecked++;
      }
    }

    expect(keysChecked).toBeGreaterThan(0);
    // The real snapshots were only read.
    expect(manifests.map((m) => fs.statSync(m).mtimeMs)).toEqual(before);
  });
});

/**
 * This suite runs on Windows (process.platform === "win32"), so the Linux
 * filesystem behaviour cannot be exercised natively here. What CAN be proved
 * on any host is the invariant that makes Linux correct: a key is split into
 * separator-free segments BEFORE any path API sees it, so a backslash can
 * never survive into a filename on a platform where it is a legal character.
 * The composition step below uses path.posix to model what the host's
 * path.resolve would then do on Linux — a simulation, not a Linux test run.
 */
describe("POSIX correctness invariant (simulated on this Windows host)", () => {
  it("documents the host this ran on", () => {
    expect(["win32", "linux", "darwin"]).toContain(process.platform);
  });

  it("never leaves a separator inside a segment", () => {
    for (const key of ["naval\\germany.json", "a\\b//c\\\\d.json", "a/b.json", "index.json"]) {
      for (const segment of normalizeSnapshotKey(key).split("/")) {
        expect(segment).not.toContain("\\");
        expect(segment).not.toContain("/");
        expect(segment.length).toBeGreaterThan(0);
      }
    }
  });

  it("composes legacy Windows keys into real POSIX paths", () => {
    const segments = normalizeSnapshotKey("naval\\germany.json").split("/");
    expect(path.posix.join("/srv/data", ...segments)).toBe("/srv/data/naval/germany.json");
  });

  it("composes every real manifest key into a POSIX path with no stray backslash", () => {
    const keys = manifestKeys();
    expect(keys.length).toBeGreaterThan(0);
    for (const key of keys) {
      const posixPath = path.posix.join("/srv/data", ...normalizeSnapshotKey(key).split("/"));
      expect(posixPath.startsWith("/srv/data/")).toBe(true);
      expect(posixPath).not.toContain("\\");
    }
  });
});

/**
 * F2 — a reversal that fails must not be silent.
 *
 * The compensation loop used to be `.catch(() => undefined)` per file, so a
 * reversal that itself failed was invisible: the caller saw the original
 * write error and could not tell an intact directory from a part-applied one.
 *
 * These cases used to force a write failure by putting a *directory* at the
 * target path. R8-1 made that impossible: a directory no longer reaches the
 * write stage at all, because the snapshot read now refuses anything that is
 * not a readable file or a confirmed ENOENT. The fault is therefore injected
 * at the rename instead — which is the layer actually under test here. Every
 * assertion below is unchanged; only the way the failure is produced is.
 */
describe("compensation reports what it achieved", () => {
  it("throws AtomicApplyError carrying the original error and the snapshot", async () => {
    fs.writeFileSync(path.join(tmpDir, "first.json"), "BEFORE", "utf-8");
    failWriteOf("second.json"); // makes write 2 fail

    const err: unknown = await applyFileChangesAtomically(
      tmpDir,
      new Map<string, string | null>([["first.json", "AFTER"], ["second.json", "WILL FAIL"]]),
    ).catch((e) => e);

    expect(err).toBeInstanceOf(AtomicApplyError);
    const failure = err as AtomicApplyError;
    // The write failure itself is preserved, distinct from the wrapper.
    // Object.prototype.toString rather than instanceof: ts-jest can load the
    // module graph in a separate realm, where the two Error constructors are
    // different objects and instanceof fails on a genuine Error.
    expect(Object.prototype.toString.call(failure.originalError)).toBe("[object Error]");
    expect(failure.originalError.name).toBe("Error");
    expect(failure.originalError).not.toBe(failure);
    expect(failure.name).toBe("AtomicApplyError");
    expect(failure.message).toContain(failure.originalError.message);
    expect(failure.message).not.toBe(failure.originalError.message);
    // The snapshot taken before anything was written comes back with it.
    expect(failure.snapshot["first.json"]).toBe("BEFORE");
    // And the reversal put the first file back.
    expect(failure.fullyReverted).toBe(true);
    expect(failure.reverted).toEqual(["first.json"]);
    expect(failure.reversalFailures).toEqual([]);
    expect(fs.readFileSync(path.join(tmpDir, "first.json"), "utf-8")).toBe("BEFORE");
  });

  it("collects every reversal failure instead of swallowing it", async () => {
    fs.writeFileSync(path.join(tmpDir, "first.json"), "BEFORE", "utf-8");

    // Fail the reversal of first.json: its rename back is the one that runs
    // after the second write has already thrown.
    const realRename = jest.requireActual<typeof import("fs/promises")>("fs/promises").rename;
    let seen = 0;
    jest.spyOn(fsp, "rename").mockImplementation(((from: string, to: string) => {
      if (path.basename(String(to)) === "second.json") {
        return Promise.reject(new Error("EIO writing second.json"));
      }
      if (String(to).endsWith("first.json")) {
        seen++;
        if (seen > 1) return Promise.reject(new Error("EBUSY on reverse"));
      }
      return realRename(from, to);
    }) as never);

    const err: unknown = await applyFileChangesAtomically(
      tmpDir,
      new Map<string, string | null>([["first.json", "AFTER"], ["second.json", "WILL FAIL"]]),
    ).catch((e) => e);

    jest.restoreAllMocks();

    const failure = err as AtomicApplyError;
    expect(failure).toBeInstanceOf(AtomicApplyError);
    expect(failure.fullyReverted).toBe(false);
    expect(failure.reversalFailures).toEqual([{ path: "first.json", message: "EBUSY on reverse" }]);
    expect(failure.reverted).toEqual([]);
    // Both facts are legible in one message.
    expect(failure.message).toMatch(/COULD NOT BE REVERSED/);
    expect(failure.message).toContain("first.json");
    // And the file really was left changed — that is what made silence unsafe.
    expect(fs.readFileSync(path.join(tmpDir, "first.json"), "utf-8")).toBe("AFTER");
  });

  it("attempts every reversal even after one fails", async () => {
    for (const name of ["a.json", "b.json"]) {
      fs.writeFileSync(path.join(tmpDir, name), "BEFORE", "utf-8");
    }
    const realRename = jest.requireActual<typeof import("fs/promises")>("fs/promises").rename;
    const reverseAttempts: string[] = [];
    const seen = new Map<string, number>();
    jest.spyOn(fsp, "rename").mockImplementation(((from: string, to: string) => {
      const base = path.basename(String(to));
      const n = (seen.get(base) ?? 0) + 1;
      seen.set(base, n);
      if (base === "c.json") return Promise.reject(new Error("EIO writing c.json"));
      if (n > 1) {
        reverseAttempts.push(base);
        if (base === "a.json") return Promise.reject(new Error("first reversal failed"));
      }
      return realRename(from, String(to));
    }) as never);

    const err: unknown = await applyFileChangesAtomically(
      tmpDir,
      new Map<string, string | null>([["a.json", "AFTER"], ["b.json", "AFTER"], ["c.json", "WILL FAIL"]]),
    ).catch((e) => e);

    jest.restoreAllMocks();

    // b.json was still attempted after a.json's reversal failed.
    expect(reverseAttempts).toEqual(["a.json", "b.json"]);
    const failure = err as AtomicApplyError;
    expect(failure.reversalFailures.map((f) => f.path)).toEqual(["a.json"]);
    expect(failure.reverted).toEqual(["b.json"]);
    expect(fs.readFileSync(path.join(tmpDir, "b.json"), "utf-8")).toBe("BEFORE");
  });

  it("still reverses nothing when the very first write fails", async () => {
    failWriteOf("only.json");
    const err: unknown = await applyFileChangesAtomically(
      tmpDir, new Map<string, string | null>([["only.json", "X"]]),
    ).catch((e) => e);

    const failure = err as AtomicApplyError;
    expect(failure.reverted).toEqual([]);
    expect(failure.reversalFailures).toEqual([]);
    expect(failure.fullyReverted).toBe(true); // nothing to reverse
  });

  it("keeps rejecting unsafe keys before any write, unchanged", async () => {
    await expect(
      applyFileChangesAtomically(tmpDir, new Map<string, string | null>([["../escape.json", "X"]])),
    ).rejects.not.toBeInstanceOf(AtomicApplyError);
  });
});
