import fs from "fs/promises";
import path from "path";
import { sha256 } from "../editorial-history/revision-store";
import { normalizeSnapshotKey } from "./promote-atomic";
import { CHECKSUM_ALGORITHM, writeJsonAtomically, DurabilityReport } from "./snapshot-manifest";

/**
 * Proof that a staging directory is the output of a specific publish run,
 * from a specific source state.
 *
 * ── The defect this closes ──────────────────────────────────
 *
 * writeStagedFilesAtomically treats an empty generated set as "nothing to
 * publish" and leaves the directory untouched, so a run that legitimately
 * produces no files leaves the PREVIOUS run's output in place. That is not
 * hypothetical: storage/publish-reports/awards/latest.json records a
 * successful run with recordsChecked 0 and staged [], while
 * storage/publish-staging/awards/ still holds temp-fixture-award.json from
 * an earlier run. The report already knows the right answer; nothing bound
 * it to the directory, and promote() never read it.
 *
 * Promoting that directory would write the fixture into public/data and the
 * index regenerator — which scans the directory, not the report — would
 * publish it as a real award.
 *
 * ── Why not just trust the report ───────────────────────────
 *
 * latest.json cannot be the anchor. validate() writes a report too, with
 * mode "validate" and staged [], through the same persistReport, so a
 * validate run silently replaces the record of the last real publish. And
 * report.staged holds absolute machine-local paths
 * ("C:\\Users\\…\\armaments\\equipment\\germany.json"), which do not
 * survive a move between machines. Provenance therefore lives with the
 * staging directory and stores portable relative keys.
 *
 * ── Where it lives, and why beside rather than inside ───────
 *
 *   storage/publish-staging/<type>/              the staged files
 *   storage/publish-staging/<type>.provenance.json   this record
 *
 * Beside, not inside, for two independent reasons: promote walks the
 * directory with listFilesRecursive and would otherwise promote the record
 * itself into public/data, and writeStagedFilesAtomically replaces the
 * directory wholesale with an rm + rename, which would destroy anything
 * kept in it. The sibling convention is already used by that writer for its
 * own "<outDir>.tmp-<uuid>" staging area.
 *
 * ── The two fingerprints ────────────────────────────────────
 *
 * OUTPUT covers the intended file set: portable relative key → sha256 of
 * content. It detects files added to the directory after the run (the
 * defect above), files missing from it, and files modified in place. It
 * needs no database.
 *
 * SOURCE covers the authoritative state the output was generated from, so a
 * database that has moved on since staging is caught. It is a digest over a
 * canonical projection of the rows the generator actually loaded — which
 * covers inserts, updates AND deletions, because a deleted row simply is
 * not in the projection. For nsdap the source is files, not rows, and no
 * database is consulted at all.
 *
 * ── What the source fingerprint does and does not establish ─
 *
 * Each type's source is read with a single Prisma findMany, so the rows
 * within one fingerprint are a consistent read. What is NOT claimed: that
 * the publish run as a whole is transactional. The fingerprint is taken
 * before the generator's own read, so a write landing mid-run is included
 * in neither the fingerprint nor reliably in the output — and the next
 * promote recomputes, sees the difference, and refuses. That direction is
 * deliberate: the race fails closed.
 */

export const STAGING_PROVENANCE_VERSION = 1;
const PROVENANCE_KIND = "staging-provenance";
const HEX_64 = /^[0-9a-f]{64}$/;

/** Where the source a staging run was generated from actually lives. */
export type SourceKind = "database" | "files";

export interface SourceFingerprint {
  kind: SourceKind;
  /** Digest over the canonical projection of the loaded source. */
  digest: string;
  /** How many source records or files the digest covers. */
  count: number;
}

export interface StagingProvenance {
  formatVersion: number;
  kind: typeof PROVENANCE_KIND;
  type: string;
  /** The publish run that produced this staging directory. */
  runId: string;
  startedAt: string;
  /**
   * False until the staging directory has been successfully replaced.
   *
   * Written BEFORE the directory is touched, so an interrupted run can
   * never leave a record that validates content it does not describe. A
   * record stuck at false means a publish started and did not finish, which
   * refuses — distinct from no record at all, which means no publish run
   * has ever recorded provenance for this type.
   */
  complete: boolean;
  completedAt: string | null;
  source: SourceFingerprint;
  /**
   * The intended output: portable relative key → sha256 of the file's
   * content. Empty is a legitimate value and means the run intended to
   * stage nothing.
   */
  intendedFiles: Record<string, string>;
  algorithm: typeof CHECKSUM_ALGORITHM;
  checksum: string;
}

/** Why a staging directory may not be promoted. */
export type ProvenanceRefusal =
  | "missing"
  | "unreadable"
  | "unparseable"
  | "not-an-object"
  | "bad-envelope"
  | "checksum-mismatch"
  | "incomplete"
  | "type-mismatch"
  | "files-differ"
  | "source-changed"
  | "source-unavailable";

export class StagingProvenanceError extends Error {
  constructor(
    public readonly reason: ProvenanceRefusal,
    public readonly type: string,
    detail: string,
    public readonly originalError?: Error,
  ) {
    super(`Staging for "${type}" cannot be promoted (${reason}): ${detail}`);
    this.name = "StagingProvenanceError";
  }
}

export function provenancePath(stagingRoot: string, type: string): string {
  return path.join(stagingRoot, `${type}.provenance.json`);
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * The bytes the record's checksum covers: sorted keys as an array of pairs,
 * so nothing depends on JSON key ordering. `checksum` is excluded, since it
 * cannot cover itself.
 */
function canonicalProvenance(record: Record<string, unknown>): string {
  return JSON.stringify(
    Object.keys(record).filter((k) => k !== "checksum").sort().map((k) => [k, record[k]]),
  );
}

/**
 * A canonical digest over a source projection.
 *
 * Entries are sorted, so query ordering cannot change the result. A
 * deletion changes the digest by its absence, an insert by its presence,
 * and an update through whatever the projection includes — which is why the
 * projection must carry updatedAt, not just ids.
 */
export function fingerprintSource(kind: SourceKind, entries: ReadonlyArray<readonly [string, string]>): SourceFingerprint {
  const sorted = [...entries].map(([k, v]) => [k, v]).sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
  return { kind, digest: sha256(JSON.stringify(sorted)), count: sorted.length };
}

/** Portable relative key → sha256, for a generated file set. */
export function fingerprintOutput(files: ReadonlyMap<string, string>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [relPath, content] of files) out[normalizeSnapshotKey(relPath)] = sha256(content);
  return out;
}

// ── writing: invalidate first, complete last ──────────────────

/**
 * Marks a publish run as started, replacing any previous record.
 *
 * Called BEFORE the staging directory is touched. This is the invalidation
 * step: from here until the run completes there is no record that validates
 * anything, so a crash at any point in between refuses rather than letting
 * a stale record authorise content it never described.
 *
 * The cost is deliberate and worth stating: if the staging write then
 * fails, the previously promotable directory becomes unpromotable until it
 * is re-published. Failing closed on availability is the trade this makes.
 */
export async function beginStagingRun(
  filePath: string,
  meta: { type: string; runId: string; source: SourceFingerprint; startedAt?: string },
): Promise<DurabilityReport> {
  const record: Omit<StagingProvenance, "checksum"> = {
    formatVersion: STAGING_PROVENANCE_VERSION,
    kind: PROVENANCE_KIND,
    type: meta.type,
    runId: meta.runId,
    startedAt: meta.startedAt ?? new Date().toISOString(),
    complete: false,
    completedAt: null,
    source: meta.source,
    intendedFiles: {},
    algorithm: CHECKSUM_ALGORITHM,
  };
  return writeRecord(filePath, record);
}

/** Records the finished run. Called only after the directory is in place. */
export async function completeStagingRun(
  filePath: string,
  meta: {
    type: string;
    runId: string;
    source: SourceFingerprint;
    startedAt: string;
    intendedFiles: Record<string, string>;
    completedAt?: string;
  },
): Promise<DurabilityReport> {
  const record: Omit<StagingProvenance, "checksum"> = {
    formatVersion: STAGING_PROVENANCE_VERSION,
    kind: PROVENANCE_KIND,
    type: meta.type,
    runId: meta.runId,
    startedAt: meta.startedAt,
    complete: true,
    completedAt: meta.completedAt ?? new Date().toISOString(),
    source: meta.source,
    intendedFiles: meta.intendedFiles,
    algorithm: CHECKSUM_ALGORITHM,
  };
  return writeRecord(filePath, record);
}

async function writeRecord(filePath: string, record: Omit<StagingProvenance, "checksum">): Promise<DurabilityReport> {
  const body: StagingProvenance = {
    ...record,
    checksum: sha256(canonicalProvenance(record as unknown as Record<string, unknown>)),
  };
  return writeJsonAtomically(filePath, `${JSON.stringify(body, null, 2)}\n`);
}

// ── reading and validating ────────────────────────────────────

export async function readStagingProvenance(filePath: string, type: string): Promise<StagingProvenance> {
  const fail = (reason: ProvenanceRefusal, detail: string, cause?: Error): never => {
    throw new StagingProvenanceError(reason, type, detail, cause);
  };

  let raw: string;
  try {
    raw = await fs.readFile(filePath, "utf-8");
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") {
      fail(
        "missing",
        `no provenance record at ${filePath}. Staged output with no record of the publish ` +
          `run that produced it cannot be verified against its source. Re-publish this type.`,
      );
    }
    fail(
      "unreadable",
      `${(err as NodeJS.ErrnoException).code ?? "read failed"}: ${(err as Error).message}`,
      err as Error,
    );
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw!);
  } catch (err) {
    fail(
      "unparseable",
      `the provenance record is not valid JSON (${(err as Error).message}). A record ` +
        `truncated by an interrupted write looks exactly like this.`,
      err as Error,
    );
  }
  if (!isPlainObject(parsed)) {
    fail("not-an-object", `expected an object, found ${Array.isArray(parsed) ? "an array" : typeof parsed}`);
  }

  const record = parsed as Record<string, unknown>;
  if (record.formatVersion !== STAGING_PROVENANCE_VERSION) {
    fail("bad-envelope", `formatVersion is ${JSON.stringify(record.formatVersion)}, expected ${STAGING_PROVENANCE_VERSION}`);
  }
  if (record.kind !== PROVENANCE_KIND) {
    fail("bad-envelope", `kind is ${JSON.stringify(record.kind)}, expected "${PROVENANCE_KIND}"`);
  }
  if (record.algorithm !== CHECKSUM_ALGORITHM) {
    fail("bad-envelope", `algorithm is ${JSON.stringify(record.algorithm)}, expected "${CHECKSUM_ALGORITHM}"`);
  }
  for (const field of ["type", "runId", "startedAt"] as const) {
    if (typeof record[field] !== "string" || record[field] === "") {
      fail("bad-envelope", `${field} is missing or not a non-empty string`);
    }
  }
  if (typeof record.checksum !== "string" || !HEX_64.test(record.checksum)) {
    fail("bad-envelope", `checksum is not a 64-character ${CHECKSUM_ALGORITHM} hex digest`);
  }
  if (typeof record.complete !== "boolean") {
    fail("bad-envelope", "complete is missing or not a boolean");
  }
  if (!isPlainObject(record.source)) {
    fail("bad-envelope", "source is missing or not an object");
  }
  const source = record.source as Record<string, unknown>;
  if (source.kind !== "database" && source.kind !== "files") {
    fail("bad-envelope", `source.kind is ${JSON.stringify(source.kind)}, expected "database" or "files"`);
  }
  if (typeof source.digest !== "string" || !HEX_64.test(source.digest)) {
    fail("bad-envelope", "source.digest is not a 64-character hex digest");
  }
  if (typeof source.count !== "number" || !Number.isInteger(source.count) || source.count < 0) {
    fail("bad-envelope", "source.count is not a non-negative integer");
  }
  if (!isPlainObject(record.intendedFiles)) {
    fail("bad-envelope", "intendedFiles is missing or not an object");
  }
  for (const [key, digest] of Object.entries(record.intendedFiles as Record<string, unknown>)) {
    if (typeof digest !== "string" || !HEX_64.test(digest)) {
      fail("bad-envelope", `intendedFiles["${key}"] is not a 64-character hex digest`);
    }
  }

  const { checksum, ...rest } = record;
  const actual = sha256(canonicalProvenance(rest));
  if (actual !== checksum) {
    fail(
      "checksum-mismatch",
      `recorded ${String(checksum).slice(0, 12)}…, computed ${actual.slice(0, 12)}…. The ` +
        `record has changed since it was written and cannot be trusted to describe this ` +
        `staging directory.`,
    );
  }

  if (record.type !== type) {
    fail("type-mismatch", `the record describes type "${String(record.type)}", not "${type}"`);
  }
  if (record.complete !== true) {
    fail(
      "incomplete",
      `publish run ${String(record.runId)} started at ${String(record.startedAt)} and did ` +
        `not record completion. The staging directory may be the previous run's output, ` +
        `this run's, or a mixture. Re-publish this type.`,
    );
  }

  return record as unknown as StagingProvenance;
}

export interface DirectoryComparison {
  added: string[];
  missing: string[];
  modified: string[];
  matched: boolean;
}

/** What the directory holds, against what the run intended to produce. */
export function compareStagedDirectory(
  intendedFiles: Record<string, string>,
  actual: ReadonlyMap<string, string>,
): DirectoryComparison {
  const actualDigests = fingerprintOutput(actual);
  const added: string[] = [];
  const missing: string[] = [];
  const modified: string[] = [];

  for (const key of Object.keys(actualDigests)) {
    if (!(key in intendedFiles)) added.push(key);
    else if (intendedFiles[key] !== actualDigests[key]) modified.push(key);
  }
  for (const key of Object.keys(intendedFiles)) {
    if (!(key in actualDigests)) missing.push(key);
  }

  added.sort(); missing.sort(); modified.sort();
  return { added, missing, modified, matched: added.length + missing.length + modified.length === 0 };
}

/**
 * The whole gate, in the order a refusal is most useful: structure, then
 * what is on disk, then whether the source still agrees.
 *
 * `recomputeSource` is awaited only once the cheaper checks pass, so a
 * directory that is plainly wrong is refused without a database round trip.
 * For a filesystem-backed type it does not touch the database at all.
 */
export async function assertStagingPromotable(args: {
  type: string;
  provenanceFile: string;
  staged: ReadonlyMap<string, string>;
  recomputeSource: (kind: SourceKind) => Promise<SourceFingerprint>;
}): Promise<StagingProvenance> {
  const record = await readStagingProvenance(args.provenanceFile, args.type);

  const comparison = compareStagedDirectory(record.intendedFiles, args.staged);
  if (!comparison.matched) {
    const parts: string[] = [];
    if (comparison.added.length > 0) {
      parts.push(
        `${comparison.added.length} file(s) present in staging but not part of the intended ` +
          `output (${comparison.added.slice(0, 10).join(", ")}${comparison.added.length > 10 ? ", …" : ""})`,
      );
    }
    if (comparison.missing.length > 0) {
      parts.push(
        `${comparison.missing.length} intended file(s) missing from staging ` +
          `(${comparison.missing.slice(0, 10).join(", ")}${comparison.missing.length > 10 ? ", …" : ""})`,
      );
    }
    if (comparison.modified.length > 0) {
      parts.push(
        `${comparison.modified.length} staged file(s) changed since the run ` +
          `(${comparison.modified.slice(0, 10).join(", ")}${comparison.modified.length > 10 ? ", …" : ""})`,
      );
    }
    throw new StagingProvenanceError(
      "files-differ", args.type,
      `${parts.join("; ")}. Publish run ${record.runId} intended ` +
        `${Object.keys(record.intendedFiles).length} file(s). Re-publish this type.`,
    );
  }

  let current: SourceFingerprint;
  try {
    current = await args.recomputeSource(record.source.kind);
  } catch (err) {
    // Strict by decision: an integrity check that cannot be performed is not
    // a check that passed. No warning-only fallback, no bypass.
    throw new StagingProvenanceError(
      "source-unavailable", args.type,
      `the ${record.source.kind === "database" ? "database" : "source files"} could not be ` +
        `read to confirm the staged output is still current (${(err as Error).message}). ` +
        `Promotion refuses rather than assuming the source is unchanged.`,
      err as Error,
    );
  }

  if (current.kind !== record.source.kind || current.digest !== record.source.digest) {
    throw new StagingProvenanceError(
      "source-changed", args.type,
      `the source has changed since publish run ${record.runId}: recorded ` +
        `${record.source.count} ${record.source.kind === "database" ? "record" : "file"}(s) ` +
        `at ${record.source.digest.slice(0, 12)}…, found ${current.count} at ` +
        `${current.digest.slice(0, 12)}…. The staged output no longer reflects the source. ` +
        `Re-publish this type.`,
    );
  }

  return record;
}
