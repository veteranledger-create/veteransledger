import fs from "fs";
import fsp from "fs/promises";
import os from "os";
import path from "path";
import {
  beginStagingRun,
  completeStagingRun,
  readStagingProvenance,
  compareStagedDirectory,
  assertStagingPromotable,
  fingerprintOutput,
  fingerprintSource,
  provenancePath,
  StagingProvenanceError,
  SourceFingerprint,
  STAGING_PROVENANCE_VERSION,
} from "../staging-provenance";

/**
 * P1 — staged output must prove which publish run produced it, and from
 * what source.
 *
 * The defect, on disk today: storage/publish-reports/awards/latest.json
 * records a successful run with recordsChecked 0 and staged [], while
 * storage/publish-staging/awards/ still holds temp-fixture-award.json from
 * an earlier run. writeStagedFilesAtomically leaves a directory untouched
 * when a run generates nothing, and promote() reads the directory without
 * ever consulting the report. Promoting it would write the fixture into
 * public/data, where the index regenerator — which scans the directory,
 * not the report — would publish it as a real award.
 *
 * Everything here runs against throwaway directories. No publish, no
 * promotion, no database, and the real staging directories are not read or
 * written by any test in this file.
 */

let tmp: string;
let stagingRoot: string;
let typeDir: string;

const TYPE = "awards";
const RUN = "run-1";

const DB: SourceFingerprint = fingerprintSource("database", [
  ["rec-a", '["2026-10-01T00:00:00.000Z",[]]'],
  ["rec-b", '["2026-10-02T00:00:00.000Z",[]]'],
]);
const FILES: SourceFingerprint = fingerprintSource("files", [["overview.json", "a".repeat(64)]]);

const staged = (entries: Record<string, string>): Map<string, string> => new Map(Object.entries(entries));
const OUTPUT = staged({ "naval/germany.json": "GERMANY", "index.json": "INDEX" });

const file = (): string => provenancePath(stagingRoot, TYPE);
const stageOnDisk = (rel: string, content: string): void => {
  const p = path.join(typeDir, rel);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, content, "utf-8");
};

/** A completed run: provenance written after the directory is in place. */
async function publishRun(
  files: Map<string, string> = OUTPUT,
  source: SourceFingerprint = DB,
): Promise<void> {
  const startedAt = new Date().toISOString();
  await beginStagingRun(file(), { type: TYPE, runId: RUN, source, startedAt });
  for (const [rel, content] of files) stageOnDisk(rel, content);
  await completeStagingRun(file(), {
    type: TYPE, runId: RUN, source, startedAt, intendedFiles: fingerprintOutput(files),
  });
}

const promotable = (
  actual: Map<string, string>,
  recompute: () => Promise<SourceFingerprint> = async () => DB,
): Promise<unknown> =>
  assertStagingPromotable({
    type: TYPE, provenanceFile: file(), staged: actual, recomputeSource: recompute,
  });

const refusal = async (p: Promise<unknown>): Promise<StagingProvenanceError> =>
  p.then(() => { throw new Error("expected a refusal"); }, (e: unknown) => e as StagingProvenanceError);

beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "vl-prov-"));
  stagingRoot = path.join(tmp, "publish-staging");
  typeDir = path.join(stagingRoot, TYPE);
  fs.mkdirSync(typeDir, { recursive: true });
});
afterEach(() => {
  jest.restoreAllMocks();
  fs.rmSync(tmp, { recursive: true, force: true });
});

describe("fingerprints", () => {
  it("is independent of source ordering", () => {
    const a = fingerprintSource("database", [["x", "1"], ["y", "2"]]);
    const b = fingerprintSource("database", [["y", "2"], ["x", "1"]]);
    expect(a.digest).toBe(b.digest);
    expect(a.count).toBe(2);
  });

  it("changes on an insert, an update and a delete", () => {
    const base = fingerprintSource("database", [["x", "1"], ["y", "2"]]).digest;
    expect(fingerprintSource("database", [["x", "1"], ["y", "2"], ["z", "3"]]).digest).not.toBe(base);
    expect(fingerprintSource("database", [["x", "1"], ["y", "CHANGED"]]).digest).not.toBe(base);
    expect(fingerprintSource("database", [["x", "1"]]).digest).not.toBe(base);
  });

  it("distinguishes a database source from a file source", () => {
    expect(fingerprintSource("database", [["x", "1"]]).kind).toBe("database");
    expect(fingerprintSource("files", [["x", "1"]]).kind).toBe("files");
  });

  it("stores portable relative keys for output", () => {
    const out = fingerprintOutput(new Map([["naval\\germany.json", "X"]]));
    expect(Object.keys(out)).toEqual(["naval/germany.json"]);
    expect(out["naval/germany.json"]).toMatch(/^[0-9a-f]{64}$/);
  });

  it("records an empty intended output as empty, not absent", () => {
    expect(fingerprintOutput(new Map())).toEqual({});
  });
});

describe("comparing a directory against the intended output", () => {
  const intended = fingerprintOutput(OUTPUT);

  it("matches an untouched directory", () => {
    expect(compareStagedDirectory(intended, OUTPUT)).toEqual({
      added: [], missing: [], modified: [], matched: true,
    });
  });

  it("detects a file added after the run", () => {
    const actual = staged({ ...Object.fromEntries(OUTPUT), "stowaway.json": "X" });
    expect(compareStagedDirectory(intended, actual)).toMatchObject({
      added: ["stowaway.json"], missing: [], modified: [], matched: false,
    });
  });

  it("detects a missing file", () => {
    expect(compareStagedDirectory(intended, staged({ "index.json": "INDEX" }))).toMatchObject({
      added: [], missing: ["naval/germany.json"], modified: [], matched: false,
    });
  });

  it("detects a file modified in place", () => {
    const actual = staged({ "naval/germany.json": "TAMPERED", "index.json": "INDEX" });
    expect(compareStagedDirectory(intended, actual)).toMatchObject({
      added: [], missing: [], modified: ["naval/germany.json"], matched: false,
    });
  });

  it("reports all three at once", () => {
    const actual = staged({ "naval/germany.json": "TAMPERED", "extra.json": "X" });
    const result = compareStagedDirectory(intended, actual);
    expect(result).toMatchObject({
      added: ["extra.json"], missing: ["index.json"], modified: ["naval/germany.json"], matched: false,
    });
  });

  it("THE DEFECT: an empty intended output against a leftover file", () => {
    // Exactly the awards/maps/political-docs state.
    const result = compareStagedDirectory({}, staged({ "temp-fixture-award.json": "{...}" }));
    expect(result.added).toEqual(["temp-fixture-award.json"]);
    expect(result.matched).toBe(false);
  });

  it("an empty intended output against an empty directory matches", () => {
    expect(compareStagedDirectory({}, new Map()).matched).toBe(true);
  });
});

describe("the record round-trips and is verified", () => {
  it("reads back everything it wrote", async () => {
    await publishRun();
    const record = await readStagingProvenance(file(), TYPE);

    expect(record).toMatchObject({
      formatVersion: STAGING_PROVENANCE_VERSION,
      kind: "staging-provenance",
      type: TYPE, runId: RUN, complete: true,
    });
    expect(record.source).toEqual(DB);
    expect(record.intendedFiles).toEqual(fingerprintOutput(OUTPUT));
    expect(record.completedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it("lives beside the staging directory, never inside it", async () => {
    await publishRun();
    // Inside would be promoted into public/data by listFilesRecursive, and
    // destroyed by the directory's own rm+rename.
    expect(file()).toBe(path.join(stagingRoot, "awards.provenance.json"));
    expect(fs.readdirSync(typeDir).sort()).toEqual(["index.json", "naval"]);
  });

  it("rejects a record edited after it was written", async () => {
    await publishRun();
    const doc = JSON.parse(fs.readFileSync(file(), "utf-8")) as Record<string, unknown>;
    (doc.intendedFiles as Record<string, string>)["smuggled.json"] = "a".repeat(64);
    fs.writeFileSync(file(), JSON.stringify(doc), "utf-8");

    expect((await refusal(readStagingProvenance(file(), TYPE))).reason).toBe("checksum-mismatch");
  });

  it.each([
    ["a truncated record", () => { const w = fs.readFileSync(file(), "utf-8"); fs.writeFileSync(file(), w.slice(0, 40)); }, "unparseable"],
    ["an array", () => fs.writeFileSync(file(), "[]"), "not-an-object"],
    ["an unknown version", () => patch({ formatVersion: 2 }), "bad-envelope"],
    ["the wrong kind", () => patch({ kind: "something-else" }), "bad-envelope"],
    ["a bad algorithm", () => patch({ algorithm: "md5" }), "bad-envelope"],
    ["a missing runId", () => patch({ runId: "" }), "bad-envelope"],
    ["a non-boolean complete", () => patch({ complete: "yes" }), "bad-envelope"],
    ["a missing source", () => patch({ source: null }), "bad-envelope"],
    ["an unknown source kind", () => patch({ source: { ...DB, kind: "guesswork" } }), "bad-envelope"],
    ["a malformed source digest", () => patch({ source: { ...DB, digest: "nope" } }), "bad-envelope"],
    ["a malformed file digest", () => patch({ intendedFiles: { "a.json": "nope" } }), "bad-envelope"],
  ])("refuses %s", async (_label, corrupt, reason) => {
    await publishRun();
    corrupt();
    expect((await refusal(readStagingProvenance(file(), TYPE))).reason).toBe(reason);
  });

  function patch(fields: Record<string, unknown>): void {
    const doc = JSON.parse(fs.readFileSync(file(), "utf-8")) as Record<string, unknown>;
    fs.writeFileSync(file(), JSON.stringify({ ...doc, ...fields }), "utf-8");
  }

  it("refuses a record describing a different type", async () => {
    await publishRun();
    const err = await refusal(readStagingProvenance(file(), "maps"));
    expect(err.reason).toBe("type-mismatch");
    expect(err.message).toContain("awards");
  });

  it("refuses when there is no record at all", async () => {
    const err = await refusal(readStagingProvenance(file(), TYPE));
    expect(err.reason).toBe("missing");
    expect(err.message).toMatch(/Re-publish this type/);
  });

  it("refuses an unreadable record rather than treating it as absent", async () => {
    await publishRun();
    const realReadFile = jest.requireActual<typeof fsp>("fs/promises").readFile;
    jest.spyOn(fsp, "readFile").mockImplementation(((p: string, enc: unknown) => {
      if (String(p).endsWith("awards.provenance.json")) {
        const e = new Error("EACCES: permission denied") as NodeJS.ErrnoException;
        e.code = "EACCES";
        return Promise.reject(e);
      }
      return realReadFile(p as never, enc as never);
    }) as never);

    const err = await refusal(readStagingProvenance(file(), TYPE));
    expect(err.reason).toBe("unreadable");
    expect(err.message).toContain("EACCES");
  });
});

describe("the full gate", () => {
  it("permits a directory that matches its record and its source", async () => {
    await publishRun();
    await expect(promotable(OUTPUT)).resolves.toMatchObject({ runId: RUN, complete: true });
  });

  it("THE DEFECT: refuses a leftover file when the run intended nothing", async () => {
    // awards today: the run produced nothing, the directory kept a fixture.
    await publishRun(new Map());
    stageOnDisk("temp-fixture-award.json", '{"id":"temp-fixture-award"}');

    const err = await refusal(promotable(staged({ "temp-fixture-award.json": '{"id":"temp-fixture-award"}' })));
    expect(err.reason).toBe("files-differ");
    expect(err.message).toContain("temp-fixture-award.json");
    expect(err.message).toContain("not part of the intended output");
    expect(err.message).toContain("intended 0 file(s)");
    expect(err.message).toContain("awards");
  });

  it("names the type and the specific discrepancy", async () => {
    await publishRun();
    const err = await refusal(promotable(staged({ "naval/germany.json": "GERMANY" })));
    expect(err.type).toBe("awards");
    expect(err.message).toContain("index.json");
    expect(err.message).toMatch(/missing from staging/);
  });

  it("refuses a stale source, naming both digests", async () => {
    await publishRun();
    const moved = fingerprintSource("database", [["rec-a", '["2026-12-25T00:00:00.000Z",[]]']]);

    const err = await refusal(promotable(OUTPUT, async () => moved));
    expect(err.reason).toBe("source-changed");
    expect(err.message).toMatch(/the source has changed since publish run run-1/);
    expect(err.message).toContain(DB.digest.slice(0, 12));
    expect(err.message).toContain(moved.digest.slice(0, 12));
  });

  it("refuses when the source cannot be read, rather than assuming it is unchanged", async () => {
    await publishRun();
    const err = await refusal(promotable(OUTPUT, () => Promise.reject(new Error("ECONNREFUSED 5432"))));
    expect(err.reason).toBe("source-unavailable");
    expect(err.message).toContain("ECONNREFUSED");
    expect(err.message).toMatch(/refuses rather than assuming/);
  });

  it("checks the files before reaching for the source", async () => {
    // A plainly wrong directory is refused without a database round trip.
    await publishRun();
    let consulted = false;
    const err = await refusal(promotable(staged({ "wrong.json": "X" }), async () => {
      consulted = true; return DB;
    }));
    expect(err.reason).toBe("files-differ");
    expect(consulted).toBe(false);
  });

  it("never consults a database for a filesystem-backed source", async () => {
    await publishRun(OUTPUT, FILES);
    let kindAsked: string | null = null;
    await expect(
      assertStagingPromotable({
        type: TYPE, provenanceFile: file(), staged: OUTPUT,
        recomputeSource: async (kind) => { kindAsked = kind; return FILES; },
      }),
    ).resolves.toBeDefined();
    expect(kindAsked).toBe("files");
  });

  it("refuses if the source kind itself changed", async () => {
    await publishRun(OUTPUT, DB);
    const err = await refusal(promotable(OUTPUT, async () => ({ ...FILES })));
    expect(err.reason).toBe("source-changed");
  });

  it("offers no bypass", () => {
    const source = fs.readFileSync(path.resolve(__dirname, "../staging-provenance.ts"), "utf-8");
    for (const bypass of ["process.env", "force", "skipProvenance", "allowUnverified", "|| true"]) {
      expect(source).not.toContain(bypass);
    }
  });
});

describe("the write sequence fails closed", () => {
  it("a run interrupted before the directory is replaced leaves no valid record", async () => {
    await publishRun();                       // a good previous run
    await expect(promotable(OUTPUT)).resolves.toBeDefined();

    // A new run begins and dies before writing anything.
    await beginStagingRun(file(), { type: TYPE, runId: "run-2", source: DB });

    const err = await refusal(promotable(OUTPUT));
    expect(err.reason).toBe("incomplete");
    expect(err.message).toContain("run-2");
    expect(err.message).toMatch(/did not record completion/);
  });

  it("a run interrupted AFTER the directory is replaced still refuses", async () => {
    // The dangerous window: new content on disk, completion never recorded.
    // The previous run's record must not authorise it.
    await publishRun();
    await beginStagingRun(file(), { type: TYPE, runId: "run-2", source: DB });
    fs.rmSync(typeDir, { recursive: true, force: true });
    stageOnDisk("brand-new.json", "NEW CONTENT");

    const err = await refusal(promotable(staged({ "brand-new.json": "NEW CONTENT" })));
    expect(err.reason).toBe("incomplete");
    expect(err.message).toContain("run-2");
  });

  it("the stale record cannot survive to validate the new content", async () => {
    await publishRun();
    const before = fs.readFileSync(file(), "utf-8");
    await beginStagingRun(file(), { type: TYPE, runId: "run-2", source: DB });
    // The previous record is gone, not merely shadowed.
    expect(fs.readFileSync(file(), "utf-8")).not.toBe(before);
    expect(JSON.parse(fs.readFileSync(file(), "utf-8")).complete).toBe(false);
  });

  it("a failed provenance write leaves no partial record", async () => {
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
      beginStagingRun(file(), { type: TYPE, runId: RUN, source: DB }),
    ).rejects.toThrow("EIO on fsync");

    jest.restoreAllMocks();
    expect(fs.existsSync(file())).toBe(false);
    expect(fs.readdirSync(stagingRoot).filter((n) => n.startsWith(".tmp-"))).toEqual([]);
  });

  it("completion replaces the started record atomically", async () => {
    await publishRun();
    expect(fs.readdirSync(stagingRoot).sort()).toEqual(["awards", "awards.provenance.json"]);
  });

  it("a second completed run supersedes the first", async () => {
    await publishRun();
    const next = staged({ "only.json": "ONLY" });
    fs.rmSync(typeDir, { recursive: true, force: true });
    const startedAt = new Date().toISOString();
    await beginStagingRun(file(), { type: TYPE, runId: "run-2", source: DB, startedAt });
    for (const [rel, content] of next) stageOnDisk(rel, content);
    await completeStagingRun(file(), {
      type: TYPE, runId: "run-2", source: DB, startedAt, intendedFiles: fingerprintOutput(next),
    });

    const record = await readStagingProvenance(file(), TYPE);
    expect(record.runId).toBe("run-2");
    expect(Object.keys(record.intendedFiles)).toEqual(["only.json"]);
    await expect(promotable(next)).resolves.toBeDefined();
  });
});

describe("the promotion path is gated before any public-content write", () => {
  // The ordering inside promoteLocked, which cannot be executed with
  // PROMOTION_ENABLED false. The gate's behaviour is proven above on real
  // files; this pins that the method applies it in the right place.
  const source = fs.readFileSync(path.resolve(__dirname, "../promotion.service.ts"), "utf-8");
  const body = source.slice(
    source.indexOf("private async promoteLocked("),
    source.indexOf("private async rollbackLocked("),
  );

  it("validates provenance before the first file apply", () => {
    const gate = body.indexOf("assertStagingPromotable");
    expect(gate).toBeGreaterThan(-1);
    // The call site, not any textual mention: the method comments on it too.
    expect(gate).toBeLessThan(body.indexOf("await promoteFilesAtomically(targetDir, staged)"));
  });

  it("and therefore before pruning, index regeneration, the manifest and activation", () => {
    const gate = body.indexOf("assertStagingPromotable");
    for (const later of [
      "findOrphanedOtherAxisFiles", "findOrphanedRootJsonFiles", "regenerateIndex",
      "persistSnapshotManifest", "captureAndActivateVersion",
    ]) {
      expect(gate).toBeLessThan(body.indexOf(later));
    }
  });

  it("refuses through abortBeforeAnyWrite, preserving its guarantee", () => {
    const block = body.slice(
      body.indexOf("assertStagingPromotable"),
      body.indexOf("await promoteFilesAtomically(targetDir, staged)"),
    );
    expect(block).toContain('abortBeforeAnyWrite("content", err as Error, targetDir)');
  });

  it("recomputes the source through the publish service's own loader", () => {
    expect(body).toContain("new PublishService().sourceFingerprint(type)");
  });

  it("leaves the existing empty-staging and PROMOTION_ENABLED checks intact", () => {
    expect(body).toContain('No staged files found for type "${type}" — run a publish first.');
    expect(source).toContain("const PROMOTION_ENABLED = false;");
    expect(source).toContain("if (!PROMOTION_ENABLED || confirmPromotion !== true)");
  });
});

describe("publish records provenance in the right order", () => {
  const source = fs.readFileSync(path.resolve(__dirname, "../publish.service.ts"), "utf-8");
  const run = source.slice(source.indexOf("async run(type: string"), source.indexOf("}\n}"));

  it("fingerprints the source before the generator reads it", () => {
    expect(run.indexOf("await this.sourceFingerprint(type)")).toBeLessThan(run.indexOf("loadAndCheck"));
  });

  it("invalidates before replacing the directory, and completes after", () => {
    const begin = run.indexOf("beginStagingRun");
    const write = run.indexOf("writeStagedFilesAtomically");
    const done = run.indexOf("completeStagingRun");
    expect(begin).toBeGreaterThan(-1);
    expect(begin).toBeLessThan(write);
    expect(write).toBeLessThan(done);
  });

  it("records the intended output from the generated set, not from the directory", () => {
    expect(run).toContain("intendedFiles: fingerprintOutput(filesToWrite)");
  });
});
