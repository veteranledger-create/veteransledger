import fs from "fs";
import fsp from "fs/promises";
import os from "os";
import path from "path";
import {
  readSnapshotManifest,
  writeSnapshotManifest,
  canonicalSnapshot,
  snapshotChecksum,
  validateSnapshotShape,
  ManifestMissingError,
  ManifestInvalidError,
  SNAPSHOT_FORMAT_VERSION,
  CHECKSUM_ALGORITHM,
} from "../snapshot-manifest";
import { rollbackTargetError } from "../promotion.service";
import { createVersionStore } from "../version-store";
import { PromotionSnapshot } from "../promote-atomic";
import { AppError } from "../../../middleware/error.middleware";

/**
 * R8 Stage 2 — a rollback target must be intact before it is acted on, and a
 * newly written manifest must be either whole or absent.
 *
 * The manifest is the only thing that makes a promotion reversible. It was
 * written with a bare non-atomic writeFile and read with a bare JSON.parse,
 * so a truncated write produced either a file that failed to parse — and was
 * reported as *missing*, sending the operator after the wrong problem — or,
 * if the truncation landed on a parseable fragment, a manifest that restored
 * a subset of what it should have. `{}` was accepted outright.
 *
 * Everything here runs against throwaway directories. PROMOTION_ENABLED
 * stays false; promote() and rollback() are not executed.
 */

let tmp: string;
const manifestAt = (name = "manifest.json"): string => path.join(tmp, name);
const writeRaw = (body: string, name = "manifest.json"): string => {
  const p = manifestAt(name);
  fs.writeFileSync(p, body, "utf-8");
  return p;
};

const SNAPSHOT: PromotionSnapshot = {
  "naval/germany.json": '{"records":[]}',
  "naval/romania.json": null,
  "index.json": '{"categories":[]}',
};

beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "vl-manifest-"));
});
afterEach(() => {
  jest.restoreAllMocks();
  fs.rmSync(tmp, { recursive: true, force: true });
});

describe("canonical form and checksum", () => {
  it("is independent of key insertion order", () => {
    const a: PromotionSnapshot = { "b.json": "B", "a.json": "A", "c.json": null };
    const b: PromotionSnapshot = { "c.json": null, "a.json": "A", "b.json": "B" };
    expect(canonicalSnapshot(a)).toBe(canonicalSnapshot(b));
    expect(snapshotChecksum(a)).toBe(snapshotChecksum(b));
  });

  it("distinguishes null from the empty string", () => {
    expect(snapshotChecksum({ "a.json": null })).not.toBe(snapshotChecksum({ "a.json": "" }));
  });

  it("changes when any byte of any value changes", () => {
    const base = snapshotChecksum(SNAPSHOT);
    expect(snapshotChecksum({ ...SNAPSHOT, "index.json": '{"categories":[] }' })).not.toBe(base);
  });

  it("changes when a key is added or removed", () => {
    const base = snapshotChecksum(SNAPSHOT);
    const { "index.json": _dropped, ...fewer } = SNAPSHOT;
    expect(snapshotChecksum(fewer)).not.toBe(base);
    expect(snapshotChecksum({ ...SNAPSHOT, "extra.json": null })).not.toBe(base);
  });

  it("treats a legacy key spelling as different bytes, deliberately", () => {
    // The digest answers "are these the bytes that were written", not "do
    // these mean the same path".
    expect(snapshotChecksum({ "naval\\a.json": "X" })).not.toBe(snapshotChecksum({ "naval/a.json": "X" }));
  });

  it("is a 64-character lowercase hex sha256", () => {
    expect(snapshotChecksum(SNAPSHOT)).toMatch(/^[0-9a-f]{64}$/);
  });

  it("is reproducible from the documented canonical form with a standard tool", () => {
    // The canonical form is public, so the digest can be recomputed outside
    // this codebase. That is the point of documenting it.
    const { createHash } = require("crypto") as typeof import("crypto");
    const expected = createHash("sha256").update(canonicalSnapshot(SNAPSHOT), "utf-8").digest("hex");
    expect(snapshotChecksum(SNAPSHOT)).toBe(expected);
  });
});

describe("validateSnapshotShape", () => {
  it("accepts strings and nulls", () => {
    expect(validateSnapshotShape({ "a.json": "X", "b.json": null }, "f")).toEqual({
      "a.json": "X", "b.json": null,
    });
  });

  it.each([
    ["an array", []],
    ["a string", "nope"],
    ["a number", 42],
    ["a boolean", true],
    ["null", null],
  ])("rejects %s as the document", (_label, value) => {
    const err = (() => { try { validateSnapshotShape(value, "f"); return null; } catch (e) { return e; } })();
    expect((err as ManifestInvalidError)?.reason).toBe("not-an-object");
  });

  it.each([
    ["a number", 1],
    ["an object", { nested: true }],
    ["an array", ["a"]],
    ["a boolean", false],
  ])("rejects an entry that is %s", (_label, entry) => {
    const err = (() => { try { validateSnapshotShape({ "a.json": entry }, "f"); return null; } catch (e) { return e; } })();
    expect((err as ManifestInvalidError)?.reason).toBe("bad-entry");
    expect((err as Error)?.message).toContain("a.json");
  });

  it.each(["../escape.json", "/etc/passwd", "a/../../b.json"])("rejects the unsafe key %s", (key) => {
    const err = (() => { try { validateSnapshotShape({ [key]: "X" }, "f"); return null; } catch (e) { return e; } })();
    expect((err as ManifestInvalidError)?.reason).toBe("unsafe-key");
  });

  it("does not repair or rewrite what it accepts", () => {
    const input = { "naval\\germany.json": "X" };
    expect(validateSnapshotShape(input, "f")).toBe(input);
  });
});

describe("legacy manifests stay readable", () => {
  it("reads a bare snapshot object with no envelope", async () => {
    writeRaw(JSON.stringify(SNAPSHOT, null, 2));
    const loaded = await readSnapshotManifest(manifestAt());

    expect(loaded.format).toBe("legacy");
    expect(loaded.snapshot).toEqual(SNAPSHOT);
    // No checksum is claimed where none exists.
    expect(loaded.checksum).toBeNull();
    expect(loaded.envelope).toBeNull();
  });

  it("reads legacy Windows keys without rewriting them", async () => {
    const legacy = { "naval\\germany.json": "G", "naval/italy.json": "I" };
    writeRaw(JSON.stringify(legacy));
    const loaded = await readSnapshotManifest(manifestAt());

    expect(loaded.snapshot).toEqual(legacy);
    expect(Object.keys(loaded.snapshot)).toContain("naval\\germany.json");
  });

  it("does not migrate the file it read", async () => {
    const body = JSON.stringify(SNAPSHOT, null, 2);
    writeRaw(body);
    await readSnapshotManifest(manifestAt());
    expect(fs.readFileSync(manifestAt(), "utf-8")).toBe(body);
  });

  it("every manifest already on disk still loads", async () => {
    // The real compatibility test: the 26 manifests from past promotions.
    // Read only — nothing here writes to storage/publish-snapshots.
    const root = path.resolve("storage/publish-snapshots");
    const found: string[] = [];
    const walk = (dir: string): void => {
      for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
        const p = path.join(dir, e.name);
        if (e.isDirectory()) walk(p);
        else if (e.name === "manifest.json") found.push(p);
      }
    };
    if (fs.existsSync(root)) walk(root);

    expect(found.length).toBeGreaterThan(0);
    for (const file of found) {
      const before = fs.readFileSync(file);
      const loaded = await readSnapshotManifest(file);
      expect(loaded.format).toBe("legacy");
      expect(Object.keys(loaded.snapshot).length).toBeGreaterThan(0);
      // Untouched by having been read.
      expect(fs.readFileSync(file).equals(before)).toBe(true);
    }
  });
});

describe("a missing manifest is not a corrupt one", () => {
  it("reports missing for a file that is not there", async () => {
    const err = await readSnapshotManifest(manifestAt()).catch((e: unknown) => e);
    expect((err as Error).name).toBe("ManifestMissingError");
    expect(err).toBeInstanceOf(ManifestMissingError);
  });

  it("reports unreadable, not missing, when the file is there but cannot be opened", async () => {
    writeRaw(JSON.stringify(SNAPSHOT));
    const realReadFile = jest.requireActual<typeof fsp>("fs/promises").readFile;
    jest.spyOn(fsp, "readFile").mockImplementation(((p: string, enc: unknown) => {
      if (String(p).endsWith("manifest.json")) {
        const e = new Error("EACCES: permission denied") as NodeJS.ErrnoException;
        e.code = "EACCES";
        return Promise.reject(e);
      }
      return realReadFile(p as never, enc as never);
    }) as never);

    const err = await readSnapshotManifest(manifestAt()).catch((e: unknown) => e);
    expect((err as Error).name).toBe("ManifestInvalidError");
    expect((err as ManifestInvalidError).reason).toBe("unreadable");
    expect((err as Error).message).toContain("EACCES");
  });
});

describe("damaged manifests are refused, never reinterpreted", () => {
  it("refuses a truncated write rather than parsing what survived", async () => {
    const whole = JSON.stringify({ ...SNAPSHOT }, null, 2);
    writeRaw(whole.slice(0, Math.floor(whole.length / 2)));

    const err = await readSnapshotManifest(manifestAt()).catch((e: unknown) => e);
    expect((err as ManifestInvalidError).reason).toBe("unparseable");
    expect((err as Error).message).toMatch(/interrupted write/);
  });

  it("refuses an empty object instead of restoring nothing", async () => {
    writeRaw("{}");
    const err = await readSnapshotManifest(manifestAt()).catch((e: unknown) => e);
    expect((err as ManifestInvalidError).reason).toBe("empty");
    expect((err as Error).message).toMatch(/reporting a completed rollback/);
  });

  it("refuses an empty envelope too", async () => {
    const empty = {
      formatVersion: SNAPSHOT_FORMAT_VERSION, kind: "promotion-snapshot",
      type: "armaments", runId: "r1", createdAt: new Date().toISOString(),
      algorithm: CHECKSUM_ALGORITHM, checksum: snapshotChecksum({}), snapshot: {},
    };
    writeRaw(JSON.stringify(empty));
    const err = await readSnapshotManifest(manifestAt()).catch((e: unknown) => e);
    expect((err as ManifestInvalidError).reason).toBe("empty");
  });

  it.each([
    ["an empty file", ""],
    ["whitespace", "   \n"],
    ["a bare array", "[]"],
    ["a bare string", '"hello"'],
    ["a bare number", "42"],
    ["JSON null", "null"],
  ])("refuses %s", async (_label, body) => {
    writeRaw(body);
    const err = await readSnapshotManifest(manifestAt()).catch((e: unknown) => e);
    expect((err as Error).name).toBe("ManifestInvalidError");
    expect(["unparseable", "not-an-object"]).toContain((err as ManifestInvalidError).reason);
  });

  it("refuses an entry that is not a string or null", async () => {
    writeRaw(JSON.stringify({ "a.json": "ok", "b.json": { nested: 1 } }));
    const err = await readSnapshotManifest(manifestAt()).catch((e: unknown) => e);
    expect((err as ManifestInvalidError).reason).toBe("bad-entry");
  });

  it("refuses a key that escapes the content directory", async () => {
    writeRaw(JSON.stringify({ "../../etc/passwd": "owned" }));
    const err = await readSnapshotManifest(manifestAt()).catch((e: unknown) => e);
    expect((err as ManifestInvalidError).reason).toBe("unsafe-key");
  });
});

describe("the envelope", () => {
  const envelopeOf = (overrides: Record<string, unknown> = {}, snapshot = SNAPSHOT) => ({
    formatVersion: SNAPSHOT_FORMAT_VERSION,
    kind: "promotion-snapshot",
    type: "armaments",
    runId: "run-1",
    createdAt: "2026-10-13T00:00:00.000Z",
    algorithm: CHECKSUM_ALGORITHM,
    checksum: snapshotChecksum(snapshot),
    snapshot,
    ...overrides,
  });

  it("round-trips through write and read", async () => {
    const report = await writeSnapshotManifest(manifestAt(), { type: "armaments", runId: "run-1" }, SNAPSHOT);
    expect(report.fileSynced).toBe(true);

    const loaded = await readSnapshotManifest(manifestAt());
    expect(loaded.format).toBe("envelope");
    expect(loaded.snapshot).toEqual(SNAPSHOT);
    expect(loaded.checksum).toBe(snapshotChecksum(SNAPSHOT));
    expect(loaded.envelope).toMatchObject({
      formatVersion: SNAPSHOT_FORMAT_VERSION,
      kind: "promotion-snapshot",
      type: "armaments",
      runId: "run-1",
      algorithm: CHECKSUM_ALGORITHM,
    });
  });

  it("rejects a payload edited after it was written", async () => {
    await writeSnapshotManifest(manifestAt(), { type: "armaments", runId: "run-1" }, SNAPSHOT);
    const doc = JSON.parse(fs.readFileSync(manifestAt(), "utf-8")) as Record<string, unknown>;
    (doc.snapshot as PromotionSnapshot)["naval/germany.json"] = "TAMPERED";
    writeRaw(JSON.stringify(doc));

    const err = await readSnapshotManifest(manifestAt()).catch((e: unknown) => e);
    expect((err as ManifestInvalidError).reason).toBe("checksum-mismatch");
    expect((err as Error).message).toMatch(/must not be used to restore anything/);
  });

  it("rejects a single flipped character in one value", async () => {
    // One byte, deep inside a value, with the recorded checksum left alone —
    // the shape of a bad sector rather than an edit.
    const original = SNAPSHOT["naval/germany.json"] as string;
    const flipped = original.replace("records", "recordz");
    expect(flipped).not.toBe(original);
    expect(flipped.length).toBe(original.length); // exactly one byte differs

    writeRaw(JSON.stringify(envelopeOf(
      { checksum: snapshotChecksum(SNAPSHOT) },
      { ...SNAPSHOT, "naval/germany.json": flipped },
    )));

    const err = await readSnapshotManifest(manifestAt()).catch((e: unknown) => e);
    expect((err as ManifestInvalidError).reason).toBe("checksum-mismatch");
  });

  it("rejects a dropped entry even though the rest is valid", async () => {
    const { "index.json": _gone, ...fewer } = SNAPSHOT;
    writeRaw(JSON.stringify(envelopeOf({ checksum: snapshotChecksum(SNAPSHOT) }, fewer)));
    const err = await readSnapshotManifest(manifestAt()).catch((e: unknown) => e);
    expect((err as ManifestInvalidError).reason).toBe("checksum-mismatch");
  });

  it("accepts a consistent re-serialisation in a different key order", async () => {
    // The canonical form sorts, so re-saving the same data must still verify.
    const reordered: PromotionSnapshot = {
      "index.json": SNAPSHOT["index.json"],
      "naval/romania.json": SNAPSHOT["naval/romania.json"],
      "naval/germany.json": SNAPSHOT["naval/germany.json"],
    };
    writeRaw(JSON.stringify(envelopeOf({}, reordered)));
    const loaded = await readSnapshotManifest(manifestAt());
    expect(loaded.format).toBe("envelope");
    expect(loaded.snapshot).toEqual(SNAPSHOT);
  });

  it.each([
    ["an unknown future version", { formatVersion: 2 }, /formatVersion is 2/],
    ["the wrong kind", { kind: "something-else" }, /kind is/],
    ["an unexpected algorithm", { algorithm: "md5" }, /algorithm is/],
    ["a malformed checksum", { checksum: "not-a-digest" }, /64-character/],
    ["an uppercase checksum", { checksum: "A".repeat(64) }, /64-character/],
    ["a missing runId", { runId: "" }, /runId is missing/],
    ["a non-string type", { type: 7 }, /type is missing/],
  ])("refuses %s", async (_label, overrides, pattern) => {
    writeRaw(JSON.stringify(envelopeOf(overrides)));
    const err = await readSnapshotManifest(manifestAt()).catch((e: unknown) => e);
    expect((err as ManifestInvalidError).reason).toBe("bad-envelope");
    expect((err as Error).message).toMatch(pattern as RegExp);
  });

  it("never falls back to reading a broken envelope as a legacy snapshot", async () => {
    // The dangerous silent path: a damaged envelope must not be reinterpreted
    // as a bare object whose keys happen to be "formatVersion", "kind", …
    writeRaw(JSON.stringify(envelopeOf({ formatVersion: 99 })));
    const err = await readSnapshotManifest(manifestAt()).catch((e: unknown) => e);
    expect((err as ManifestInvalidError).reason).toBe("bad-envelope");
    expect((err as ManifestInvalidError).reason).not.toBe("legacy");
  });

  it("refuses a document that has a snapshot field but no envelope around it", async () => {
    writeRaw(JSON.stringify({ snapshot: SNAPSHOT }));
    const err = await readSnapshotManifest(manifestAt()).catch((e: unknown) => e);
    expect((err as ManifestInvalidError).reason).toBe("bad-envelope");
  });
});

describe("writing is atomic", () => {
  it("leaves no temporary file behind on success", async () => {
    await writeSnapshotManifest(manifestAt(), { type: "armaments", runId: "r1" }, SNAPSHOT);
    expect(fs.readdirSync(tmp)).toEqual(["manifest.json"]);
  });

  it("leaves the previous manifest untouched when the write fails", async () => {
    await writeSnapshotManifest(manifestAt(), { type: "armaments", runId: "r1" }, SNAPSHOT);
    const before = fs.readFileSync(manifestAt(), "utf-8");

    const realRename = jest.requireActual<typeof fsp>("fs/promises").rename;
    jest.spyOn(fsp, "rename").mockImplementation(((from: string, to: string) => {
      if (String(to).endsWith("manifest.json")) return Promise.reject(new Error("EIO on rename"));
      return realRename(from, String(to));
    }) as never);

    await expect(
      writeSnapshotManifest(manifestAt(), { type: "armaments", runId: "r2" }, { "other.json": "NEW" }),
    ).rejects.toThrow("EIO on rename");

    jest.restoreAllMocks();
    expect(fs.readFileSync(manifestAt(), "utf-8")).toBe(before);
    // And the half-written temp file was cleaned up, not left as litter.
    expect(fs.readdirSync(tmp)).toEqual(["manifest.json"]);
  });

  it("writes no manifest at all when the bytes cannot be flushed", async () => {
    const realOpen = jest.requireActual<typeof fsp>("fs/promises").open;
    jest.spyOn(fsp, "open").mockImplementation((async (p: string, flags: unknown) => {
      const handle = await realOpen(p as never, flags as never);
      if (String(p).includes(".tmp-")) {
        return Object.assign(Object.create(Object.getPrototypeOf(handle)), handle, {
          writeFile: handle.writeFile.bind(handle),
          sync: () => Promise.reject(new Error("EIO on fsync")),
          close: handle.close.bind(handle),
        });
      }
      return handle;
    }) as never);

    await expect(
      writeSnapshotManifest(manifestAt(), { type: "armaments", runId: "r1" }, SNAPSHOT),
    ).rejects.toThrow("EIO on fsync");

    jest.restoreAllMocks();
    expect(fs.existsSync(manifestAt())).toBe(false);
    expect(fs.readdirSync(tmp)).toEqual([]);
  });

  it("replaces an existing manifest completely, never merging into it", async () => {
    await writeSnapshotManifest(manifestAt(), { type: "armaments", runId: "r1" }, SNAPSHOT);
    await writeSnapshotManifest(manifestAt(), { type: "armaments", runId: "r2" }, { "only.json": "X" });

    const loaded = await readSnapshotManifest(manifestAt());
    expect(loaded.snapshot).toEqual({ "only.json": "X" });
    expect(loaded.envelope?.runId).toBe("r2");
  });

  it("refuses to write a snapshot it would not be able to read back", async () => {
    await expect(
      writeSnapshotManifest(manifestAt(), { type: "armaments", runId: "r1" },
        { "../escape.json": "X" } as PromotionSnapshot),
    ).rejects.toBeInstanceOf(ManifestInvalidError);
    expect(fs.existsSync(manifestAt())).toBe(false);
  });

  it("creates the snapshot directory when it does not exist yet", async () => {
    const nested = path.join(tmp, "armaments", "run-1", "manifest.json");
    await writeSnapshotManifest(nested, { type: "armaments", runId: "run-1" }, SNAPSHOT);
    expect((await readSnapshotManifest(nested)).snapshot).toEqual(SNAPSHOT);
  });
});

describe("durability, reported as achieved rather than as intended", () => {
  it("always flushes the file's own bytes before the rename", async () => {
    const report = await writeSnapshotManifest(manifestAt(), { type: "a", runId: "r" }, SNAPSHOT);
    expect(report.fileSynced).toBe(true);
  });

  it("reports whether the directory entry was flushed, and why not", async () => {
    const report = await writeSnapshotManifest(manifestAt(), { type: "a", runId: "r" }, SNAPSHOT);

    if (process.platform === "win32") {
      // Measured on this host, not assumed: Node cannot open a directory for
      // the handle fsync needs, so the rename is atomic but its durability
      // is left to NTFS's own metadata journalling.
      expect(report.directorySynced).toBe(false);
      expect(report.directorySyncSkipped).toContain("win32");
      expect(report.directorySyncSkipped).toMatch(/EPERM|EISDIR|EACCES|EBADF/);
    } else {
      expect(report.directorySynced).toBe(true);
      expect(report.directorySyncSkipped).toBeUndefined();
    }
  });

  it("the manifest is still written and readable when the directory cannot be flushed", async () => {
    // A durability gap must not become a correctness gap.
    const report = await writeSnapshotManifest(manifestAt(), { type: "a", runId: "r" }, SNAPSHOT);
    expect((await readSnapshotManifest(manifestAt())).snapshot).toEqual(SNAPSHOT);
    expect(report.fileSynced).toBe(true);
  });

  it("documents the platform this ran on", () => {
    // So a green run on Windows is never mistaken for a green run on Linux.
    expect(["win32", "linux", "darwin"]).toContain(process.platform);
    console.log(`[durability] platform=${process.platform} directory-fsync=${
      process.platform === "win32" ? "UNSUPPORTED" : "supported"}`);
  });
});

describe("how a bad rollback target is reported", () => {
  it("still says 'no snapshot found' when there genuinely is none", () => {
    const err = rollbackTargetError("armaments", "run-x", new ManifestMissingError("/p/manifest.json"));
    expect(err).toBeInstanceOf(AppError);
    expect(err.statusCode).toBe(404);
    // Unchanged wording: this case did not change, so the Admin must not
    // start showing something different for it.
    expect(err.message).toBe('No snapshot found for runId "run-x" — cannot roll back.');
  });

  it("says the manifest exists but is unusable when it is damaged", () => {
    const err = rollbackTargetError(
      "armaments", "run-x",
      new ManifestInvalidError("checksum-mismatch", "/p/manifest.json", "recorded abc…, computed def…"),
    );
    expect(err.statusCode).toBe(409);
    expect(err.message).toContain("exists but");
    expect(err.message).toContain("checksum-mismatch");
    expect(err.message).toContain("Nothing was changed.");
    expect(err.message).not.toContain("No snapshot found");
  });

  it.each([
    "unreadable", "unparseable", "not-an-object", "bad-entry",
    "unsafe-key", "empty", "bad-envelope", "checksum-mismatch",
  ] as const)("names the reason '%s' so the operator knows what to look at", (reason) => {
    const err = rollbackTargetError("armaments", "r", new ManifestInvalidError(reason, "/p", "detail"));
    expect(err.statusCode).toBe(409);
    expect(err.message).toContain(reason);
  });

  it("does not disguise an unexpected failure as a missing manifest", () => {
    const err = rollbackTargetError("armaments", "r", new Error("something else entirely"));
    expect(err.statusCode).toBe(500);
    expect(err.message).toContain("something else entirely");
    expect(err.message).toContain("Nothing was changed.");
  });
});

describe("an invalid target changes nothing at all", () => {
  it("leaves files, the version pointer, versions and history untouched", async () => {
    // A full publication surface, then a rejected load, then a check that
    // every durable thing is byte-identical.
    const content = path.join(tmp, "public-data");
    fs.mkdirSync(path.join(content, "armaments", "naval"), { recursive: true });
    fs.writeFileSync(path.join(content, "armaments", "naval", "germany.json"), "LIVE", "utf-8");
    fs.writeFileSync(path.join(content, "armaments", "index.json"), '{"categories":[]}', "utf-8");

    const store = createVersionStore(path.join(tmp, "published"));
    const v1 = await store.createVersionFrom(content);
    await store.writeActiveVersion(v1);

    const historyFile = path.join(tmp, "history.json");
    fs.writeFileSync(historyFile, JSON.stringify([{ runId: "old" }]), "utf-8");

    const snapshotOf = (): Record<string, string> => {
      const out: Record<string, string> = {};
      const walk = (dir: string): void => {
        for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
          const p = path.join(dir, e.name);
          if (e.isDirectory()) walk(p);
          else out[path.relative(tmp, p)] = fs.readFileSync(p, "utf-8");
        }
      };
      walk(tmp);
      return out;
    };

    const before = snapshotOf();
    const pointerBefore = fs.readFileSync(store.pointerFile, "utf-8");
    const versionsBefore = await store.listVersions();

    for (const body of ["{}", "[]", "not json at all", '{"a.json":{"x":1}}', '{"../e.json":"X"}']) {
      const target = path.join(tmp, "bad-manifest.json");
      fs.writeFileSync(target, body, "utf-8");
      await expect(readSnapshotManifest(target)).rejects.toBeInstanceOf(ManifestInvalidError);
      fs.rmSync(target);
    }
    await expect(readSnapshotManifest(path.join(tmp, "absent.json")))
      .rejects.toBeInstanceOf(ManifestMissingError);

    expect(snapshotOf()).toEqual(before);
    expect(fs.readFileSync(store.pointerFile, "utf-8")).toBe(pointerBefore);
    expect(await store.listVersions()).toEqual(versionsBefore);
    expect(fs.readFileSync(historyFile, "utf-8")).toBe(JSON.stringify([{ runId: "old" }]));
  });
});

describe("rollback validates its target before touching anything", () => {
  const source = fs.readFileSync(path.resolve(__dirname, "../promotion.service.ts"), "utf-8");
  const body = source.slice(
    source.indexOf("private async rollbackLocked("),
    source.indexOf("  }\n}", source.indexOf("private async rollbackLocked(")),
  );

  it("loads and validates through the checked reader", () => {
    expect(body).toContain("await readSnapshotManifest(manifestPath(type, targetRunId))");
    expect(body).toContain("throw rollbackTargetError(type, targetRunId, err);");
  });

  it("does so before the pre-rollback capture and before the first write", () => {
    const load = body.indexOf("readSnapshotManifest");
    expect(load).toBeGreaterThan(-1);
    expect(load).toBeLessThan(body.indexOf("captureCurrentState"));
    expect(load).toBeLessThan(body.indexOf("restoreFromSnapshot"));
  });

  it("does so before the pointer, pruning, history and the audit row", () => {
    const load = body.indexOf("readSnapshotManifest");
    expect(load).toBeLessThan(body.indexOf("captureAndActivateVersion"));
    expect(load).toBeLessThan(body.indexOf("pruneVersions"));
    expect(load).toBeLessThan(body.indexOf("appendHistory"));
  });

  it("promotion persists through the checksummed atomic writer", () => {
    expect(source).toContain("await writeSnapshotManifest(manifestPath(type, runId), { type, runId }, snapshot)");
    // The bare, non-atomic write is gone.
    expect(source).not.toContain('fs.writeFile(path.join(dir, "manifest.json")');
  });
});
