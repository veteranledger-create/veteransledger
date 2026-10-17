import fs from "fs/promises";
import path from "path";
import { sha256 } from "../editorial-history/revision-store";
import { PromotionSnapshot } from "./promote-atomic";
import {
  CHECKSUM_ALGORITHM,
  DurabilityReport,
  ManifestInvalidError,
  ManifestMissingError,
  SNAPSHOT_FORMAT_VERSION,
  canonicalSnapshot,
  snapshotChecksum,
  validateSnapshotShape,
  writeJsonAtomically,
} from "./snapshot-manifest";

/**
 * The durable record of what a rollback was about to replace, and how far it
 * got.
 *
 * ── Why this exists ─────────────────────────────────────────
 *
 * A rollback restores a *promotion's* snapshot manifest. That manifest
 * describes the state before that promotion — which is where the rollback is
 * going. It says nothing about where the rollback is coming *from*. The live
 * state immediately before a rollback was held in a local variable and
 * nowhere else, so a process that died part-way through the restore left
 * public/data in an arbitrary intermediate state with no record of what it
 * had been. The in-memory compensation only ever worked for an exception the
 * process lived long enough to catch.
 *
 * Four states are kept apart deliberately, because they are not the same:
 *
 *   A. the state being restored TO   — the promotion's manifest.json
 *   B. the state immediately BEFORE  — pre-rollback.json, written here
 *   C. the version CURRENT points at — storage/published/active.json
 *   D. the live files                — public/data
 *
 * ── Layout ──────────────────────────────────────────────────
 *
 *   storage/publish-snapshots/<type>/<rollbackRunId>/
 *       pre-rollback.json   the recovery point (B)
 *       writing.json        the write-start marker
 *       completed.json      written last, if the run reached the end
 *
 * The rollback's own runId is a fresh UUID, so this directory is always new
 * and can never collide with the target promotion's. manifest.json is never
 * written here — the writer refuses that filename outright, so a recovery
 * point can never be mistaken for, or overwrite, a promotion snapshot.
 *
 * ── The durable state machine ───────────────────────────────
 *
 * Four states, named by which artefacts are on disk:
 *
 *   no-record    nothing for this runId
 *   captured     pre-rollback.json only
 *   writing      pre-rollback.json + writing.json
 *   completed    all three
 *
 * What a state establishes depends entirely on HOW the run ended, and the
 * two cases are not interchangeable:
 *
 *   PROCESS INTERRUPTION, filesystem intact — the process was killed, the
 *   machine kept running, every completed rename is still on disk. Here the
 *   ordering is meaningful: the marker is written and flushed before the
 *   first destructive write, so its absence does establish that writes had
 *   not begun.
 *
 *   POWER LOSS OR OS CRASH — a rename can have completed, and later writes
 *   can have happened, while the renamed directory entry never reached the
 *   disk. On a platform where a directory cannot be fsynced (Windows: Node
 *   cannot open a directory for the handle, and fsync on it fails with
 *   EPERM — measured, see snapshot-manifest's durability test), no artefact's
 *   directory entry is explicitly flushed at all.
 *
 *   The two are worse than independent. The marker lives under
 *   storage/publish-snapshots/ and the content files under public/data/ —
 *   different directories, possibly different volumes. There is no ordering
 *   guarantee between unflushed metadata operations in different
 *   directories, so "content writes survived, the marker did not" is a
 *   reachable state, not a theoretical one.
 *
 * Hence the rule that governs every inference drawn here:
 *
 *   PRESENCE is trustworthy. A crash cannot manufacture an artefact, so an
 *   artefact that is present and verifies really was written, and the run
 *   really did reach that step.
 *
 *   ABSENCE is trustworthy ONLY where a directory entry can be flushed, or
 *   where the filesystem is known to be intact (a plain process kill).
 *   Otherwise absence is AMBIGUOUS: it may mean the step was never reached,
 *   or that it was reached and the evidence did not survive.
 *
 * So, concretely, on this platform after a possible power loss:
 *
 *   - `no-record` does NOT establish that no destructive write occurred.
 *   - `captured` does NOT establish that writes had not begun.
 *   - a missing completed.json NEVER implies the rollback failed — that was
 *     already true for a plain process kill and remains true here.
 *   - `writing` and `completed` keep their meaning, because they rest on
 *     presence rather than absence.
 *
 * Where the markers cannot settle it, the live files can be compared against
 * B and against A. That comparison is pure reading and is what the
 * inspection command does; it is also how a state's claim gets CHECKED,
 * since a `captured` run whose live files no longer match its recovery point
 * is a contradiction that says the marker was lost rather than never
 * written.
 *
 * ── Scope ───────────────────────────────────────────────────
 *
 * Nothing here recovers anything. Artefacts are written, validated and read;
 * no file under public/data is ever touched by this module, and no artefact
 * is ever pruned or deleted. Acting on a discovered artefact is a decision
 * for an operator, not a side effect of finding it.
 */

export const RECOVERY_FORMAT_VERSION = 1;
export const RECOVERY_POINT_FILE = "pre-rollback.json";
export const WRITE_MARKER_FILE = "writing.json";
export const COMPLETION_FILE = "completed.json";

const RECOVERY_KIND = "pre-rollback-snapshot";
const MARKER_KIND = "rollback-write-marker";
const COMPLETION_KIND = "rollback-completion";
const HEX_64 = /^[0-9a-f]{64}$/;

/** Reserved: a promotion's own snapshot. Never written by this module. */
const RESERVED_FILENAME = "manifest.json";

export interface RecoveryPoint {
  formatVersion: number;
  kind: typeof RECOVERY_KIND;
  /** Content type being rolled back. */
  type: string;
  /** The rollback run's own id. */
  runId: string;
  /** The promotion run whose snapshot this rollback is restoring. */
  restoredFromRunId: string;
  capturedAt: string;
  /** CURRENT as observed at capture time, or null when versioning is unused. */
  activeVersionAtCapture: string | null;
  algorithm: typeof CHECKSUM_ALGORITHM;
  checksum: string;
  /** The live state before the rollback. null = the file was absent. */
  snapshot: PromotionSnapshot;
}

export interface WriteMarker {
  formatVersion: number;
  kind: typeof MARKER_KIND;
  type: string;
  runId: string;
  restoredFromRunId: string;
  markedAt: string;
  /** Binds this marker to one recovery point, so a mismatched pair shows up. */
  recoveryChecksum: string;
  /** How many files the restore was about to touch. */
  fileCount: number;
}

export interface CompletionRecord {
  formatVersion: number;
  kind: typeof COMPLETION_KIND;
  type: string;
  runId: string;
  restoredFromRunId: string;
  completedAt: string;
  /** The version this rollback activated, or null for a non-versioned type. */
  activatedVersion: string | null;
  filesRestored: number;
}

export type RollbackState = "no-record" | "captured" | "writing" | "completed";

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function recoveryPointPath(runDir: string): string {
  return path.join(runDir, RECOVERY_POINT_FILE);
}
export function writeMarkerPath(runDir: string): string {
  return path.join(runDir, WRITE_MARKER_FILE);
}
export function completionPath(runDir: string): string {
  return path.join(runDir, COMPLETION_FILE);
}

/**
 * The bytes a marker's or completion record's checksum covers.
 *
 * Same principle as canonicalSnapshot: sorted keys as an array of pairs, so
 * the digest cannot depend on JSON key ordering. The `checksum` field itself
 * is excluded, since it cannot cover itself.
 */
function canonicalRecord(record: Record<string, unknown>): string {
  return JSON.stringify(
    Object.keys(record).filter((k) => k !== "checksum").sort().map((k) => [k, record[k]]),
  );
}

function assertNotReserved(filePath: string): void {
  if (path.basename(filePath) === RESERVED_FILENAME) {
    throw new ManifestInvalidError(
      "bad-envelope", filePath,
      `${RESERVED_FILENAME} is a promotion's own snapshot. A rollback recovery ` +
        `artefact must never be written to that name, or restoring the promotion ` +
        `it describes would become impossible.`,
    );
  }
}

// ── writing ───────────────────────────────────────────────────

/**
 * Persists the pre-rollback state.
 *
 * Must complete, durably, before the rollback's first destructive write. A
 * failure here is reported to the caller rather than swallowed: continuing
 * without it would reintroduce exactly the gap this closes.
 */
export async function writeRecoveryPoint(
  filePath: string,
  meta: {
    type: string;
    runId: string;
    restoredFromRunId: string;
    activeVersionAtCapture: string | null;
    capturedAt?: string;
  },
  snapshot: PromotionSnapshot,
): Promise<{ report: DurabilityReport; checksum: string }> {
  assertNotReserved(filePath);
  validateSnapshotShape(snapshot, filePath);

  const checksum = snapshotChecksum(snapshot);
  const point: RecoveryPoint = {
    formatVersion: RECOVERY_FORMAT_VERSION,
    kind: RECOVERY_KIND,
    type: meta.type,
    runId: meta.runId,
    restoredFromRunId: meta.restoredFromRunId,
    capturedAt: meta.capturedAt ?? new Date().toISOString(),
    activeVersionAtCapture: meta.activeVersionAtCapture,
    algorithm: CHECKSUM_ALGORITHM,
    checksum,
    snapshot,
  };

  const report = await writeJsonAtomically(filePath, `${JSON.stringify(point, null, 2)}\n`);
  return { report, checksum };
}

export async function writeWriteMarker(
  filePath: string,
  meta: {
    type: string;
    runId: string;
    restoredFromRunId: string;
    recoveryChecksum: string;
    fileCount: number;
    markedAt?: string;
  },
): Promise<DurabilityReport> {
  assertNotReserved(filePath);
  const marker: WriteMarker = {
    formatVersion: RECOVERY_FORMAT_VERSION,
    kind: MARKER_KIND,
    type: meta.type,
    runId: meta.runId,
    restoredFromRunId: meta.restoredFromRunId,
    markedAt: meta.markedAt ?? new Date().toISOString(),
    recoveryChecksum: meta.recoveryChecksum,
    fileCount: meta.fileCount,
  };
  const body = { ...marker, checksum: sha256(canonicalRecord(marker as unknown as Record<string, unknown>)) };
  return writeJsonAtomically(filePath, `${JSON.stringify(body, null, 2)}\n`);
}

export async function writeCompletion(
  filePath: string,
  meta: {
    type: string;
    runId: string;
    restoredFromRunId: string;
    activatedVersion: string | null;
    filesRestored: number;
    completedAt?: string;
  },
): Promise<DurabilityReport> {
  assertNotReserved(filePath);
  const record: CompletionRecord = {
    formatVersion: RECOVERY_FORMAT_VERSION,
    kind: COMPLETION_KIND,
    type: meta.type,
    runId: meta.runId,
    restoredFromRunId: meta.restoredFromRunId,
    completedAt: meta.completedAt ?? new Date().toISOString(),
    activatedVersion: meta.activatedVersion,
    filesRestored: meta.filesRestored,
  };
  const body = { ...record, checksum: sha256(canonicalRecord(record as unknown as Record<string, unknown>)) };
  return writeJsonAtomically(filePath, `${JSON.stringify(body, null, 2)}\n`);
}

// ── reading ───────────────────────────────────────────────────

async function readJson(filePath: string): Promise<Record<string, unknown>> {
  let raw: string;
  try {
    raw = await fs.readFile(filePath, "utf-8");
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") throw new ManifestMissingError(filePath);
    throw new ManifestInvalidError(
      "unreadable", filePath,
      `${(err as NodeJS.ErrnoException).code ?? "read failed"}: ${(err as Error).message}`,
      err as Error,
    );
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    throw new ManifestInvalidError(
      "unparseable", filePath,
      `not valid JSON (${(err as Error).message}). An artefact truncated by an ` +
        `interrupted write looks exactly like this.`,
      err as Error,
    );
  }

  if (!isPlainObject(parsed)) {
    throw new ManifestInvalidError(
      "not-an-object", filePath,
      `expected an object, found ${Array.isArray(parsed) ? "an array" : typeof parsed}`,
    );
  }
  return parsed;
}

function requireFields(
  parsed: Record<string, unknown>,
  filePath: string,
  kind: string,
  stringFields: readonly string[],
): void {
  const bad = (detail: string): never => {
    throw new ManifestInvalidError("bad-envelope", filePath, detail);
  };
  if (parsed.formatVersion !== RECOVERY_FORMAT_VERSION) {
    bad(
      `formatVersion is ${JSON.stringify(parsed.formatVersion)}; this build reads ` +
        `version ${RECOVERY_FORMAT_VERSION}. A newer artefact is not guessed at.`,
    );
  }
  if (parsed.kind !== kind) {
    bad(`kind is ${JSON.stringify(parsed.kind)}, expected "${kind}"`);
  }
  for (const field of stringFields) {
    if (typeof parsed[field] !== "string" || parsed[field] === "") {
      bad(`${field} is missing or not a non-empty string`);
    }
  }
  if (typeof parsed.checksum !== "string" || !HEX_64.test(parsed.checksum)) {
    bad(`checksum is not a 64-character ${CHECKSUM_ALGORITHM} hex digest`);
  }
}

/**
 * Loads and verifies a recovery point.
 *
 * Verified before use, always. An artefact whose checksum does not match is
 * refused rather than restored from: a recovery point that has been
 * corrupted is worse than none, because acting on it writes wrong bytes over
 * live content while reporting a recovery.
 *
 * As in Stage 2, the checksum detects accidental corruption. It is not
 * authentication: anyone who can edit the artefact can recompute it.
 */
export async function readRecoveryPoint(filePath: string): Promise<RecoveryPoint> {
  const parsed = await readJson(filePath);
  requireFields(parsed, filePath, RECOVERY_KIND, [
    "type", "runId", "restoredFromRunId", "capturedAt",
  ]);
  if (parsed.algorithm !== CHECKSUM_ALGORITHM) {
    throw new ManifestInvalidError(
      "bad-envelope", filePath,
      `algorithm is ${JSON.stringify(parsed.algorithm)}, expected "${CHECKSUM_ALGORITHM}"`,
    );
  }
  if (parsed.activeVersionAtCapture !== null && typeof parsed.activeVersionAtCapture !== "string") {
    throw new ManifestInvalidError(
      "bad-envelope", filePath,
      "activeVersionAtCapture must be a version id or null",
    );
  }

  const snapshot = validateSnapshotShape(parsed.snapshot, filePath);
  if (Object.keys(snapshot).length === 0) {
    throw new ManifestInvalidError(
      "empty", filePath,
      "it records no files, so it could not restore anything it claims to protect",
    );
  }

  const actual = snapshotChecksum(snapshot);
  if (actual !== parsed.checksum) {
    throw new ManifestInvalidError(
      "checksum-mismatch", filePath,
      `recorded ${(parsed.checksum as string).slice(0, 12)}…, computed ${actual.slice(0, 12)}… ` +
        `over ${Object.keys(snapshot).length} entr(ies). This recovery point has changed ` +
        `since it was written and must not be used to restore anything.`,
    );
  }

  return {
    formatVersion: RECOVERY_FORMAT_VERSION,
    kind: RECOVERY_KIND,
    type: parsed.type as string,
    runId: parsed.runId as string,
    restoredFromRunId: parsed.restoredFromRunId as string,
    capturedAt: parsed.capturedAt as string,
    activeVersionAtCapture: parsed.activeVersionAtCapture as string | null,
    algorithm: CHECKSUM_ALGORITHM,
    checksum: actual,
    snapshot,
  };
}

function verifyRecordChecksum(parsed: Record<string, unknown>, filePath: string): void {
  const { checksum, ...rest } = parsed;
  const actual = sha256(canonicalRecord(rest));
  if (actual !== checksum) {
    throw new ManifestInvalidError(
      "checksum-mismatch", filePath,
      `recorded ${String(checksum).slice(0, 12)}…, computed ${actual.slice(0, 12)}…`,
    );
  }
}

export async function readWriteMarker(filePath: string): Promise<WriteMarker> {
  const parsed = await readJson(filePath);
  requireFields(parsed, filePath, MARKER_KIND, [
    "type", "runId", "restoredFromRunId", "markedAt", "recoveryChecksum",
  ]);
  if (typeof parsed.fileCount !== "number" || !Number.isInteger(parsed.fileCount) || parsed.fileCount < 0) {
    throw new ManifestInvalidError("bad-envelope", filePath, "fileCount must be a non-negative integer");
  }
  verifyRecordChecksum(parsed, filePath);
  return parsed as unknown as WriteMarker;
}

export async function readCompletion(filePath: string): Promise<CompletionRecord> {
  const parsed = await readJson(filePath);
  requireFields(parsed, filePath, COMPLETION_KIND, [
    "type", "runId", "restoredFromRunId", "completedAt",
  ]);
  if (parsed.activatedVersion !== null && typeof parsed.activatedVersion !== "string") {
    throw new ManifestInvalidError("bad-envelope", filePath, "activatedVersion must be a version id or null");
  }
  if (typeof parsed.filesRestored !== "number" || !Number.isInteger(parsed.filesRestored)) {
    throw new ManifestInvalidError("bad-envelope", filePath, "filesRestored must be an integer");
  }
  verifyRecordChecksum(parsed, filePath);
  return parsed as unknown as CompletionRecord;
}

/**
 * The state of one rollback run as its artefacts describe it, with every
 * read failure reported rather than collapsed into "absent".
 *
 * Purely observational: reads files, writes nothing, creates nothing.
 */
export interface RollbackRunStatus {
  runDir: string;
  state: RollbackState;
  recoveryPoint: RecoveryPoint | null;
  recoveryPointError: string | null;
  marker: WriteMarker | null;
  markerError: string | null;
  completion: CompletionRecord | null;
  completionError: string | null;
  /** True when the marker names a different recovery point than the one present. */
  markerMismatch: boolean;
}

async function presence(filePath: string): Promise<boolean> {
  try {
    await fs.stat(filePath);
    return true;
  } catch {
    return false;
  }
}

export async function readRollbackRunStatus(runDir: string): Promise<RollbackRunStatus> {
  const status: RollbackRunStatus = {
    runDir,
    state: "no-record",
    recoveryPoint: null, recoveryPointError: null,
    marker: null, markerError: null,
    completion: null, completionError: null,
    markerMismatch: false,
  };

  const hasPoint = await presence(recoveryPointPath(runDir));
  const hasMarker = await presence(writeMarkerPath(runDir));
  const hasCompletion = await presence(completionPath(runDir));

  // State is derived from PRESENCE, not from validity: a corrupt marker still
  // means the run reached the point of writing one, and treating it as absent
  // would understate how far the run got — the one direction that is unsafe.
  if (hasCompletion) status.state = "completed";
  else if (hasMarker) status.state = "writing";
  else if (hasPoint) status.state = "captured";

  if (hasPoint) {
    try { status.recoveryPoint = await readRecoveryPoint(recoveryPointPath(runDir)); }
    catch (err) { status.recoveryPointError = (err as Error).message; }
  }
  if (hasMarker) {
    try { status.marker = await readWriteMarker(writeMarkerPath(runDir)); }
    catch (err) { status.markerError = (err as Error).message; }
  }
  if (hasCompletion) {
    try { status.completion = await readCompletion(completionPath(runDir)); }
    catch (err) { status.completionError = (err as Error).message; }
  }

  if (status.marker && status.recoveryPoint) {
    status.markerMismatch = status.marker.recoveryChecksum !== status.recoveryPoint.checksum;
  }

  return status;
}

/**
 * What each state does and does not establish.
 *
 * Split by failure mode, because the same artefacts support a much weaker
 * conclusion after a power loss than after a plain process kill, and
 * collapsing the two is how an operator ends up acting on a guarantee that
 * was never there.
 */
export interface StateReading {
  /** What is on disk, with no inference attached. */
  observed: string;
  /** Established when the process died and the filesystem survived intact. */
  ifProcessInterrupted: string;
  /**
   * Established when the machine may have lost power or the OS crashed.
   *
   * Both platform cases are stated, rather than one being baked in, because
   * they genuinely differ: where a directory entry can be flushed, this
   * module flushes it before returning and before the first destructive
   * write, so absence carries information. Where it cannot — Windows — it
   * does not. Writing only the Windows reading would understate the
   * guarantee elsewhere; writing only the other would overstate it here.
   */
  ifPowerLoss: {
    withDirectoryFlush: string;
    withoutDirectoryFlush: string;
  };
  /** Never established, by either route. */
  doesNotProve: string;
}

/** The reading that applies on a platform with or without a directory flush. */
export function powerLossReading(state: RollbackState, directoryFlushAvailable: boolean): string {
  const reading = STATE_MEANING[state].ifPowerLoss;
  return directoryFlushAvailable ? reading.withDirectoryFlush : reading.withoutDirectoryFlush;
}

export const STATE_MEANING: Readonly<Record<RollbackState, StateReading>> = Object.freeze({
  "no-record": {
    observed: "No rollback artefact is present for this run id.",
    ifProcessInterrupted:
      "The run did not reach its first durable write, and therefore did not reach its " +
      "first destructive write either.",
    ifPowerLoss: {
      withDirectoryFlush:
        "The recovery point is flushed, directory entry included, before anything else " +
        "happens, so its absence indicates the run did not reach that step — and the first " +
        "destructive write comes later still. This holds only insofar as the filesystem " +
        "honoured the flush, which this code cannot verify.",
      withoutDirectoryFlush:
        "Nothing about the live files. An artefact that was written and renamed need not " +
        "have survived, because its directory entry is never explicitly flushed on this " +
        "platform, so destructive writes may well have happened. AMBIGUOUS — compare the " +
        "live files against the target manifest.",
    },
    doesNotProve:
      "That no rollback ran — another run id may have. Absence is never, by itself, proof " +
      "that the live files are untouched.",
  },
  captured: {
    observed: "A recovery point is present; there is no write marker.",
    ifProcessInterrupted:
      "This run had not begun writing to public/data: the marker is written and flushed " +
      "before the first write, and it is absent.",
    ifPowerLoss: {
      withDirectoryFlush:
        "The marker's directory entry is flushed before the first destructive write, so its " +
        "absence does indicate that writes had not begun — insofar as the filesystem " +
        "honoured that flush, which this code cannot verify.",
      withoutDirectoryFlush:
        "Only that the recovery point was written. The marker lives in a different directory " +
        "from the content files and neither directory entry is flushed on this platform, so " +
        "a lost marker alongside completed content writes is reachable. AMBIGUOUS — compare " +
        "the live files against the recovery point; if they no longer match it, the marker " +
        "was lost rather than never written.",
    },
    doesNotProve: "That the rollback was abandoned rather than simply not having got there yet.",
  },
  writing: {
    observed: "A recovery point and a write marker are both present.",
    ifProcessInterrupted: "The run reached the point where writes were about to begin.",
    ifPowerLoss: {
      withDirectoryFlush:
        "The same, and no weaker: this state rests on artefacts being PRESENT, and a crash " +
        "cannot manufacture a file that was never written.",
      withoutDirectoryFlush:
        "The same, and no weaker: this state rests on artefacts being PRESENT, and a crash " +
        "cannot manufacture a file that was never written. The platform's inability to " +
        "flush a directory entry weakens inferences from absence, not from presence.",
    },
    doesNotProve:
      "That any file was written, that none was, or that the run failed. A run that " +
      "completed but was interrupted before recording completion looks identical. Compare " +
      "the live files against the recovery point and the target manifest.",
  },
  completed: {
    observed: "All three artefacts are present.",
    ifProcessInterrupted: "The run reached the end of its sequence.",
    ifPowerLoss: {
      withDirectoryFlush: "The same, and no weaker — again because it rests on presence, not absence.",
      withoutDirectoryFlush: "The same, and no weaker — again because it rests on presence, not absence.",
    },
    doesNotProve:
      "That every post-activation step succeeded — pruning and history are reported as " +
      "warnings and do not stop a run; nor that the restored content is correct, which is " +
      "established by the rollback's own verification step rather than by this record.",
  },
});

/**
 * Whether this state's reading depends on an artefact being ABSENT, and is
 * therefore only as sound as the platform's ability to make absence
 * meaningful.
 */
export function dependsOnAbsence(state: RollbackState): boolean {
  return state === "no-record" || state === "captured";
}

export { canonicalSnapshot };
