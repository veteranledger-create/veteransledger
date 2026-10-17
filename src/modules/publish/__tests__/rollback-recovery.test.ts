import { spawnSync } from "child_process";
import fs from "fs";
import fsp from "fs/promises";
import os from "os";
import path from "path";
import {
  writeRecoveryPoint,
  writeWriteMarker,
  writeCompletion,
  readRecoveryPoint,
  readWriteMarker,
  readCompletion,
  readRollbackRunStatus,
  recoveryPointPath,
  writeMarkerPath,
  completionPath,
  STATE_MEANING,
  dependsOnAbsence,
  powerLossReading,
  RECOVERY_FORMAT_VERSION,
} from "../rollback-recovery";
import { ManifestInvalidError, ManifestMissingError, writeSnapshotManifest, snapshotChecksum } from "../snapshot-manifest";
import { restoreFromSnapshot } from "../promote-atomic";
import {
  verifyAgainstSnapshot,
  abortBeforeActivation,
  PromotionAbortedError,
} from "../promotion.service";
import { PromotionSnapshot } from "../promote-atomic";
import { createVersionStore } from "../version-store";

/**
 * R8 Stage 3 — the pre-rollback recovery point, the write-start marker, and
 * what each of them proves.
 *
 * A rollback used to hold the state it was about to replace in a local
 * variable and nowhere else. Compensation therefore only existed for an
 * error the process lived long enough to catch; a process that died during
 * the restore left public/data between two states with no record of either.
 *
 * The interruption cases below run in REAL child processes killed with
 * process.exit, because in-process injection always unwinds through the
 * finally blocks and compensating handlers that are exactly what a killed
 * process does not get to run. Assertions are on bytes, the pointer, and
 * the durable artefacts — never on call counts.
 */

const TYPE = "armaments";
const TARGET_RUN = "target-run";
const ROLLBACK_RUN = "rollback-run";
const CHILD = path.resolve(__dirname, "fixtures", "rollback-sequence-child.js");

let tmp: string;
let contentDir: string;
let snapshotsRoot: string;
let runDir: string;

/** The promotion's snapshot: where a rollback is going. */
const TARGET: PromotionSnapshot = {
  "naval/germany.json": "ARCHIVED GERMANY",
  "naval/italy.json": "ARCHIVED ITALY",
  "naval/romania.json": null, // did not exist before that promotion
  "index.json": "ARCHIVED INDEX",
};

/** The live state: where a rollback is coming from. */
const LIVE: Record<string, string> = {
  "naval/germany.json": "LIVE GERMANY",
  "naval/italy.json": "LIVE ITALY",
  "naval/romania.json": "LIVE ROMANIA (added by the promotion)",
  "index.json": "LIVE INDEX",
};

const liveWrite = (rel: string, content: string): void => {
  const p = path.join(contentDir, rel);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, content, "utf-8");
};
const liveRead = (rel: string): string | null => {
  try { return fs.readFileSync(path.join(contentDir, rel), "utf-8"); } catch { return null; }
};

async function buildFixture(): Promise<void> {
  for (const [rel, content] of Object.entries(LIVE)) liveWrite(rel, content);
  await writeSnapshotManifest(
    path.join(snapshotsRoot, TYPE, TARGET_RUN, "manifest.json"),
    { type: TYPE, runId: TARGET_RUN },
    TARGET,
  );
}

function runChild(
  phase: string,
  dieAfterRenames?: number,
  runId: string = ROLLBACK_RUN,
): { code: number | null; out: string } {
  const result = spawnSync(
    process.execPath,
    [CHILD, tmp, phase, String(dieAfterRenames ?? 1), runId],
    { encoding: "utf-8", timeout: 60_000 },
  );
  return { code: result.status, out: `${result.stdout ?? ""}${result.stderr ?? ""}` };
}

beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "vl-r8s3-"));
  contentDir = path.join(tmp, "public-data", TYPE);
  snapshotsRoot = path.join(tmp, "snapshots");
  runDir = path.join(snapshotsRoot, TYPE, ROLLBACK_RUN);
  fs.mkdirSync(contentDir, { recursive: true });
});
afterEach(() => {
  jest.restoreAllMocks();
  fs.rmSync(tmp, { recursive: true, force: true });
});

// ── the artefacts themselves ─────────────────────────────────

describe("the recovery point records the pre-rollback state", () => {
  const meta = {
    type: TYPE, runId: ROLLBACK_RUN, restoredFromRunId: TARGET_RUN,
    activeVersionAtCapture: "v41" as string | null,
  };
  const before: PromotionSnapshot = {
    "naval/germany.json": "LIVE GERMANY",
    "naval/romania.json": "LIVE ROMANIA",
    "gone.json": null,
  };

  it("round-trips every field, and validates on the way back", async () => {
    await writeRecoveryPoint(recoveryPointPath(runDir), meta, before);
    const point = await readRecoveryPoint(recoveryPointPath(runDir));

    expect(point).toMatchObject({
      formatVersion: RECOVERY_FORMAT_VERSION,
      kind: "pre-rollback-snapshot",
      type: TYPE,
      runId: ROLLBACK_RUN,
      restoredFromRunId: TARGET_RUN,
      activeVersionAtCapture: "v41",
      algorithm: "sha256",
    });
    expect(point.snapshot).toEqual(before);
    expect(point.checksum).toBe(snapshotChecksum(before));
    expect(point.capturedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it("preserves a file that was present and one that was absent, distinctly", async () => {
    await writeRecoveryPoint(recoveryPointPath(runDir), meta, before);
    const { snapshot } = await readRecoveryPoint(recoveryPointPath(runDir));

    expect(snapshot["naval/germany.json"]).toBe("LIVE GERMANY");
    // null is "this did not exist", not "unknown" and not empty.
    expect(snapshot["gone.json"]).toBeNull();
    expect(Object.prototype.hasOwnProperty.call(snapshot, "gone.json")).toBe(true);
  });

  it("records a null active version when versioning is not in use", async () => {
    await writeRecoveryPoint(recoveryPointPath(runDir), { ...meta, activeVersionAtCapture: null }, before);
    expect((await readRecoveryPoint(recoveryPointPath(runDir))).activeVersionAtCapture).toBeNull();
  });

  it("refuses to be written over a promotion's own manifest", async () => {
    // The artefact that would be destroyed is the one the rollback is
    // reading from, so this is refused by name rather than by convention.
    await expect(
      writeRecoveryPoint(path.join(runDir, "manifest.json"), meta, before),
    ).rejects.toBeInstanceOf(ManifestInvalidError);
    expect(fs.existsSync(path.join(runDir, "manifest.json"))).toBe(false);
  });

  it("does not disturb the target manifest sitting beside it", async () => {
    await buildFixture();
    const targetPath = path.join(snapshotsRoot, TYPE, TARGET_RUN, "manifest.json");
    const targetBytes = fs.readFileSync(targetPath);

    await writeRecoveryPoint(recoveryPointPath(runDir), meta, before);

    expect(fs.readFileSync(targetPath).equals(targetBytes)).toBe(true);
    expect(fs.readdirSync(runDir)).toEqual(["pre-rollback.json"]);
  });

  it("rejects a tampered payload", async () => {
    await writeRecoveryPoint(recoveryPointPath(runDir), meta, before);
    const doc = JSON.parse(fs.readFileSync(recoveryPointPath(runDir), "utf-8")) as Record<string, unknown>;
    (doc.snapshot as PromotionSnapshot)["naval/germany.json"] = "TAMPERED";
    fs.writeFileSync(recoveryPointPath(runDir), JSON.stringify(doc), "utf-8");

    const err = await readRecoveryPoint(recoveryPointPath(runDir)).catch((e: unknown) => e);
    expect((err as ManifestInvalidError).reason).toBe("checksum-mismatch");
    expect((err as Error).message).toMatch(/must not be used to restore anything/);
  });

  it("rejects a truncated artefact rather than restoring part of it", async () => {
    await writeRecoveryPoint(recoveryPointPath(runDir), meta, before);
    const whole = fs.readFileSync(recoveryPointPath(runDir), "utf-8");
    fs.writeFileSync(recoveryPointPath(runDir), whole.slice(0, whole.length / 2), "utf-8");

    const err = await readRecoveryPoint(recoveryPointPath(runDir)).catch((e: unknown) => e);
    expect((err as ManifestInvalidError).reason).toBe("unparseable");
  });

  it.each([
    ["an unknown version", { formatVersion: 2 }, "bad-envelope"],
    ["the wrong kind", { kind: "promotion-snapshot" }, "bad-envelope"],
    ["a missing restoredFromRunId", { restoredFromRunId: "" }, "bad-envelope"],
    ["a non-string active version", { activeVersionAtCapture: 7 }, "bad-envelope"],
    ["a malformed checksum", { checksum: "nope" }, "bad-envelope"],
    ["an empty snapshot", { snapshot: {} }, "empty"],
    ["a bad entry type", { snapshot: { "a.json": 5 } }, "bad-entry"],
  ])("refuses %s", async (_label, overrides, reason) => {
    await writeRecoveryPoint(recoveryPointPath(runDir), meta, before);
    const doc = JSON.parse(fs.readFileSync(recoveryPointPath(runDir), "utf-8")) as Record<string, unknown>;
    fs.writeFileSync(recoveryPointPath(runDir), JSON.stringify({ ...doc, ...overrides }), "utf-8");

    const err = await readRecoveryPoint(recoveryPointPath(runDir)).catch((e: unknown) => e);
    expect((err as ManifestInvalidError).reason).toBe(reason);
  });

  it("reports a missing artefact as missing, not as corrupt", async () => {
    await expect(readRecoveryPoint(recoveryPointPath(runDir))).rejects.toBeInstanceOf(ManifestMissingError);
  });
});

describe("the write marker and completion record", () => {
  const markerMeta = {
    type: TYPE, runId: ROLLBACK_RUN, restoredFromRunId: TARGET_RUN,
    recoveryChecksum: "a".repeat(64), fileCount: 4,
  };

  it("round-trips and verifies its own checksum", async () => {
    await writeWriteMarker(writeMarkerPath(runDir), markerMeta);
    const marker = await readWriteMarker(writeMarkerPath(runDir));
    expect(marker).toMatchObject({ kind: "rollback-write-marker", fileCount: 4, runId: ROLLBACK_RUN });
  });

  it("rejects a marker whose body was edited", async () => {
    await writeWriteMarker(writeMarkerPath(runDir), markerMeta);
    const doc = JSON.parse(fs.readFileSync(writeMarkerPath(runDir), "utf-8")) as Record<string, unknown>;
    fs.writeFileSync(writeMarkerPath(runDir), JSON.stringify({ ...doc, fileCount: 99 }), "utf-8");

    const err = await readWriteMarker(writeMarkerPath(runDir)).catch((e: unknown) => e);
    expect((err as ManifestInvalidError).reason).toBe("checksum-mismatch");
  });

  it("round-trips a completion record, including a null version", async () => {
    await writeCompletion(completionPath(runDir), {
      type: TYPE, runId: ROLLBACK_RUN, restoredFromRunId: TARGET_RUN,
      activatedVersion: null, filesRestored: 4,
    });
    const done = await readCompletion(completionPath(runDir));
    expect(done).toMatchObject({ kind: "rollback-completion", activatedVersion: null, filesRestored: 4 });
  });

  it("neither may be written as a promotion manifest", async () => {
    await expect(writeWriteMarker(path.join(runDir, "manifest.json"), markerMeta)).rejects.toThrow();
    await expect(writeCompletion(path.join(runDir, "manifest.json"), {
      type: TYPE, runId: ROLLBACK_RUN, restoredFromRunId: TARGET_RUN,
      activatedVersion: null, filesRestored: 1,
    })).rejects.toThrow();
  });
});

describe("the durable state machine", () => {
  const before: PromotionSnapshot = { "a.json": "LIVE" };
  const point = async (): Promise<string> =>
    (await writeRecoveryPoint(recoveryPointPath(runDir), {
      type: TYPE, runId: ROLLBACK_RUN, restoredFromRunId: TARGET_RUN, activeVersionAtCapture: null,
    }, before)).checksum;

  it("reports no-record when nothing was persisted", async () => {
    const status = await readRollbackRunStatus(runDir);
    expect(status.state).toBe("no-record");
    expect(status.recoveryPoint).toBeNull();
    expect(status.marker).toBeNull();
  });

  it("reports captured with a recovery point and no marker", async () => {
    await point();
    const status = await readRollbackRunStatus(runDir);
    expect(status.state).toBe("captured");
    expect(status.recoveryPoint?.snapshot).toEqual(before);
    expect(status.marker).toBeNull();
  });

  it("reports writing once the marker exists", async () => {
    const checksum = await point();
    await writeWriteMarker(writeMarkerPath(runDir), {
      type: TYPE, runId: ROLLBACK_RUN, restoredFromRunId: TARGET_RUN,
      recoveryChecksum: checksum, fileCount: 1,
    });
    const status = await readRollbackRunStatus(runDir);
    expect(status.state).toBe("writing");
    expect(status.markerMismatch).toBe(false);
  });

  it("reports completed only once the completion record exists", async () => {
    const checksum = await point();
    await writeWriteMarker(writeMarkerPath(runDir), {
      type: TYPE, runId: ROLLBACK_RUN, restoredFromRunId: TARGET_RUN,
      recoveryChecksum: checksum, fileCount: 1,
    });
    expect((await readRollbackRunStatus(runDir)).state).toBe("writing");

    await writeCompletion(completionPath(runDir), {
      type: TYPE, runId: ROLLBACK_RUN, restoredFromRunId: TARGET_RUN,
      activatedVersion: "v2", filesRestored: 1,
    });
    expect((await readRollbackRunStatus(runDir)).state).toBe("completed");
  });

  it("notices a marker bound to a different recovery point", async () => {
    await point();
    await writeWriteMarker(writeMarkerPath(runDir), {
      type: TYPE, runId: ROLLBACK_RUN, restoredFromRunId: TARGET_RUN,
      recoveryChecksum: "b".repeat(64), fileCount: 1,
    });
    const status = await readRollbackRunStatus(runDir);
    expect(status.markerMismatch).toBe(true);
  });

  it("derives state from presence, so a corrupt marker still counts as writing", async () => {
    // Understating how far a run got is the dangerous direction. A marker
    // that cannot be parsed still proves the run reached the marker step.
    await point();
    fs.writeFileSync(writeMarkerPath(runDir), "{ truncated", "utf-8");
    const status = await readRollbackRunStatus(runDir);

    expect(status.state).toBe("writing");
    expect(status.marker).toBeNull();
    expect(status.markerError).toMatch(/unparseable/);
  });

  it("states plainly what each state does not prove", () => {
    expect(STATE_MEANING["no-record"].doesNotProve).toMatch(/another run id may have/i);
    // A process kill with the filesystem intact is the only case where the
    // marker's absence establishes anything.
    expect(STATE_MEANING.captured.ifProcessInterrupted).toMatch(/had not begun writing/);
    // A missing completion record is never read as proof the rollback failed.
    expect(STATE_MEANING.writing.doesNotProve).toMatch(/completed but was interrupted/);
    expect(STATE_MEANING.completed.doesNotProve).toMatch(/warnings/);
  });

  it("does not claim that absence establishes anything where the directory is not flushed", () => {
    // The marker and the content files live in different directories; with
    // neither entry flushed, "no marker" cannot mean "no writes".
    for (const state of ["no-record", "captured"] as const) {
      expect(STATE_MEANING[state].ifPowerLoss.withoutDirectoryFlush).toMatch(/AMBIGUOUS/);
    }
    expect(STATE_MEANING.captured.ifPowerLoss.withoutDirectoryFlush).toMatch(/different directory/);
    expect(STATE_MEANING["no-record"].ifPowerLoss.withoutDirectoryFlush)
      .toMatch(/destructive writes may well have happened/);
    // And absence of a recovery point is never proof nothing was written.
    expect(STATE_MEANING["no-record"].doesNotProve).toMatch(/never, by itself, proof/);
  });

  it("does not understate the guarantee where the directory IS flushed", () => {
    // F2: the previous text baked in the Windows case, so on a platform that
    // can flush a directory entry it described a weaker guarantee than the
    // implementation provides.
    for (const state of ["no-record", "captured"] as const) {
      const reading = STATE_MEANING[state].ifPowerLoss.withDirectoryFlush;
      expect(reading).not.toMatch(/AMBIGUOUS/);
      expect(reading).toMatch(/flush/);
      // Still hedged on the one thing the code cannot check.
      expect(reading).toMatch(/honoured th(e|at) flush/);
      expect(reading).toMatch(/cannot verify/);
    }
    expect(STATE_MEANING.captured.ifPowerLoss.withDirectoryFlush)
      .toMatch(/absence does indicate that writes had not begun/);
  });

  it("resolves the reading from the platform's actual capability", () => {
    expect(powerLossReading("captured", false)).toBe(STATE_MEANING.captured.ifPowerLoss.withoutDirectoryFlush);
    expect(powerLossReading("captured", true)).toBe(STATE_MEANING.captured.ifPowerLoss.withDirectoryFlush);
    expect(powerLossReading("captured", true)).not.toBe(powerLossReading("captured", false));
    // Presence-based states read the same either way.
    expect(powerLossReading("completed", true)).toBe(powerLossReading("completed", false));
  });

  it("keeps the two presence-based states at full strength", () => {
    // Presence is trustworthy either way: a crash cannot manufacture a file.
    for (const state of ["writing", "completed"] as const) {
      for (const flush of [true, false]) {
        const reading = powerLossReading(state, flush);
        expect(reading).toMatch(/no weaker/);
        expect(reading).not.toMatch(/AMBIGUOUS/);
      }
    }
  });

  it("marks exactly the absence-based readings as absence-dependent", () => {
    expect(dependsOnAbsence("no-record")).toBe(true);
    expect(dependsOnAbsence("captured")).toBe(true);
    expect(dependsOnAbsence("writing")).toBe(false);
    expect(dependsOnAbsence("completed")).toBe(false);
  });

  it("separates what was observed from what is inferred from it", () => {
    for (const state of ["no-record", "captured", "writing", "completed"] as const) {
      const reading = STATE_MEANING[state];
      expect(reading.observed).toBeTruthy();
      expect(reading.ifProcessInterrupted).toBeTruthy();
      expect(reading.ifPowerLoss).toBeTruthy();
      expect(reading.doesNotProve).toBeTruthy();
      // The observation itself carries no inference words.
      expect(reading.observed).not.toMatch(/prove|establish/i);
    }
  });
});

// ── real interruption ────────────────────────────────────────

describe("interruption at each durable boundary (real child processes)", () => {
  beforeEach(async () => { await buildFixture(); });

  const liveUnchanged = (): void => {
    for (const [rel, content] of Object.entries(LIVE)) expect(liveRead(rel)).toBe(content);
  };
  const fullyRolledBack = (): void => {
    expect(liveRead("naval/germany.json")).toBe("ARCHIVED GERMANY");
    expect(liveRead("naval/italy.json")).toBe("ARCHIVED ITALY");
    expect(liveRead("index.json")).toBe("ARCHIVED INDEX");
    expect(liveRead("naval/romania.json")).toBeNull(); // null meant "delete"
  };
  const pointer = (): string | null => {
    try {
      return (JSON.parse(fs.readFileSync(path.join(tmp, "published", "active.json"), "utf-8")) as { version: string }).version;
    } catch { return null; }
  };

  it("before the recovery point: nothing persisted, nothing written", async () => {
    const { code, out } = runChild("before-recovery");
    expect(code).toBe(9);
    expect(out).toContain("DIED_AT:before-recovery");

    expect((await readRollbackRunStatus(runDir)).state).toBe("no-record");
    liveUnchanged();
    expect(pointer()).toBeNull();
  });

  it("after the recovery point, before the marker: recoverable and provably unwritten", async () => {
    const { code } = runChild("after-recovery");
    expect(code).toBe(9);

    const status = await readRollbackRunStatus(runDir);
    expect(status.state).toBe("captured");
    // The artefact survived a real process death intact and verifiable.
    expect(status.recoveryPointError).toBeNull();
    expect(status.recoveryPoint?.snapshot).toEqual({
      "naval/germany.json": "LIVE GERMANY",
      "naval/italy.json": "LIVE ITALY",
      "naval/romania.json": "LIVE ROMANIA (added by the promotion)",
      "index.json": "LIVE INDEX",
    });
    liveUnchanged();
    expect(pointer()).toBeNull();
  });

  it("after the marker, before the first file write: marked, but nothing changed yet", async () => {
    const { code } = runChild("after-marker");
    expect(code).toBe(9);

    const status = await readRollbackRunStatus(runDir);
    expect(status.state).toBe("writing");
    expect(status.markerError).toBeNull();
    expect(status.markerMismatch).toBe(false);
    // "writing" does not mean anything was written — and here nothing was.
    liveUnchanged();
    expect(pointer()).toBeNull();
  });

  it("mid-restore: files are part-way, and the recovery point still describes the original", async () => {
    const { code, out } = runChild("mid-files", 2);
    expect(code).toBe(9);
    expect(out).toMatch(/DIED_AT:mid-files:2/);

    const status = await readRollbackRunStatus(runDir);
    expect(status.state).toBe("writing");

    // Genuinely part-way: some live, some archived. This is the state that
    // was previously unrecoverable.
    const values = Object.keys(LIVE).map((rel) => liveRead(rel));
    const archived = values.filter((v) => v !== null && v.startsWith("ARCHIVED")).length;
    expect(archived).toBeGreaterThan(0);
    expect(archived).toBeLessThan(Object.keys(LIVE).length);

    // And every original byte is still recoverable from the artefact.
    expect(status.recoveryPoint?.snapshot).toEqual({
      "naval/germany.json": "LIVE GERMANY",
      "naval/italy.json": "LIVE ITALY",
      "naval/romania.json": "LIVE ROMANIA (added by the promotion)",
      "index.json": "LIVE INDEX",
    });
    expect(pointer()).toBeNull();
  });

  it("after all files, before activation: content rolled back, pointer untouched", async () => {
    const { code } = runChild("after-files");
    expect(code).toBe(9);

    expect((await readRollbackRunStatus(runDir)).state).toBe("writing");
    fullyRolledBack();
    expect(pointer()).toBeNull();
  });

  it("after activation, before completion: pointer moved, run still reads as writing", async () => {
    const { code } = runChild("after-activation");
    expect(code).toBe(9);

    const status = await readRollbackRunStatus(runDir);
    expect(status.state).toBe("writing");
    expect(status.completion).toBeNull();
    fullyRolledBack();
    // The pointer really did move, so "writing" is understating the run —
    // the safe direction, and exactly why a missing completion record is
    // never read as proof of failure.
    expect(pointer()).toBe("v1");
  });

  it("uninterrupted: completed, with every artefact intact", async () => {
    const { code, out } = runChild("none");
    expect(code).toBe(0);
    expect(out).toContain("COMPLETED");

    const status = await readRollbackRunStatus(runDir);
    expect(status.state).toBe("completed");
    expect(status.recoveryPointError).toBeNull();
    expect(status.markerError).toBeNull();
    expect(status.completionError).toBeNull();
    expect(status.completion?.activatedVersion).toBe("v1");
    fullyRolledBack();
    expect(pointer()).toBe("v1");
  });

  it("retrying after a mid-restore interruption converges on the target", async () => {
    runChild("mid-files", 2, "attempt-1");
    const firstDir = path.join(snapshotsRoot, TYPE, "attempt-1");
    const firstCapture = (await readRollbackRunStatus(firstDir)).recoveryPoint?.snapshot;

    // A retry is a new run with its own id, exactly as rollbackLocked does.
    const { code } = runChild("none", 1, "attempt-2");
    expect(code).toBe(0);
    fullyRolledBack();

    // The interrupted attempt's recovery point is untouched and still holds
    // the ORIGINAL live bytes — so the state before the first attempt stays
    // recoverable even after the retry has succeeded. A retry that reused
    // one run directory would have overwritten it with the half-rolled-back
    // state it found, losing the only record of where this started.
    const first = await readRollbackRunStatus(firstDir);
    expect(first.state).toBe("writing");
    expect(first.recoveryPoint?.snapshot).toEqual(firstCapture);
    expect(first.recoveryPoint?.snapshot).toEqual({
      "naval/germany.json": "LIVE GERMANY",
      "naval/italy.json": "LIVE ITALY",
      "naval/romania.json": "LIVE ROMANIA (added by the promotion)",
      "index.json": "LIVE INDEX",
    });

    // The retry recorded what IT found — a half-rolled-back tree — which is
    // the truthful capture for that run, and sits beside the first.
    const second = await readRollbackRunStatus(path.join(snapshotsRoot, TYPE, "attempt-2"));
    expect(second.state).toBe("completed");
    expect(second.recoveryPoint?.snapshot).not.toEqual(firstCapture);
    expect(fs.readdirSync(path.join(snapshotsRoot, TYPE)).sort())
      .toEqual(["attempt-1", "attempt-2", TARGET_RUN]);
  });

  it("the target manifest is never touched by any of it", async () => {
    const targetPath = path.join(snapshotsRoot, TYPE, TARGET_RUN, "manifest.json");
    const bytes = fs.readFileSync(targetPath);
    for (const phase of ["after-recovery", "after-marker", "mid-files", "after-files", "none"]) {
      runChild(phase, 2);
      expect(fs.readFileSync(targetPath).equals(bytes)).toBe(true);
    }
  });
});

// ── persistence failure must precede any destructive write ───

describe("a recovery point or marker that cannot be persisted stops the rollback", () => {
  beforeEach(async () => { await buildFixture(); });

  it("no file is written when the recovery point cannot be stored", async () => {
    const realOpen = jest.requireActual<typeof fsp>("fs/promises").open;
    jest.spyOn(fsp, "open").mockImplementation((async (p: string, flags: unknown) => {
      if (String(p).includes("pre-rollback.json")) throw new Error("ENOSPC writing recovery point");
      return realOpen(p as never, flags as never);
    }) as never);

    await expect(
      writeRecoveryPoint(recoveryPointPath(runDir), {
        type: TYPE, runId: ROLLBACK_RUN, restoredFromRunId: TARGET_RUN, activeVersionAtCapture: null,
      }, { "naval/germany.json": "LIVE GERMANY" }),
    ).rejects.toThrow("ENOSPC");

    jest.restoreAllMocks();
    expect(fs.existsSync(recoveryPointPath(runDir))).toBe(false);
    // Every live byte untouched: the sequence never reached a write.
    for (const [rel, content] of Object.entries(LIVE)) expect(liveRead(rel)).toBe(content);
  });

  it("leaves no partial artefact when the flush fails", async () => {
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
      writeRecoveryPoint(recoveryPointPath(runDir), {
        type: TYPE, runId: ROLLBACK_RUN, restoredFromRunId: TARGET_RUN, activeVersionAtCapture: null,
      }, { "a.json": "X" }),
    ).rejects.toThrow("EIO on fsync");

    jest.restoreAllMocks();
    expect(fs.existsSync(recoveryPointPath(runDir))).toBe(false);
    expect(fs.existsSync(runDir) ? fs.readdirSync(runDir) : []).toEqual([]);
  });

  it("rollback persists both artefacts before its first destructive write", () => {
    // Ordering inside rollbackLocked, which cannot be executed with
    // PROMOTION_ENABLED false. The child-process tests above are what prove
    // the filesystem outcomes; this pins the ordering in the real method.
    const source = fs.readFileSync(path.resolve(__dirname, "../promotion.service.ts"), "utf-8");
    const body = source.slice(
      source.indexOf("private async rollbackLocked("),
      source.indexOf("  }\n}", source.indexOf("private async rollbackLocked(")),
    );
    expect(body.indexOf("writeRecoveryPoint")).toBeLessThan(body.indexOf("restoreFromSnapshot"));
    expect(body.indexOf("writeWriteMarker")).toBeLessThan(body.indexOf("restoreFromSnapshot"));
    expect(body.indexOf("writeRecoveryPoint")).toBeLessThan(body.indexOf("writeWriteMarker"));
    // Both failures abort before any write, rather than being downgraded.
    const recoveryBlock = body.slice(body.indexOf("writeRecoveryPoint"), body.indexOf("restoreFromSnapshot"));
    expect(recoveryBlock.match(/abortBeforeAnyWrite\("recovery-metadata"/g)).toHaveLength(2);
    // The completion record is last, and after activation.
    expect(body.indexOf("writeCompletion")).toBeGreaterThan(body.indexOf("captureAndActivateVersion"));
  });
});

/**
 * F3 — a restore that resolves is not a restore that landed.
 *
 * Every write is a rename. A rename that resolves without moving anything —
 * a stubbed layer, a silently failing driver — left the content untouched
 * while the call reported success. Taken on trust, that produced a rollback
 * with status "success", a filesAffected list, an activated version and a
 * completion record, over content that was never written.
 *
 * verifyAgainstSnapshot is what the rollback now calls before activating, so
 * these drive it against real files rather than asserting on source text.
 */
describe("verifying that a restore actually landed", () => {
  const LANDED: PromotionSnapshot = {
    "naval/germany.json": "ARCHIVED GERMANY",
    "naval/italy.json": "ARCHIVED ITALY",
    "naval/romania.json": null,
    "index.json": "ARCHIVED INDEX",
  };

  it("passes when every file really is at the target", async () => {
    for (const [rel, content] of Object.entries(LANDED)) {
      if (content !== null) liveWrite(rel, content);
    }
    const result = await verifyAgainstSnapshot(contentDir, LANDED);
    expect(result).toEqual({ matched: true, mismatched: [] });
  });

  it("fails when a rename silently did nothing", async () => {
    await buildFixture();
    const realRename = jest.requireActual<typeof fsp>("fs/promises").rename;
    jest.spyOn(fsp, "rename").mockImplementation(((from: string, to: string) => {
      if (path.basename(String(to)) === "italy.json") return Promise.resolve(); // pretends to work
      return realRename(from, String(to));
    }) as never);

    // The restore reports success...
    const { restored } = await restoreFromSnapshot(contentDir, TARGET);
    expect(restored).toHaveLength(4);

    jest.restoreAllMocks();
    // ...and the bytes say otherwise.
    const result = await verifyAgainstSnapshot(contentDir, TARGET);
    expect(result.matched).toBe(false);
    expect(result.mismatched).toEqual(["naval/italy.json"]);
    expect(liveRead("naval/italy.json")).toBe("LIVE ITALY");
  });

  it("fails when a file that should have been DELETED is still there", async () => {
    // The half a verification would miss if it only checked files with
    // content: TARGET says romania.json did not exist.
    await buildFixture();
    const realRm = jest.requireActual<typeof fsp>("fs/promises").rm;
    jest.spyOn(fsp, "rm").mockImplementation(((p: string, opts: unknown) => {
      if (String(p).endsWith("romania.json")) return Promise.resolve(); // pretends to delete
      return realRm(p as never, opts as never);
    }) as never);

    const { restored } = await restoreFromSnapshot(contentDir, TARGET);
    expect(restored).toContain("naval/romania.json");

    jest.restoreAllMocks();
    const result = await verifyAgainstSnapshot(contentDir, TARGET);
    expect(result.matched).toBe(false);
    expect(result.mismatched).toEqual(["naval/romania.json"]);
    expect(liveRead("naval/romania.json")).toBe("LIVE ROMANIA (added by the promotion)");
  });

  it("reports every mismatch in a multi-file partial restoration", async () => {
    await buildFixture();
    const realRename = jest.requireActual<typeof fsp>("fs/promises").rename;
    jest.spyOn(fsp, "rename").mockImplementation(((from: string, to: string) => {
      const base = path.basename(String(to));
      if (base === "italy.json" || base === "index.json") return Promise.resolve();
      return realRename(from, String(to));
    }) as never);

    await restoreFromSnapshot(contentDir, TARGET);
    jest.restoreAllMocks();

    const result = await verifyAgainstSnapshot(contentDir, TARGET);
    expect(result.mismatched.sort()).toEqual(["index.json", "naval/italy.json"]);
    // The one that did land is not reported.
    expect(liveRead("naval/germany.json")).toBe("ARCHIVED GERMANY");
  });

  it("counts an unreadable file as unverified rather than as matching", async () => {
    for (const [rel, content] of Object.entries(LANDED)) {
      if (content !== null) liveWrite(rel, content);
    }
    const realReadFile = jest.requireActual<typeof fsp>("fs/promises").readFile;
    jest.spyOn(fsp, "readFile").mockImplementation(((p: string, enc: unknown) => {
      if (String(p).endsWith("index.json")) {
        const e = new Error("EACCES") as NodeJS.ErrnoException;
        e.code = "EACCES";
        return Promise.reject(e);
      }
      return realReadFile(p as never, enc as never);
    }) as never);

    const result = await verifyAgainstSnapshot(contentDir, LANDED);
    expect(result.matched).toBe(false);
    expect(result.mismatched).toEqual(["index.json"]);
  });

  it("writes nothing itself", async () => {
    await buildFixture();
    const spies = (["writeFile", "rename", "rm", "unlink", "mkdir"] as const)
      .map((fn) => jest.spyOn(fsp, fn));

    await verifyAgainstSnapshot(contentDir, TARGET);

    for (const spy of spies) expect(spy).not.toHaveBeenCalled();
  });

  it("resolves a legacy Windows key and reports it portably", async () => {
    liveWrite("naval/germany.json", "ARCHIVED GERMANY");
    const legacy = { "naval\\germany.json": "SOMETHING ELSE" } as PromotionSnapshot;
    const result = await verifyAgainstSnapshot(contentDir, legacy);
    expect(result.mismatched).toEqual(["naval/germany.json"]);
  });
});

describe("a silently failed restore cannot produce a successful rollback", () => {
  /**
   * The whole success path, modelled end to end with the real units, with a
   * rename that lies. What is asserted is the outcome on disk and the
   * decision taken — not that a helper was called.
   */
  async function rollbackSequenceWithLyingRename(lieAbout: string): Promise<{
    activated: boolean;
    aborted: PromotionAbortedError | null;
  }> {
    await buildFixture();
    const before: PromotionSnapshot = {};
    for (const key of Object.keys(TARGET)) {
      const normalized = key.replace(/\\/g, "/");
      before[normalized] = liveRead(normalized);
    }

    const realRename = jest.requireActual<typeof fsp>("fs/promises").rename;
    jest.spyOn(fsp, "rename").mockImplementation(((from: string, to: string) => {
      if (path.basename(String(to)) === lieAbout) return Promise.resolve();
      return realRename(from, String(to));
    }) as never);

    let aborted: PromotionAbortedError | null = null;
    let activated = false;
    try {
      await restoreFromSnapshot(contentDir, TARGET);
      const landed = await verifyAgainstSnapshot(contentDir, TARGET);
      if (!landed.matched) {
        throw await abortBeforeActivation(
          "content",
          new Error(
            `the restore reported success but ${landed.mismatched.length} of ` +
              `${Object.keys(TARGET).length} file(s) do not match the target snapshot ` +
              `(${landed.mismatched.join(", ")})`,
          ),
          contentDir,
          before,
        );
      }
      activated = true; // only reachable when verification passed
    } catch (err) {
      aborted = err as PromotionAbortedError;
    } finally {
      jest.restoreAllMocks();
    }
    return { activated, aborted };
  }

  it("does not activate, and says the restore did not match", async () => {
    const { activated, aborted } = await rollbackSequenceWithLyingRename("italy.json");

    expect(activated).toBe(false);
    expect(aborted?.name).toBe("PromotionAbortedError");
    expect(aborted?.stage).toBe("content");
    expect(aborted?.originalError.message).toMatch(/restore reported success but 1 of 4/);
    expect(aborted?.originalError.message).toContain("naval/italy.json");
  });

  it("puts the pre-rollback state back, and verifies it", async () => {
    const { aborted } = await rollbackSequenceWithLyingRename("italy.json");

    expect(aborted?.restoration).toBe("verified");
    expect(aborted?.requiresManualVerification).toBe(false);
    expect(aborted?.unverifiedPaths).toEqual([]);

    // Every live byte is back where it started — including the file the
    // restore had successfully changed before the lie was detected.
    for (const [rel, content] of Object.entries(LIVE)) expect(liveRead(rel)).toBe(content);
  });

  it("restores a file the rollback had deleted", async () => {
    // romania.json is deleted by the rollback (TARGET says null) and must
    // come back when the rollback is abandoned.
    const { aborted } = await rollbackSequenceWithLyingRename("index.json");

    expect(aborted?.restoration).toBe("verified");
    expect(liveRead("naval/romania.json")).toBe("LIVE ROMANIA (added by the promotion)");
  });

  it("demands manual verification when the compensating restore also fails", async () => {
    // Both failures preserved: the verification mismatch that stopped it,
    // and the restore that could not put things back.
    await buildFixture();
    const before: PromotionSnapshot = {};
    for (const key of Object.keys(TARGET)) before[key.replace(/\\/g, "/")] = liveRead(key.replace(/\\/g, "/"));

    const realRename = jest.requireActual<typeof fsp>("fs/promises").rename;
    jest.spyOn(fsp, "rename").mockImplementation(((from: string, to: string) => {
      // Never move italy.json: the restore's write lies, and so does the
      // compensating restore's write.
      if (path.basename(String(to)) === "italy.json") return Promise.resolve();
      return realRename(from, String(to));
    }) as never);

    await restoreFromSnapshot(contentDir, TARGET);
    const landed = await verifyAgainstSnapshot(contentDir, TARGET);
    expect(landed.matched).toBe(false);

    const aborted = await abortBeforeActivation(
      "content", new Error("verification failed"), contentDir, { ...before, "naval/italy.json": "DIFFERENT" },
    ).catch((e: unknown) => e as PromotionAbortedError);
    jest.restoreAllMocks();

    expect(aborted.restoration).toBe("failed");
    expect(aborted.requiresManualVerification).toBe(true);
    expect(aborted.unverifiedPaths).toContain("naval/italy.json");
    expect(aborted.originalError.message).toBe("verification failed");
  });

  it("the rollback method performs this check before activating", () => {
    // Ordering inside rollbackLocked, which cannot be executed with
    // PROMOTION_ENABLED false. The behaviour itself is proven above on real
    // files; this only pins that the method does it in the right place.
    const source = fs.readFileSync(path.resolve(__dirname, "../promotion.service.ts"), "utf-8");
    const body = source.slice(
      source.indexOf("private async rollbackLocked("),
      source.indexOf("  }\n}", source.indexOf("private async rollbackLocked(")),
    );
    const verify = body.indexOf("verifyAgainstSnapshot(targetDir, snapshot)");
    expect(verify).toBeGreaterThan(body.indexOf("restoreFromSnapshot"));
    expect(verify).toBeLessThan(body.indexOf("captureAndActivateVersion"));
    expect(verify).toBeLessThan(body.indexOf("completeAfterActivation"));
    expect(verify).toBeLessThan(body.indexOf("writeCompletion"));
    expect(body).toContain("if (!landed.matched) {");
    expect(body).toContain('abortBeforeActivation(\n        "content",');
  });
});

describe("durability is reported as achieved, not as intended", () => {
  it("flushes the artefact's bytes, and says whether the directory entry followed", async () => {
    const { report } = await writeRecoveryPoint(recoveryPointPath(runDir), {
      type: TYPE, runId: ROLLBACK_RUN, restoredFromRunId: TARGET_RUN, activeVersionAtCapture: null,
    }, { "a.json": "X" });

    expect(report.fileSynced).toBe(true);
    if (process.platform === "win32") {
      // Unchanged from Stage 2 and still true: Node cannot fsync a directory
      // here, so the rename is atomic but its durability rests on NTFS
      // metadata journalling rather than on an explicit flush.
      expect(report.directorySynced).toBe(false);
      expect(report.directorySyncSkipped).toContain("win32");
    } else {
      expect(report.directorySynced).toBe(true);
    }
  });

  it("applies the same reporting to the marker and the completion record", async () => {
    const marker = await writeWriteMarker(writeMarkerPath(runDir), {
      type: TYPE, runId: ROLLBACK_RUN, restoredFromRunId: TARGET_RUN,
      recoveryChecksum: "a".repeat(64), fileCount: 1,
    });
    const done = await writeCompletion(completionPath(runDir), {
      type: TYPE, runId: ROLLBACK_RUN, restoredFromRunId: TARGET_RUN,
      activatedVersion: null, filesRestored: 1,
    });
    for (const report of [marker, done]) {
      expect(report.fileSynced).toBe(true);
      expect(report.directorySynced).toBe(process.platform !== "win32");
    }
  });
});

describe("artefacts are never pruned by this stage", () => {
  it("a second rollback run's artefacts sit beside the first", async () => {
    const store = createVersionStore(path.join(tmp, "published"));
    expect(await store.listVersions()).toEqual([]);

    for (const id of ["run-a", "run-b", "run-c"]) {
      await writeRecoveryPoint(path.join(snapshotsRoot, TYPE, id, "pre-rollback.json"), {
        type: TYPE, runId: id, restoredFromRunId: TARGET_RUN, activeVersionAtCapture: null,
      }, { "a.json": "X" });
    }

    expect(fs.readdirSync(path.join(snapshotsRoot, TYPE)).sort()).toEqual(["run-a", "run-b", "run-c"]);
    for (const id of ["run-a", "run-b", "run-c"]) {
      expect((await readRollbackRunStatus(path.join(snapshotsRoot, TYPE, id))).state).toBe("captured");
    }
  });
});
