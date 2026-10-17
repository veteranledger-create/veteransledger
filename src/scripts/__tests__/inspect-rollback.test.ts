import { createHash } from "crypto";
import fs from "fs";
import fsp from "fs/promises";
import os from "os";
import path from "path";
import {
  inspectRollbackRun,
  listRollbackRuns,
  formatInspection,
  RollbackInspection,
} from "../inspect-rollback";
import {
  writeRecoveryPoint,
  writeWriteMarker,
  writeCompletion,
  recoveryPointPath,
  writeMarkerPath,
  completionPath,
} from "../../modules/publish/rollback-recovery";
import { writeSnapshotManifest } from "../../modules/publish/snapshot-manifest";
import { createVersionStore, VersionStore } from "../../modules/publish/version-store";
import { PromotionSnapshot } from "../../modules/publish/promote-atomic";

/**
 * R8 Stage 3 — the inspection command.
 *
 * Markers alone cannot say whether an interrupted rollback wrote anything:
 * "writing" means only that writes were about to begin. What answers it is
 * comparing the live files against the two states the rollback sits between.
 * That is pure reading, and this command does nothing else — proven below by
 * hashing every file in the tree before and after.
 */

const TYPE = "armaments";
const TARGET_RUN = "target-run";
const RUN = "rollback-run";

let tmp: string;
let contentDir: string;
let snapshotsRoot: string;
let runDir: string;
let store: VersionStore;

const TARGET: PromotionSnapshot = {
  "naval/germany.json": "ARCHIVED GERMANY",
  "naval/italy.json": "ARCHIVED ITALY",
  "naval/romania.json": null,
  "index.json": "ARCHIVED INDEX",
};
const BEFORE: PromotionSnapshot = {
  "naval/germany.json": "LIVE GERMANY",
  "naval/italy.json": "LIVE ITALY",
  "naval/romania.json": "LIVE ROMANIA",
  "index.json": "LIVE INDEX",
};

const liveWrite = (rel: string, content: string | null): void => {
  const p = path.join(contentDir, rel);
  if (content === null) { fs.rmSync(p, { force: true }); return; }
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, content, "utf-8");
};

const inspect = (runId = RUN): Promise<RollbackInspection> =>
  inspectRollbackRun(TYPE, runId, { snapshotsRoot, contentDir, store });

/** Every file in the tree, by path, with its sha256 and mtime. */
function fingerprint(root: string): Map<string, string> {
  const out = new Map<string, string>();
  const walk = (dir: string): void => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) { walk(p); continue; }
      const stat = fs.statSync(p);
      out.set(
        path.relative(root, p),
        `${createHash("sha256").update(fs.readFileSync(p)).digest("hex")}:${stat.size}:${stat.mtimeMs}`,
      );
    }
  };
  walk(root);
  return out;
}

async function seedCaptured(): Promise<string> {
  for (const [rel, content] of Object.entries(BEFORE)) liveWrite(rel, content);
  await writeSnapshotManifest(
    path.join(snapshotsRoot, TYPE, TARGET_RUN, "manifest.json"),
    { type: TYPE, runId: TARGET_RUN }, TARGET,
  );
  const { checksum } = await writeRecoveryPoint(recoveryPointPath(runDir), {
    type: TYPE, runId: RUN, restoredFromRunId: TARGET_RUN, activeVersionAtCapture: null,
  }, BEFORE);
  return checksum;
}

beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "vl-inspect-"));
  contentDir = path.join(tmp, "public-data", TYPE);
  snapshotsRoot = path.join(tmp, "snapshots");
  runDir = path.join(snapshotsRoot, TYPE, RUN);
  fs.mkdirSync(contentDir, { recursive: true });
  store = createVersionStore(path.join(tmp, "published"));
});
afterEach(() => {
  jest.restoreAllMocks();
  fs.rmSync(tmp, { recursive: true, force: true });
});

describe("it reports the state and what that state means", () => {
  it("reports no-record, and says what that does not prove", async () => {
    const report = await inspect();
    expect(report.state).toBe("no-record");
    expect(report.meaning.doesNotProve).toMatch(/another run id may have/i);
    expect(report.comparison).toBeNull();
  });

  it("reports captured, with the recovery point's contents", async () => {
    await seedCaptured();
    const report = await inspect();

    expect(report.state).toBe("captured");
    expect(report.meaning.ifProcessInterrupted).toMatch(/had not begun writing/);
    expect(report.restoredFromRunId).toBe(TARGET_RUN);
    expect(report.status.recoveryPoint?.snapshot).toEqual(BEFORE);
    expect(report.targetManifestValid).toBe(true);
  });

  it("reports writing once a marker is present", async () => {
    const checksum = await seedCaptured();
    await writeWriteMarker(writeMarkerPath(runDir), {
      type: TYPE, runId: RUN, restoredFromRunId: TARGET_RUN, recoveryChecksum: checksum, fileCount: 4,
    });
    const report = await inspect();
    expect(report.state).toBe("writing");
    expect(report.meaning.doesNotProve).toMatch(/completed but was interrupted/);
  });

  it("reports completed and the version it activated", async () => {
    const checksum = await seedCaptured();
    await writeWriteMarker(writeMarkerPath(runDir), {
      type: TYPE, runId: RUN, restoredFromRunId: TARGET_RUN, recoveryChecksum: checksum, fileCount: 4,
    });
    await writeCompletion(completionPath(runDir), {
      type: TYPE, runId: RUN, restoredFromRunId: TARGET_RUN, activatedVersion: "v7", filesRestored: 4,
    });
    const report = await inspect();
    expect(report.state).toBe("completed");
    expect(report.status.completion?.activatedVersion).toBe("v7");
  });
});

describe("it places the live files between the two states", () => {
  it("sees an untouched tree as entirely pre-rollback", async () => {
    await seedCaptured();
    const report = await inspect();
    const standings = report.comparison!.map((c) => c.standing);
    expect(standings).toEqual(Array(4).fill("matches-pre-rollback"));
  });

  it("sees a completed rollback as entirely at the target", async () => {
    await seedCaptured();
    for (const [rel, content] of Object.entries(TARGET)) liveWrite(rel, content);

    const report = await inspect();
    const byKey = new Map(report.comparison!.map((c) => [c.key, c.standing]));
    expect(byKey.get("naval/germany.json")).toBe("matches-target");
    expect(byKey.get("index.json")).toBe("matches-target");
    // The file the target says was absent really is gone, and that counts
    // as matching the target rather than as missing.
    expect(byKey.get("naval/romania.json")).toBe("matches-target");
  });

  it("identifies exactly how far an interrupted rollback got", async () => {
    // The question the markers cannot answer.
    await seedCaptured();
    liveWrite("naval/germany.json", TARGET["naval/germany.json"] as string);
    liveWrite("naval/italy.json", TARGET["naval/italy.json"] as string);

    const report = await inspect();
    const byKey = new Map(report.comparison!.map((c) => [c.key, c.standing]));
    expect(byKey.get("naval/germany.json")).toBe("matches-target");
    expect(byKey.get("naval/italy.json")).toBe("matches-target");
    expect(byKey.get("index.json")).toBe("matches-pre-rollback");
    expect(byKey.get("naval/romania.json")).toBe("matches-pre-rollback");
  });

  it("flags a file that matches neither state", async () => {
    await seedCaptured();
    liveWrite("index.json", "SOMETHING ELSE ENTIRELY");
    const report = await inspect();
    expect(report.comparison!.find((c) => c.key === "index.json")?.standing).toBe("matches-neither");
  });

  it("reports an unreadable live file rather than guessing", async () => {
    await seedCaptured();
    const realReadFile = jest.requireActual<typeof fsp>("fs/promises").readFile;
    jest.spyOn(fsp, "readFile").mockImplementation(((p: string, enc: unknown) => {
      if (String(p).endsWith("index.json") && String(p).includes("public-data")) {
        const e = new Error("EACCES: permission denied") as NodeJS.ErrnoException;
        e.code = "EACCES";
        return Promise.reject(e);
      }
      return realReadFile(p as never, enc as never);
    }) as never);

    const report = await inspect();
    const entry = report.comparison!.find((c) => c.key === "index.json");
    expect(entry?.standing).toBe("unreadable");
    expect(entry?.detail).toContain("EACCES");
  });

  it("still reports when the target manifest cannot be read", async () => {
    await seedCaptured();
    fs.writeFileSync(path.join(snapshotsRoot, TYPE, TARGET_RUN, "manifest.json"), "{ truncated", "utf-8");

    const report = await inspect();
    expect(report.targetManifestValid).toBe(false);
    expect(report.targetManifestError).toMatch(/unparseable/);
    expect(report.comparisonNote).toMatch(/recovery point only/);
    expect(report.comparison).not.toBeNull();
  });

  it("says why it cannot compare when the recovery point is corrupt", async () => {
    await seedCaptured();
    const doc = JSON.parse(fs.readFileSync(recoveryPointPath(runDir), "utf-8")) as Record<string, unknown>;
    (doc.snapshot as PromotionSnapshot)["index.json"] = "TAMPERED";
    fs.writeFileSync(recoveryPointPath(runDir), JSON.stringify(doc), "utf-8");

    const report = await inspect();
    expect(report.status.recoveryPointError).toMatch(/checksum-mismatch/);
    expect(report.comparison).toBeNull();
    expect(report.comparisonNote).toMatch(/cannot be placed/);
  });
});

/**
 * These cases MODEL the filesystem state a power loss could leave. They do
 * not simulate power loss: nothing here cuts power, and no claim is made
 * about what a real crash would produce on any particular disk or
 * filesystem. What is modelled is narrow and specific — an artefact whose
 * rename completed but whose directory entry was never flushed is absent
 * after the crash, while writes that followed it are present — and the
 * states below are constructed by deleting the artefact from a tree that
 * reflects partial rollback.
 *
 * A real power-loss test needs hardware this suite does not have. The gap
 * between the two is stated rather than papered over.
 */
describe("modelled post-crash states where an artefact is missing (NOT a real power-loss test)", () => {
  /** Roll the first two files back, as an interrupted restore would. */
  const partiallyRollBack = (): void => {
    liveWrite("naval/germany.json", TARGET["naval/germany.json"] as string);
    liveWrite("naval/italy.json", TARGET["naval/italy.json"] as string);
  };

  it("contradicts a captured reading when the live files have already moved", async () => {
    await seedCaptured();
    partiallyRollBack();
    // Modelled: the marker's rename completed, its directory entry did not.
    expect(fs.existsSync(writeMarkerPath(runDir))).toBe(false);

    const report = await inspect();

    expect(report.state).toBe("captured");
    expect(report.readingDependsOnAbsence).toBe(true);
    expect(report.evidence).toBe("contradicted");
    expect(report.evidenceConflict).toMatch(/Writes DID begin/);
    expect(report.evidenceConflict).toContain("naval/germany.json");
    // It says which witness to believe, and why.
    expect(report.evidenceConflict).toMatch(/Trust the files, not the missing artefact/);
    expect(report.evidenceConflict).toMatch(/can have been lost rather than never written/);
  });

  it("does not claim writes had not begun, in the formatted output either", async () => {
    await seedCaptured();
    partiallyRollBack();
    const text = formatInspection(await inspect());

    expect(text).toContain("CONTRADICTED:");
    expect(text).toMatch(/if power loss:.*AMBIGUOUS/);
    if (process.platform === "win32") {
      expect(text).toContain("AMBIGUOUS:          this state's reading rests on an artefact being absent");
    }
  });

  it("reports captured as consistent when the files really have not moved", async () => {
    // The correction must not turn every captured run into a false alarm.
    await seedCaptured();
    const report = await inspect();

    expect(report.state).toBe("captured");
    expect(report.evidence).toBe("consistent");
    expect(report.evidenceConflict).toBeNull();
  });

  it("reports ambiguity when both artefacts are missing and cannot be compared", async () => {
    // Modelled: neither directory entry survived. There is nothing left to
    // compare the live files against for this run, so the honest answer is
    // that nothing can be concluded — not that nothing happened.
    await seedCaptured();
    partiallyRollBack();
    fs.rmSync(recoveryPointPath(runDir));

    const report = await inspect();

    expect(report.state).toBe("no-record");
    expect(report.readingDependsOnAbsence).toBe(true);
    expect(report.evidence).toBe("not-comparable");
    expect(report.powerLossReading).toMatch(/AMBIGUOUS/);
    expect(report.meaning.doesNotProve).toMatch(/never, by itself, proof/);
    // And it does not pretend the files are untouched — they are not.
    expect(fs.readFileSync(path.join(contentDir, "naval", "germany.json"), "utf-8"))
      .toBe("ARCHIVED GERMANY");
  });

  it("keeps a writing reading at full strength, since it rests on presence", async () => {
    const checksum = await seedCaptured();
    await writeWriteMarker(writeMarkerPath(runDir), {
      type: TYPE, runId: RUN, restoredFromRunId: TARGET_RUN, recoveryChecksum: checksum, fileCount: 4,
    });
    partiallyRollBack();

    const report = await inspect();
    expect(report.state).toBe("writing");
    expect(report.readingDependsOnAbsence).toBe(false);
    expect(report.evidence).toBe("consistent"); // partial writes are expected here
    expect(report.evidenceConflict).toBeNull();
    expect(report.powerLossReading).toMatch(/no weaker/);
  });

  it("states the platform limitation whether or not it currently bites", async () => {
    await seedCaptured();
    const report = await inspect();

    if (process.platform === "win32") {
      expect(report.durabilityCaveat).toContain("cannot flush a directory entry");
      expect(report.durabilityCaveat).toMatch(/ABSENCE of an artefact proves nothing/);
      expect(report.durabilityCaveat).toMatch(/Presence remains reliable/);
    } else {
      expect(report.durabilityCaveat).toContain("can flush a directory entry");
      expect(report.durabilityCaveat).toMatch(/filesystem itself is intact/);
    }
    expect(formatInspection(report)).toContain("durability:");
  });

  it("stays strictly read-only while reporting a contradiction", async () => {
    // The moment an over-eager tool would "repair" the tree.
    await seedCaptured();
    partiallyRollBack();

    const before = fingerprint(tmp);
    const spies = (["writeFile", "mkdir", "rename", "rm", "unlink", "rmdir", "appendFile", "truncate", "copyFile"] as const)
      .map((fn) => jest.spyOn(fsp, fn));

    const report = await inspect();
    formatInspection(report);

    expect(report.evidence).toBe("contradicted");
    for (const spy of spies) expect(spy).not.toHaveBeenCalled();
    const after = fingerprint(tmp);
    expect([...after.keys()].sort()).toEqual([...before.keys()].sort());
    for (const [file, hash] of before) expect(after.get(file)).toBe(hash);
  });

  it("documents the platform, so a green run is not read as a power-loss proof", () => {
    expect(["win32", "linux", "darwin"]).toContain(process.platform);
    console.log(
      `[modelled-crash] platform=${process.platform} directory-fsync=${
        process.platform === "win32" ? "UNSUPPORTED" : "supported"
      } — states above are MODELLED, not produced by a real power loss`,
    );
  });
});

describe("it reports the version pointer as it was and as it is", () => {
  it("shows both, and the difference between them", async () => {
    for (const [rel, content] of Object.entries(BEFORE)) liveWrite(rel, content);
    const v1 = await store.createVersionFrom(path.join(tmp, "public-data"));
    await store.writeActiveVersion(v1);

    await writeSnapshotManifest(
      path.join(snapshotsRoot, TYPE, TARGET_RUN, "manifest.json"),
      { type: TYPE, runId: TARGET_RUN }, TARGET,
    );
    await writeRecoveryPoint(recoveryPointPath(runDir), {
      type: TYPE, runId: RUN, restoredFromRunId: TARGET_RUN, activeVersionAtCapture: v1,
    }, BEFORE);

    const v2 = await store.createVersionFrom(path.join(tmp, "public-data"));
    await store.writeActiveVersion(v2);

    const report = await inspect();
    expect(report.activeVersionAtCapture).toBe(v1);
    expect(report.activeVersionNow).toBe(v2);
    expect(v1).not.toBe(v2);
  });

  it("reports null on both sides when versioning is not in use", async () => {
    await seedCaptured();
    const report = await inspect();
    expect(report.activeVersionAtCapture).toBeNull();
    expect(report.activeVersionNow).toBeNull();
  });
});

describe("it is read-only", () => {
  it("changes not one byte, mtime or entry of anything it inspects", async () => {
    const checksum = await seedCaptured();
    await writeWriteMarker(writeMarkerPath(runDir), {
      type: TYPE, runId: RUN, restoredFromRunId: TARGET_RUN, recoveryChecksum: checksum, fileCount: 4,
    });
    const v1 = await store.createVersionFrom(path.join(tmp, "public-data"));
    await store.writeActiveVersion(v1);
    liveWrite("naval/germany.json", TARGET["naval/germany.json"] as string); // part-way

    const before = fingerprint(tmp);
    expect(before.size).toBeGreaterThan(5);

    const report = await inspect();
    formatInspection(report);
    await listRollbackRuns(TYPE, snapshotsRoot);

    const after = fingerprint(tmp);
    expect([...after.keys()].sort()).toEqual([...before.keys()].sort());
    for (const [file, hash] of before) expect(after.get(file)).toBe(hash);
  });

  it("creates nothing when the run directory does not exist", async () => {
    const before = fingerprint(tmp);
    await inspectRollbackRun(TYPE, "never-existed", { snapshotsRoot, contentDir, store });
    expect(fingerprint(tmp)).toEqual(before);
    expect(fs.existsSync(path.join(snapshotsRoot, TYPE, "never-existed"))).toBe(false);
  });

  it("does not restore a thing, however recoverable the state looks", async () => {
    // Discovering a usable recovery point beside a half-rolled-back tree is
    // precisely when an over-eager tool would "help". It must not.
    await seedCaptured();
    liveWrite("naval/germany.json", TARGET["naval/germany.json"] as string);
    liveWrite("naval/italy.json", TARGET["naval/italy.json"] as string);

    const report = await inspect();
    expect(report.comparison!.some((c) => c.standing === "matches-target")).toBe(true);
    expect(report.comparison!.some((c) => c.standing === "matches-pre-rollback")).toBe(true);

    // Still half-way. Nothing was put back, nothing was finished.
    expect(fs.readFileSync(path.join(contentDir, "naval", "germany.json"), "utf-8")).toBe("ARCHIVED GERMANY");
    expect(fs.readFileSync(path.join(contentDir, "index.json"), "utf-8")).toBe("LIVE INDEX");
    expect(fs.readFileSync(path.join(contentDir, "naval", "romania.json"), "utf-8")).toBe("LIVE ROMANIA");
  });

  it("never moves the version pointer", async () => {
    await seedCaptured();
    const v1 = await store.createVersionFrom(path.join(tmp, "public-data"));
    await store.writeActiveVersion(v1);
    const pointerBefore = fs.readFileSync(store.pointerFile, "utf-8");

    await inspect();

    expect(fs.readFileSync(store.pointerFile, "utf-8")).toBe(pointerBefore);
    expect(await store.listVersions()).toEqual([v1]);
  });

  it("calls no mutating filesystem operation at all", async () => {
    // Belt and braces alongside the byte-level check: if any of these were
    // reached, the read-only claim would be false even where the result
    // happened to be identical.
    await seedCaptured();
    const spies = (["writeFile", "mkdir", "rename", "rm", "unlink", "rmdir", "appendFile", "truncate", "copyFile"] as const)
      .map((fn) => jest.spyOn(fsp, fn));
    const openSpy = jest.spyOn(fsp, "open");

    const report = await inspect();
    formatInspection(report);
    await listRollbackRuns(TYPE, snapshotsRoot);

    for (const spy of spies) expect(spy).not.toHaveBeenCalled();
    // Nothing is opened for writing either.
    for (const call of openSpy.mock.calls) {
      expect(String(call[1] ?? "r")).toMatch(/^r/);
    }
  });

  it.each([
    ["a truncated recovery point", () => fs.writeFileSync(recoveryPointPath(runDir), "{ truncated", "utf-8")],
    ["a recovery point with a broken checksum", () => {
      const doc = JSON.parse(fs.readFileSync(recoveryPointPath(runDir), "utf-8")) as Record<string, unknown>;
      (doc.snapshot as PromotionSnapshot)["index.json"] = "TAMPERED";
      fs.writeFileSync(recoveryPointPath(runDir), JSON.stringify(doc), "utf-8");
    }],
    ["a recovery point that is not an object", () => fs.writeFileSync(recoveryPointPath(runDir), "[]", "utf-8")],
    ["an empty recovery point", () => fs.writeFileSync(recoveryPointPath(runDir), "{}", "utf-8")],
    ["a corrupt write marker", () => fs.writeFileSync(writeMarkerPath(runDir), "{ nope", "utf-8")],
    ["a corrupt completion record", () => fs.writeFileSync(completionPath(runDir), "0", "utf-8")],
    ["a corrupt target manifest", () => fs.writeFileSync(
      path.join(snapshotsRoot, TYPE, TARGET_RUN, "manifest.json"), "{ broken", "utf-8")],
  ])("stays strictly read-only while inspecting %s", async (_label, corrupt) => {
    // F4: every error path, not just the happy one. A corrupt artefact is
    // exactly where a tool might be tempted to "fix" or re-derive something.
    const checksum = await seedCaptured();
    await writeWriteMarker(writeMarkerPath(runDir), {
      type: TYPE, runId: RUN, restoredFromRunId: TARGET_RUN, recoveryChecksum: checksum, fileCount: 4,
    });
    await writeCompletion(completionPath(runDir), {
      type: TYPE, runId: RUN, restoredFromRunId: TARGET_RUN, activatedVersion: null, filesRestored: 4,
    });
    corrupt();

    const before = fingerprint(tmp);
    expect(before.size).toBeGreaterThan(5);
    const spies = (["writeFile", "mkdir", "rename", "rm", "unlink", "rmdir", "appendFile", "truncate", "copyFile"] as const)
      .map((fn) => jest.spyOn(fsp, fn));
    const openSpy = jest.spyOn(fsp, "open");

    const report = await inspect();
    formatInspection(report);
    await listRollbackRuns(TYPE, snapshotsRoot);

    // It reported something rather than throwing, and changed nothing.
    expect(report.state).toBeTruthy();
    for (const spy of spies) expect(spy).not.toHaveBeenCalled();
    for (const call of openSpy.mock.calls) expect(String(call[1] ?? "r")).toMatch(/^r/);

    const after = fingerprint(tmp);
    expect([...after.keys()].sort()).toEqual([...before.keys()].sort());
    for (const [file, hash] of before) expect(after.get(file)).toBe(hash);
  });

  it("surfaces the corruption rather than swallowing it", async () => {
    // Read-only is not the same as silent: the error must reach the report.
    const checksum = await seedCaptured();
    await writeWriteMarker(writeMarkerPath(runDir), {
      type: TYPE, runId: RUN, restoredFromRunId: TARGET_RUN, recoveryChecksum: checksum, fileCount: 4,
    });
    fs.writeFileSync(recoveryPointPath(runDir), "{ truncated", "utf-8");

    const report = await inspect();
    expect(report.status.recoveryPointError).toMatch(/unparseable/);
    expect(report.status.recoveryPoint).toBeNull();
    // State still reflects presence, so the run is not understated.
    expect(report.state).toBe("writing");
    expect(formatInspection(report)).toMatch(/recovery point:\s+UNUSABLE/);
  });

  it("the source contains no write call", () => {
    // Comments stripped first: the module's own header lists the operations
    // it does not perform, and matching that prose would be meaningless.
    const code = fs.readFileSync(path.resolve(__dirname, "../inspect-rollback.ts"), "utf-8")
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/^\s*\/\/.*$/gm, "");

    for (const forbidden of [
      "writeFile", "mkdir(", "rename(", ".rm(", "unlink", "rmdir", "appendFile", "truncate",
      "writeRecoveryPoint", "writeWriteMarker", "writeCompletion", "writeSnapshotManifest",
      "writeActiveVersion", "createVersionFrom", "pruneVersions", "restoreFromSnapshot",
      "applyFileChangesAtomically", "promote(", "rollback(",
    ]) {
      expect(code).not.toContain(forbidden);
    }
    // And the stripping did not simply remove everything.
    expect(code).toContain("export async function inspectRollbackRun(");
  });
});

describe("listing runs", () => {
  it("finds only directories carrying rollback artefacts", async () => {
    await seedCaptured();
    // The target promotion's own directory holds a manifest, not a rollback
    // artefact, and must not be listed as a rollback run.
    expect(await listRollbackRuns(TYPE, snapshotsRoot)).toEqual([RUN]);
  });

  it("returns nothing for a type with no snapshot directory", async () => {
    expect(await listRollbackRuns("letters", snapshotsRoot)).toEqual([]);
  });
});

describe("the formatted report", () => {
  it("states the state, both halves of its meaning, and that nothing changed", async () => {
    const checksum = await seedCaptured();
    await writeWriteMarker(writeMarkerPath(runDir), {
      type: TYPE, runId: RUN, restoredFromRunId: TARGET_RUN, recoveryChecksum: checksum, fileCount: 4,
    });
    const text = formatInspection(await inspect());

    expect(text).toContain("state:              writing");
    // Observation and inference are reported separately, and the inference
    // is split by failure mode rather than given as one claim.
    expect(text).toContain("observed:");
    expect(text).toContain("if process killed:");
    expect(text).toContain("if power loss:");
    expect(text).toContain("does NOT prove:");
    expect(text).toContain("durability:");
    expect(text).toContain("CURRENT at capture:");
    expect(text).toContain("This command changed nothing.");
    expect(text).toContain("Acting on a recovery point is a manual decision.");
  });

  it("surfaces a marker bound to the wrong recovery point", async () => {
    await seedCaptured();
    await writeWriteMarker(writeMarkerPath(runDir), {
      type: TYPE, runId: RUN, restoredFromRunId: TARGET_RUN,
      recoveryChecksum: "f".repeat(64), fileCount: 4,
    });
    expect(formatInspection(await inspect())).toMatch(/WARNING:.*different recovery point/);
  });

  it("surfaces an unusable recovery point rather than printing nothing", async () => {
    await seedCaptured();
    fs.writeFileSync(recoveryPointPath(runDir), "{ truncated", "utf-8");
    expect(formatInspection(await inspect())).toMatch(/recovery point:\s+UNUSABLE/);
  });
});

describe("the command never runs on its own", () => {
  const source = fs.readFileSync(path.resolve(__dirname, "../inspect-rollback.ts"), "utf-8");

  it("guards its entry point", () => {
    expect(source).toContain("if (require.main === module)");
    expect(source.indexOf("if (require.main === module)")).toBeLessThan(source.indexOf("process.argv"));
  });

  it("is imported by nothing in the application", () => {
    const hits: string[] = [];
    const walk = (p: string): void => {
      const stat = fs.statSync(p);
      if (stat.isDirectory()) { for (const e of fs.readdirSync(p)) walk(path.join(p, e)); return; }
      if (!p.endsWith(".ts") || p.includes("__tests__")) return;
      if (fs.readFileSync(p, "utf-8").includes("inspect-rollback")) hits.push(p);
    };
    for (const r of ["src/app.ts", "src/index.ts", "src/modules", "src/config"]) {
      if (fs.existsSync(r)) walk(r);
    }
    expect(hits).toEqual([]);
  });
});
