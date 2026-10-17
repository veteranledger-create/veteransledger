import fs from "fs/promises";
import path from "path";
import { storageConfig } from "../config/storage";
import { paths } from "../config/paths";
import { versionStore, VersionStore } from "../modules/publish/version-store";
import { readForSnapshot, PromotionSnapshot, normalizeSnapshotKey, resolveSnapshotPath } from "../modules/publish/promote-atomic";
import { readSnapshotManifest, directoryFsyncAvailable } from "../modules/publish/snapshot-manifest";
import {
  readRollbackRunStatus,
  RollbackRunStatus,
  RollbackState,
  StateReading,
  STATE_MEANING,
  dependsOnAbsence,
  powerLossReading,
} from "../modules/publish/rollback-recovery";

/**
 * Reports what a rollback run left on disk, and where the live files
 * actually stand relative to it. Changes nothing.
 *
 * The markers alone cannot tell you whether an interrupted rollback wrote
 * any files — "writing" means only that writes were about to begin. What
 * answers that is comparing the live files against the two states the
 * rollback sits between: its recovery point (where it came from) and the
 * target manifest (where it was going). That comparison is pure reading,
 * so it belongs here.
 *
 * READ-ONLY, deliberately and completely. It opens files for reading, and
 * does nothing else: no write, no mkdir, no rename, no unlink, no repair,
 * no activation, no rollback, no pruning. Discovering a recovery point does
 * not cause it to be applied — deciding to act on one is an operator's call,
 * and this command exists to inform that call rather than pre-empt it.
 *
 * Usage:
 *   npx ts-node src/scripts/inspect-rollback.ts <type>
 *   npx ts-node src/scripts/inspect-rollback.ts <type> <runId>
 */

/** Where one live file stands relative to the two states it sits between. */
export type FileStanding =
  | "matches-pre-rollback"
  | "matches-target"
  | "matches-both"
  | "matches-neither"
  | "unreadable"
  | "not-in-target";

export interface FileComparison {
  key: string;
  standing: FileStanding;
  detail?: string;
}

/**
 * Whether the live files agree with what the state claims.
 *
 * The point of checking: a state whose reading rests on an artefact being
 * ABSENT is only as sound as the platform's ability to make absence
 * meaningful. Where it cannot, the files are the better witness.
 */
export type StateEvidence = "consistent" | "contradicted" | "not-comparable";

export interface RollbackInspection {
  type: string;
  runId: string;
  state: RollbackState;
  /** Split by failure mode: a power loss supports a weaker reading. */
  meaning: StateReading;
  /** meaning.ifPowerLoss resolved for this platform's actual capability. */
  powerLossReading: string;
  /**
   * Whether this reading leans on absence, and so is weakened where a
   * directory entry cannot be flushed.
   */
  readingDependsOnAbsence: boolean;
  /** The platform limitation, stated whether or not it currently bites. */
  durabilityCaveat: string;
  evidence: StateEvidence;
  /** Set when the live files contradict what the state claims. */
  evidenceConflict: string | null;
  status: RollbackRunStatus;
  /** The promotion this rollback was restoring, when the artefact names one. */
  restoredFromRunId: string | null;
  targetManifestValid: boolean | null;
  targetManifestError: string | null;
  activeVersionAtCapture: string | null;
  activeVersionNow: string | null;
  comparison: FileComparison[] | null;
  comparisonNote: string;
}

function summarise(files: FileComparison[]): Record<FileStanding, number> {
  const counts = {
    "matches-pre-rollback": 0, "matches-target": 0, "matches-both": 0,
    "matches-neither": 0, unreadable: 0, "not-in-target": 0,
  } as Record<FileStanding, number>;
  for (const f of files) counts[f.standing]++;
  return counts;
}

/**
 * Compares the live files against both states, without touching either.
 *
 * Uses readForSnapshot, so a file that exists but cannot be read is reported
 * as unreadable rather than silently counted as absent — the same rule the
 * capture path follows, for the same reason.
 */
async function compareLiveFiles(
  contentDir: string,
  before: PromotionSnapshot,
  target: PromotionSnapshot | null,
): Promise<FileComparison[]> {
  const normalisedTarget = new Map<string, string | null>();
  if (target) {
    for (const [k, v] of Object.entries(target)) normalisedTarget.set(normalizeSnapshotKey(k), v);
  }

  const out: FileComparison[] = [];
  for (const [rawKey, beforeValue] of Object.entries(before)) {
    const key = normalizeSnapshotKey(rawKey);
    let live: string | null;
    try {
      live = await readForSnapshot(resolveSnapshotPath(contentDir, rawKey), key);
    } catch (err) {
      out.push({ key, standing: "unreadable", detail: (err as Error).message });
      continue;
    }

    const matchesBefore = live === beforeValue;
    if (!normalisedTarget.has(key)) {
      out.push({
        key,
        standing: matchesBefore ? "matches-pre-rollback" : "not-in-target",
        detail: matchesBefore ? undefined : "differs from the recovery point and the target does not cover it",
      });
      continue;
    }

    const matchesTarget = live === normalisedTarget.get(key);
    const standing: FileStanding =
      matchesBefore && matchesTarget ? "matches-both"
        : matchesBefore ? "matches-pre-rollback"
          : matchesTarget ? "matches-target"
            : "matches-neither";
    out.push({ key, standing });
  }
  return out;
}

export async function inspectRollbackRun(
  type: string,
  runId: string,
  opts: { snapshotsRoot?: string; contentDir?: string; store?: VersionStore } = {},
): Promise<RollbackInspection> {
  const snapshotsRoot = opts.snapshotsRoot ?? storageConfig.directories.publishSnapshots;
  const contentDir = opts.contentDir ?? paths.published.dir(type);
  const store = opts.store ?? versionStore;

  const runDir = path.join(snapshotsRoot, type, runId);
  const status = await readRollbackRunStatus(runDir);
  const meaning = STATE_MEANING[status.state];

  const restoredFromRunId =
    status.recoveryPoint?.restoredFromRunId ??
    status.marker?.restoredFromRunId ??
    status.completion?.restoredFromRunId ??
    null;

  let target: PromotionSnapshot | null = null;
  let targetManifestValid: boolean | null = null;
  let targetManifestError: string | null = null;
  if (restoredFromRunId) {
    try {
      target = (await readSnapshotManifest(
        path.join(snapshotsRoot, type, restoredFromRunId, "manifest.json"),
      )).snapshot;
      targetManifestValid = true;
    } catch (err) {
      targetManifestValid = false;
      targetManifestError = (err as Error).message;
    }
  }

  let activeVersionNow: string | null = null;
  try {
    activeVersionNow = await store.readActiveVersion();
  } catch {
    activeVersionNow = null;
  }

  let comparison: FileComparison[] | null = null;
  let comparisonNote: string;
  if (!status.recoveryPoint) {
    comparisonNote = status.recoveryPointError
      ? `No usable recovery point, so the live files cannot be placed: ${status.recoveryPointError}`
      : "No recovery point for this run, so there is nothing to compare the live files against.";
  } else {
    comparison = await compareLiveFiles(contentDir, status.recoveryPoint.snapshot, target);
    comparisonNote = target
      ? "Live files compared against the recovery point and the target manifest."
      : "Live files compared against the recovery point only; the target manifest could not be read.";
  }

  // Does the tree agree with what the state claims? Only meaningful for a
  // state whose reading rests on absence — "captured" asserts that writes had
  // not begun, and a live file that no longer matches the recovery point says
  // otherwise. That is the signature of a marker that was lost rather than
  // never written, which is exactly what an unflushed directory entry does.
  const directoryFlush = directoryFsyncAvailable();

  let evidence: StateEvidence = "not-comparable";
  let evidenceConflict: string | null = null;
  if (comparison) {
    const moved = comparison.filter(
      (c) => c.standing === "matches-target" || c.standing === "matches-neither" || c.standing === "not-in-target",
    );
    if (dependsOnAbsence(status.state) && moved.length > 0) {
      evidence = "contradicted";
      // The explanation depends on the platform, because the reason a marker
      // can be missing does. Where a directory entry IS flushed, a lost
      // marker is not the likely story and saying so would be wrong.
      const why = directoryFlush
        ? "This platform does flush a directory entry, so a lost marker is not the " +
          "expected explanation — something other than this run may have written these " +
          "files, or the filesystem did not honour the flush. Either way the files are " +
          "the evidence and the state reading is not."
        : "Trust the files, not the missing artefact: this platform does not flush a " +
          "directory entry, so the write marker can have been lost rather than never " +
          "written.";
      evidenceConflict =
        `State "${status.state}" would mean no destructive write had begun, but ` +
        `${moved.length} of ${comparison.length} live file(s) no longer match the recovery ` +
        `point (${moved.slice(0, 5).map((m) => m.key).join(", ")}${moved.length > 5 ? ", …" : ""}). ` +
        `Writes DID begin. ${why}`;
    } else {
      evidence = "consistent";
    }
  }

  const caveat = directoryFlush
    ? `This platform (${process.platform}) can flush a directory entry, and this code does ` +
      "so before returning, so a missing artefact after a crash does indicate it was not " +
      "written — insofar as the filesystem honoured the flush, which cannot be verified " +
      "from here."
    : `This platform (${process.platform}) cannot flush a directory entry: fsync on a ` +
      "directory fails, so no artefact's name is explicitly made durable. After a possible " +
      "power loss or OS crash, the ABSENCE of an artefact proves nothing — it may never have " +
      "been written, or it may have been written and lost. Presence remains reliable.";

  return {
    type, runId,
    state: status.state,
    meaning,
    powerLossReading: powerLossReading(status.state, directoryFlush),
    readingDependsOnAbsence: dependsOnAbsence(status.state),
    durabilityCaveat: caveat,
    evidence,
    evidenceConflict,
    status,
    restoredFromRunId,
    targetManifestValid,
    targetManifestError,
    activeVersionAtCapture: status.recoveryPoint?.activeVersionAtCapture ?? null,
    activeVersionNow,
    comparison,
    comparisonNote,
  };
}

/** Run ids under a type that carry at least one rollback artefact. */
export async function listRollbackRuns(
  type: string,
  snapshotsRoot: string = storageConfig.directories.publishSnapshots,
): Promise<string[]> {
  const typeDir = path.join(snapshotsRoot, type);
  let entries: import("fs").Dirent[];
  try {
    entries = await fs.readdir(typeDir, { withFileTypes: true });
  } catch {
    return [];
  }

  const found: string[] = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const status = await readRollbackRunStatus(path.join(typeDir, entry.name));
    if (status.state !== "no-record") found.push(entry.name);
  }
  return found.sort();
}

export function formatInspection(report: RollbackInspection): string {
  const lines: string[] = [];
  const s = report.status;

  lines.push(`Rollback run ${report.runId}  (${report.type})`);
  lines.push(`  state:              ${report.state}`);
  lines.push(`  observed:           ${report.meaning.observed}`);
  lines.push(`  if process killed:  ${report.meaning.ifProcessInterrupted}`);
  lines.push(`  if power loss:      ${report.powerLossReading}`);
  lines.push(`  does NOT prove:     ${report.meaning.doesNotProve}`);
  if (report.readingDependsOnAbsence && !directoryFsyncAvailable()) {
    lines.push("  AMBIGUOUS:          this state's reading rests on an artefact being absent,");
    lines.push("                      which this platform cannot make meaningful after a crash.");
  }
  lines.push(`  durability:         ${report.durabilityCaveat}`);
  if (report.evidenceConflict) {
    lines.push(`  CONTRADICTED:       ${report.evidenceConflict}`);
  }
  lines.push(`  restored from:      ${report.restoredFromRunId ?? "unknown"}`);

  lines.push(`  recovery point:     ${
    s.recoveryPoint
      ? `valid, ${Object.keys(s.recoveryPoint.snapshot).length} file(s), captured ${s.recoveryPoint.capturedAt}`
      : s.recoveryPointError ? `UNUSABLE — ${s.recoveryPointError}` : "absent"}`);
  lines.push(`  write marker:       ${
    s.marker ? `present, ${s.marker.fileCount} file(s) intended` : s.markerError ? `UNUSABLE — ${s.markerError}` : "absent"}`);
  lines.push(`  completion record:  ${
    s.completion
      ? `present, activated ${s.completion.activatedVersion ?? "no version"}, ${s.completion.filesRestored} file(s)`
      : s.completionError ? `UNUSABLE — ${s.completionError}` : "absent"}`);
  if (s.markerMismatch) {
    lines.push("  WARNING:            the write marker names a different recovery point than the one present.");
  }

  lines.push(`  target manifest:    ${
    report.targetManifestValid === null ? "not identified"
      : report.targetManifestValid ? "valid" : `UNUSABLE — ${report.targetManifestError}`}`);
  lines.push(`  CURRENT at capture: ${report.activeVersionAtCapture ?? "none"}`);
  lines.push(`  CURRENT now:        ${report.activeVersionNow ?? "none"}`);

  if (report.comparison) {
    const counts = summarise(report.comparison);
    lines.push(`  live files:         ${report.comparisonNote}`);
    for (const [standing, n] of Object.entries(counts)) {
      if (n > 0) lines.push(`      ${standing.padEnd(22)} ${n}`);
    }
    for (const f of report.comparison) {
      if (f.standing === "unreadable" || f.standing === "matches-neither") {
        lines.push(`      ! ${f.key}: ${f.standing}${f.detail ? ` — ${f.detail}` : ""}`);
      }
    }
  } else {
    lines.push(`  live files:         ${report.comparisonNote}`);
  }

  lines.push("");
  lines.push("  This command changed nothing. Acting on a recovery point is a manual decision.");
  return lines.join("\n");
}

/**
 * Only when invoked directly. Importing this module — which the tests do,
 * and nothing in the application does — must never read or report anything
 * on its own.
 */
if (require.main === module) {
  const [type, runId] = process.argv.slice(2);
  void (async () => {
    if (!type) {
      console.error("Usage: npx ts-node src/scripts/inspect-rollback.ts <type> [runId]");
      process.exit(2);
    }
    const runs = runId ? [runId] : await listRollbackRuns(type);
    if (runs.length === 0) {
      console.log(`[inspect-rollback] No rollback artefacts found for type "${type}".`);
      process.exit(0);
    }
    for (const id of runs) {
      console.log(formatInspection(await inspectRollbackRun(type, id)));
    }
    process.exit(0);
  })().catch((err: unknown) => {
    console.error(`[inspect-rollback] FAILED  ${(err as Error).message}`);
    process.exit(1);
  });
}
