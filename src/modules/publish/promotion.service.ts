import fs from "fs/promises";
import path from "path";
import { randomUUID } from "crypto";
import prisma from "../../database/prisma";
import { storageConfig } from "../../config/storage";
import { paths } from "../../config/paths";
import { versionStore, isVersionedType } from "./version-store";
import { publicationLock } from "./publication-lock";
import {
  readSnapshotManifest,
  writeSnapshotManifest,
  ManifestMissingError,
  ManifestInvalidError,
} from "./snapshot-manifest";
import {
  writeRecoveryPoint,
  writeWriteMarker,
  writeCompletion,
  recoveryPointPath,
  writeMarkerPath,
  completionPath,
} from "./rollback-recovery";
import { assertStagingPromotable, provenancePath } from "./staging-provenance";
import { PublishService } from "./publish.service";
import { isProtectedRootFile } from "./import-validation/importer-inputs";
import { regenerateIndex, schemaFor } from "./index-schema";
import { AppError } from "../../middleware/error.middleware";
import { promoteFilesAtomically, restoreFromSnapshot, applyFileChangesAtomically, normalizeSnapshotKey, resolveSnapshotPath, readForSnapshot, AtomicApplyError, ReversalFailure, PromotionSnapshot } from "./promote-atomic";


export interface PromotionHistoryEntry {
  runId: string;
  action: "promote" | "rollback";
  type: string;
  timestamp: string;
  userId: string;
  filesAffected: string[];
  restoredFromRunId?: string;
  /** How a section index was regenerated, when there was anything to say. */
  indexNotes?: string[];
}

/** What each stage of a promotion actually achieved. */
export interface PromotionSteps {
  /** Staged files (and the regenerated index) are on disk under public/data. */
  contentApplied: boolean;
  /**
   * The snapshot manifest a rollback needs, made durable BEFORE activation.
   *
   * "not-applicable" is not a softer "persisted": it means this operation
   * wrote no rollback snapshot of its own, so it cannot be reversed from one.
   * A rollback is the case — it restores from an existing manifest and
   * records nothing new (see R8).
   */
  recoveryMetadata: "persisted" | "failed" | "not-applicable";
  /**
   * Whether the active-version pointer was moved to the new content.
   *
   * "not-applicable" is the honest answer for a type outside VERSIONED_TYPES:
   * nsdap is served live from public/data, so its content went live when the
   * files landed and there is no pointer for it to flip. Reporting
   * "activated" there would describe a switch that never happened.
   */
  activation: "activated" | "aborted" | "not-applicable";
  /** The history file and audit row. Not required for recovery. */
  history: "recorded" | "failed";
  /**
   * Retention pruning. Housekeeping only.
   *
   * "not-applicable" when the operation captured no version: there is nothing
   * to retain and nothing to prune, which is not the same as having pruned.
   */
  cleanup: "completed" | "failed" | "not-applicable";
}

export interface PromotionResult {
  runId: string;
  action: "promote" | "rollback";
  type: string;
  filesAffected: string[];
  /**
   * "activated-with-warnings" means the content IS live and recoverable, but
   * a post-activation step failed. It is deliberately not "success", so a
   * caller cannot read a clean success where there was a partial one.
   */
  status: "success" | "activated-with-warnings" | "failed" | "disabled";
  error?: string;
  /** The published version this run produced, when versioning is in use. */
  version?: string;
  /** How a section index was regenerated, when there was anything to say. */
  indexNotes?: string[];
  /**
   * Per-stage outcome. Present on any run that reached the filesystem, so a
   * caller can tell active content apart from persisted recovery metadata,
   * audit status and cleanup status rather than inferring all four from one
   * boolean.
   */
  steps?: PromotionSteps;
  /**
   * Problems that occurred AFTER the content was already live. The promotion
   * genuinely succeeded; these need attention but do not undo it.
   */
  warnings?: string[];
}

// Same two-factor fail-closed design as every transactional database
// importer already proven in this project — this flag AND the caller's
// literal-typed confirmation must both agree. This is the first code in
// the entire project that writes to public/data/ at all, so it gets at
// least the same safety treatment as the highest-stakes database writes
// already shipped, not less.
//
// History: briefly set to true twice for Phase 7F verification — promoted
// and rolled back the real Naval staged output (runId
// c8aea22d-3e40-4132-a120-2b5b15b4c5ef, then again for the live-frontend
// check, runId 1f46e3ec-cbb4-4d8d-b133-2261d0fa0ae5) — each verified via
// an independent, out-of-band checksum backup taken before any of it ran,
// confirming byte-for-byte restoration, then reset to false.
//
// Briefly set to true again for Phase 7G (manifest regeneration):
// promoted Naval (runId 102913ed-a96e-49cc-9e00-b6dff1b5726d, included
// the regenerated index.json), rolled it back to confirm byte-for-byte
// restoration of both the data files and the manifest together, then
// re-promoted (runId e665f896-93ff-4efa-b2e7-ff67ecf1404c) as the final,
// intentionally-kept live state — naval/romania.json is now genuinely
// published and discoverable via index.json. Reset to false afterward.
//
// Briefly set to true again for the Phase 8A aircraft pilot: promoted
// (runId 352a671c-4e26-40d6-8b25-dcea4df35f66 — staging scoped to
// aircraft/* only, Naval excluded from the batch so it was never
// touched), which also introduced and exercised the orphaned-
// other-axis.json pruning logic (aircraft/other-axis.json deleted,
// fully superseded by italy/japan/romania.json). Rolled back (runId
// 67214a5f-23d4-4817-ad13-4df211d0e73f), confirmed byte-for-byte
// restoration of all 5 aircraft-dir files + index.json + Naval
// untouched, then re-promoted (runId d96734d7-8ff7-4e02-9736-
// e13283ce9e18) as the final, intentionally-kept live state. Reset to
// false afterward.
//
// Briefly set to true again for the Phase 9A panzer pilot: promoted
// (runId 49ea6691-df9e-4151-b4ae-adbc4b2052e8 — staging restricted to
// panzer/* only; Naval and Aircraft excluded from the batch so neither
// was touched), which also exercised the orphan-pruning logic again
// (panzer/other-axis.json deleted, superseded by italy/japan/romania/
// hungary.json). Rolled back (runId c9d3dfc2-eada-45f6-88c1-
// 41f79042d044), confirmed byte-for-byte restoration of all 5
// panzer-dir files + index.json + Naval/Aircraft untouched, then
// re-promoted (runId c5763466-4fd9-4130-9d16-161788e80bed) as the
// final, intentionally-kept live state. Reset to false afterward.
//
// Briefly set to true again for the Phase 10A equipment pilot:
// promoted (runId 7195e208-98a7-4c1f-977a-1f913904f6bd — staging
// restricted to equipment/* only; Naval/Aircraft/Panzer excluded from
// the batch). other-axis.json's two compound-nation entries ("ZB vz.
// 26" -> Czechoslovakia/Germany (captured), "Mannlicher M1895" ->
// Hungary/Romania/Bulgaria) produced unconventional but functionally
// correct filenames via the existing nationality-slug logic — not a
// new behavior, faithfully reflecting the source data's own nation
// field as authored. Rolled back (runId
// 4da5381a-8586-45d4-9502-58c63ba5c99a), confirmed byte-for-byte
// restoration of all equipment-dir files + index.json + other
// categories untouched, then re-promoted (runId
// 73f62ddd-5734-49ff-ae03-efbb9e6f885e) as the final, intentionally-
// kept live state. Reset to false afterward.
//
// Phase 11A (full finalization): all 6 categories published from DB
// and promoted together (runId 50dce0eb-7e97-4df7-80ee-4b517cb61f5a
// — 28 staged files + 3 orphan deletions (missiles/naval/wunderwaffen
// other-axis.json) + index.json). Rolled back (runId
// 5be6789d-de2b-4370-8e29-e6c24dbae653), confirmed all 32 files
// restored byte-for-byte. Re-promoted (runId
// 6a7105d0-7823-4742-b942-b4bf8016aa45) as the final, intentionally-
// kept live state. Reset to false afterward.
//
// Translation-system recordId backfill: republished and promoted all 8
// content types with staged output (letters runId
// 640842a0-fc24-4259-ba24-eaabcfe01497, armaments
// 6b0e0099-3e1a-4be7-93ee-33f61a0705ff, personnel
// e592ae2e-a7de-4d16-a09b-08616481276e, campaigns
// cc8b04c5-342a-430c-b2ab-02427a0b9475, articles
// cbe61fe7-86f4-47e6-8263-fe46e23bcf14, timeline
// 3d311ee7-73c1-492d-bc06-b130b38f5f64, formations
// 6b7d7ec0-34b9-44c2-8b48-f452582f781c, nsdap
// af989f90-288d-4941-9e4f-cbebc73cd8ca) so every live published record now
// carries the new `recordId` field the translation system resolves
// translations by (see the generators' recordId field — distinct from the
// public `id`/slug). A full backup of public/data/ was taken before this
// run; diffed after and confirmed the only changes were the new recordId
// field, one legitimately new campaign record not previously published,
// and harmless JSON key-order differences — no data loss. Awards, maps,
// and political-docs had zero staged files (no DB records of those types
// exist yet) so nothing was promoted for them. Reset to false afterward.
//
// Awards/Maps/PoliticalDocs verification fixtures: created one temporary
// DB record per type, published+promoted to verify translation rendering
// end-to-end on these previously-empty content types (listing, detail,
// locale switch, recordId lookup, English fallback, machine notice — all
// confirmed working). Deleted the 3 fixture records and their translations
// from the DB, then discovered these three types have no orphan-pruning
// logic in their index regenerators (unlike armaments/campaigns/articles),
// so a second publish+promote with 0 records left the stale
// temp-fixture-*.json files behind. Removed those 3 files and reset all
// three index.json to { "records": [] } directly — verified byte-identical
// to the pre-fixture state and zero remaining references anywhere in the
// repo. Reset to false afterward.
const PROMOTION_ENABLED = false;

function publicDataDir(type: string): string {
  return paths.published.dir(type);
}

function stagingDir(type: string): string {
  return paths.staging.dir(type);
}

function snapshotDir(type: string, runId: string): string {
  return path.join(storageConfig.directories.publishSnapshots, type, runId);
}

async function listFilesRecursive(dir: string, base = dir): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  let entries: import("fs").Dirent[];
  try {
    entries = await fs.readdir(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      const nested = await listFilesRecursive(fullPath, base);
      for (const [k, v] of nested) out.set(k, v);
    } else {
      out.set(path.relative(base, fullPath), await fs.readFile(fullPath, "utf-8"));
    }
  }
  return out;
}

function manifestPath(type: string, runId: string): string {
  return path.join(snapshotDir(type, runId), "manifest.json");
}

/**
 * Writes the manifest that makes this promotion reversible.
 *
 * Delegates to writeSnapshotManifest for the checksummed envelope and the
 * fsync-then-rename ordering. The durability report is returned rather than
 * surfaced to the caller: on Windows the directory flush is unsupported, so
 * raising it as a promotion warning would fire on every single run and say
 * nothing about that run. The limitation belongs in the documentation and
 * the tests, which is where it is.
 */
async function persistSnapshotManifest(type: string, runId: string, snapshot: PromotionSnapshot): Promise<void> {
  await writeSnapshotManifest(manifestPath(type, runId), { type, runId }, snapshot);
}

/**
 * Turns a manifest-loading failure into the status the operator should see.
 *
 * The distinction this exists for: a rollback whose manifest is *missing*
 * and one whose manifest is *damaged* are different situations, and both
 * used to produce "No snapshot found for runId X — cannot roll back." That
 * sends someone to look for a file that is sitting right there, corrupted.
 *
 * Exported because it is the whole of the mapping, and promote/rollback
 * cannot be executed with PROMOTION_ENABLED false — the same reason
 * abortedBody is exported and tested directly.
 */
export function rollbackTargetError(type: string, runId: string, err: unknown): AppError {
  if (err instanceof ManifestMissingError || (err as Error)?.name === "ManifestMissingError") {
    // Message preserved verbatim: it is what the Admin has always shown for
    // a runId that does not exist, and that case has not changed.
    return new AppError(404, `No snapshot found for runId "${runId}" — cannot roll back.`);
  }
  if (err instanceof ManifestInvalidError || (err as Error)?.name === "ManifestInvalidError") {
    const invalid = err as ManifestInvalidError;
    return new AppError(
      409,
      `Cannot roll back ${type} to runId "${runId}": its snapshot manifest exists but ` +
        `is unusable (${invalid.reason}). ${invalid.message} Nothing was changed.`,
    );
  }
  return new AppError(
    500,
    `Cannot roll back ${type} to runId "${runId}": ${(err as Error)?.message ?? String(err)}. ` +
      "Nothing was changed.",
  );
}


// Generic helper — reads a JSON file from disk, returns null on any error.






// Phase 8A: "other-axis" is a migration-source folder concept, not a
// published-data concept — once a category's records are grouped by real
// nationality (see publish.service.ts's generateFiles), there is no
// longer a record whose actual nation is "other-axis" itself, so no
// <category>/other-axis.json is ever staged for it again. Left alone,
// the old file would sit on disk indefinitely, orphaned and stale,
// duplicating content now correctly published under its real nation
// (Italy/Japan/Romania/etc.) — exactly the case found for Aircraft.
// Scoped strictly to the categories actually present in THIS promotion's
// staged batch — a category never touched by a given promotion run is
// never inspected here, so e.g. a Naval-excluded run cannot prune
// Naval's other-axis.json as a side effect.
function categoriesInBatch(relPaths: string[]): Set<string> {
  return new Set(
    relPaths
      .map((p) => p.replace(/\\/g, "/").split("/")[0])
      .filter((c) => c && c !== "index.json"),
  );
}

// Finds JSON files sitting directly in targetDir root (not in subdirs, not
// index.json). For campaigns and articles these are old per-theater/per-category
// aggregate files generated by the previous pipeline format (e.g.
// eastern-front.json, military.json). The new pipeline only writes to
// {theater}/{slug}.json or {category}/{slug}.json subdirectories, so any
// root-level .json file other than index.json is an orphaned aggregate.
//
// Except that not every root-level file is pipeline output. The archive
// manifests the importers READ also live at the root — campaigns.archive.json
// and articles.archive.json — so an unqualified sweep would have deleted this
// pipeline's own input. Which files are inputs is declared explicitly in
// importer-inputs.ts and cross-checked against the loaders by its test,
// rather than inferred from the filename here.
export async function findOrphanedRootJsonFiles(
  targetDir: string,
  type: string,
): Promise<Map<string, null>> {
  const toDelete = new Map<string, null>();
  let entries: import("fs").Dirent[];
  try { entries = await fs.readdir(targetDir, { withFileTypes: true }); } catch { return toDelete; }
  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith(".json")) continue;
    if (isProtectedRootFile(type, entry.name)) continue;
    toDelete.set(entry.name, null);
  }
  return toDelete;
}

async function findOrphanedOtherAxisFiles(
  targetDir: string,
  touchedCategories: Set<string>,
  stagedRelPaths: string[],
): Promise<Map<string, null>> {
  const stagedSet = new Set(stagedRelPaths.map((p) => p.replace(/\\/g, "/")));
  const toDelete = new Map<string, null>();
  for (const category of touchedCategories) {
    const relPath = `${category}/other-axis.json`;
    if (stagedSet.has(relPath)) continue; // still genuinely staged — not orphaned
    const exists = await fs.access(path.join(targetDir, category, "other-axis.json")).then(() => true, () => false);
    if (exists) toDelete.set(relPath, null);
  }
  return toDelete;
}

async function appendHistory(entry: PromotionHistoryEntry): Promise<void> {
  await fs.mkdir(storageConfig.directories.publishHistory, { recursive: true });
  const historyFile = path.join(storageConfig.directories.publishHistory, `${entry.type}.json`);

  let existing: PromotionHistoryEntry[] = [];
  try {
    existing = JSON.parse(await fs.readFile(historyFile, "utf-8")) as PromotionHistoryEntry[];
  } catch {
    // first entry for this type — fine
  }
  existing.push(entry);
  await fs.writeFile(historyFile, JSON.stringify(existing, null, 2), "utf-8");

  await prisma.auditLog.create({
    data: {
      userId: entry.userId,
      action: entry.action === "promote" ? "PUBLISH_PROMOTE" : "PUBLISH_ROLLBACK",
      entity: "Record",
      entityId: entry.runId,
      metadata: entry as unknown as object,
    },
  });
}

/**
 * The current on-disk content of exactly the files a snapshot covers, in the
 * same shape as a snapshot — so an operation about to apply that snapshot can
 * record what it is about to overwrite and put it back if a later step fails.
 *
 * Shares readForSnapshot with the atomic apply rather than keeping its own
 * read: this is the *only* record of the state a rollback is about to
 * replace, so a read error silently recorded as `null` would make the
 * recovery point itself an instruction to delete a file that is present.
 * Only a confirmed ENOENT becomes null; anything else throws, before any
 * write has happened.
 */
async function captureCurrentState(baseDir: string, snapshot: PromotionSnapshot): Promise<PromotionSnapshot> {
  const out: PromotionSnapshot = {};
  for (const key of Object.keys(snapshot)) {
    const normalized = normalizeSnapshotKey(key);
    out[normalized] = await readForSnapshot(resolveSnapshotPath(baseDir, key), normalized);
  }
  return out;
}

/**
 * Captures what is now in public/data as a new version and makes it active.
 *
 * Deliberately ordered: content lands in public/data first, is then copied to
 * an immutable version directory, and only then does the pointer flip. Until
 * that last step readers keep being served the previous version in full, so
 * the switch is atomic from a reader's point of view rather than a window in
 * which some files are new and some are old.
 *
 * The outgoing version is claimed for the duration so a concurrent prune
 * cannot delete content a page load is still resolving records against.
 */
async function captureAndActivateVersion(): Promise<string> {
  const previous = await versionStore.readActiveVersion();
  const release = previous ? versionStore.claimVersion(previous) : () => undefined;
  try {
    const version = await versionStore.createVersionFrom(paths.published.root);
    await versionStore.writeActiveVersion(version);
    return version;
  } finally {
    release();
  }
}

/** Whether the pre-activation content really was put back. */
export type RestorationOutcome = "verified" | "failed" | "not-attempted";

/** Where a promotion gave up. Everything here is strictly before activation. */
export type AbortStage = "content" | "index" | "recovery-metadata" | "activation";

/**
 * A promotion that did not activate, carrying both the failure that stopped
 * it and what became of the content that had already been written.
 *
 * The compensating restore used to be `.catch(() => undefined)`, so a failed
 * restore was invisible: the caller saw only the original error and would
 * reasonably conclude nothing had changed, while public/data could be left
 * part-promoted. Both errors are now preserved, and restoration is only
 * described as succeeding when it has been checked file by file.
 */
export class PromotionAbortedError extends Error {
  constructor(
    message: string,
    public readonly stage: AbortStage,
    public readonly originalError: Error,
    public readonly restoration: RestorationOutcome,
    public readonly restorationError?: Error,
    /** Files that did not match the snapshot after the restore. */
    public readonly unverifiedPaths: string[] = [],
    /**
     * Files the inner atomic apply could not reverse on its own, before this
     * layer attempted its own restore. Reported because they are the clearest
     * signal that the directory was left mid-change.
     */
    public readonly reversalFailures: ReversalFailure[] = [],
  ) {
    super(message);
    this.name = "PromotionAbortedError";
  }

  /** True when public/data may be in a part-promoted state. */
  get requiresManualVerification(): boolean {
    return this.restoration !== "verified";
  }
}

/**
 * Puts the snapshot back, then proves it by re-reading every file it covers
 * and comparing against the snapshot's own bytes — including the null
 * entries, which mean "this file did not exist and must not exist now".
 *
 * restoreFromSnapshot returning without throwing is not treated as proof: the
 * point of this check is that the caller is told "restored" only when the
 * bytes on disk actually say so.
 */
/**
 * Compares what is on disk against a snapshot, file by file, and writes
 * nothing.
 *
 * Both halves of a snapshot are checked: an entry with content must read back
 * byte-for-byte, and a null entry must be ABSENT. Checking only the files
 * that should exist would let a deletion that never happened pass as done.
 *
 * Extracted from restoreAndVerify so the same comparison can answer a second
 * question — "did the restore actually land?" — without performing another
 * restore to find out.
 */
export async function verifyAgainstSnapshot(
  baseDir: string,
  snapshot: PromotionSnapshot,
): Promise<{ matched: boolean; mismatched: string[] }> {
  const mismatched: string[] = [];
  for (const [key, expected] of Object.entries(snapshot)) {
    const normalized = normalizeSnapshotKey(key);
    let actual: string | null;
    try {
      actual = await readForSnapshot(resolveSnapshotPath(baseDir, key), normalized);
    } catch {
      // Unreadable: its state could not be established, so it has not been
      // verified. Counting it as absent would let an unreadable file match
      // an expected `null` and be reported as restored — the one claim this
      // function exists to make only when the bytes say so.
      mismatched.push(normalized);
      continue;
    }
    const matches = expected === null ? actual === null : actual === expected;
    if (!matches) mismatched.push(normalized);
  }
  return { matched: mismatched.length === 0, mismatched };
}

export async function restoreAndVerify(
  baseDir: string,
  snapshot: PromotionSnapshot,
): Promise<{ outcome: RestorationOutcome; error?: Error; mismatched: string[] }> {
  try {
    await restoreFromSnapshot(baseDir, snapshot);
  } catch (err) {
    return { outcome: "failed", error: err as Error, mismatched: [] };
  }

  const { matched, mismatched } = await verifyAgainstSnapshot(baseDir, snapshot);
  return matched
    ? { outcome: "verified", mismatched: [] }
    : { outcome: "failed", mismatched };
}

/**
 * Aborts a promotion: restore, verify, and throw an error that says plainly
 * which of the three situations the operator is in.
 */
export async function abortBeforeActivation(
  stage: AbortStage,
  originalError: Error,
  baseDir: string,
  snapshot: PromotionSnapshot,
  /** Reversal failures the inner atomic apply already reported. */
  innerReversalFailures: ReversalFailure[] = [],
): Promise<never> {
  const result = await restoreAndVerify(baseDir, snapshot);

  const inner = innerReversalFailures.length > 0
    ? ` The write's own reversal had already failed for ${innerReversalFailures.length} file(s) ` +
      `(${innerReversalFailures.map((f) => f.path).join(", ")}).`
    : "";
  const what = `${stage} step failed: ${originalError.message}${inner}`;
  let consequence: string;
  if (result.outcome === "verified") {
    consequence =
      `The promotion did not activate. Every file it had written was restored ` +
      `and verified against the snapshot, so ${baseDir} is as it was before.`;
  } else if (result.error) {
    consequence =
      `The promotion did not activate, and RESTORATION ALSO FAILED ` +
      `(${result.error.message}). ${baseDir} may be part-promoted and REQUIRES ` +
      `MANUAL VERIFICATION.`;
  } else {
    consequence =
      `The promotion did not activate, and RESTORATION COULD NOT BE VERIFIED: ` +
      `${result.mismatched.length} file(s) do not match the snapshot ` +
      `(${result.mismatched.slice(0, 10).join(", ")}${result.mismatched.length > 10 ? ", …" : ""}). ` +
      `${baseDir} REQUIRES MANUAL VERIFICATION.`;
  }

  throw new PromotionAbortedError(
    `${what} ${consequence}`,
    stage,
    originalError,
    result.outcome,
    result.error,
    result.mismatched,
    innerReversalFailures,
  );
}

/**
 * Everything that happens once the content is already live.
 *
 * Separated out because the distinction it encodes is the whole point of R2:
 * a failure here cannot mean "the promotion failed", because the promotion
 * has already happened. These steps are reported, never thrown, and the
 * status says "activated-with-warnings" rather than "success" so a caller
 * cannot mistake a partial outcome for a clean one.
 *
 * Taking the two operations as arguments is what makes each boundary
 * fault-injectable in tests while promotion itself stays disabled.
 */
export async function completeAfterActivation(args: {
  runId: string;
  /**
   * What this operation did about rollback metadata. Passed in rather than
   * assumed, because a promotion persists a new snapshot and a rollback does
   * not — reporting "persisted" for both would describe an existing source
   * snapshot as a newly written one.
   */
  recoveryMetadata: "persisted" | "not-applicable";
  /**
   * Whether a version pointer was actually flipped. Defaults to "activated",
   * which is the case for every versioned type; a non-versioned type passes
   * "not-applicable" because its content went live with the file write and no
   * pointer exists to move.
   */
  activation?: "activated" | "not-applicable";
  /**
   * Retention pruning, or null when this operation captured no version.
   *
   * Passing null is what stops a non-versioned promotion consuming a
   * retention slot: with no version of its own it has nothing to retain, and
   * pruning anyway would evict a real version to make room for one that was
   * never created.
   */
  prune: (() => Promise<unknown>) | null;
  recordHistory: () => Promise<unknown>;
}): Promise<{
  steps: PromotionSteps;
  warnings: string[];
  status: "success" | "activated-with-warnings";
}> {
  const warnings: string[] = [];
  const steps: PromotionSteps = {
    contentApplied: true,
    recoveryMetadata: args.recoveryMetadata,
    activation: args.activation ?? "activated",
    history: "recorded",
    cleanup: args.prune ? "completed" : "not-applicable",
  };

  if (args.prune) {
    try {
      await args.prune();
    } catch (err) {
      steps.cleanup = "failed";
      warnings.push(
        `Version retention pruning failed after activation (${(err as Error).message}). ` +
          "The content is live; old versions may not have been cleaned up.",
      );
    }
  }

  try {
    await args.recordHistory();
  } catch (err) {
    steps.history = "failed";
    warnings.push(
      `History and audit logging failed after activation (${(err as Error).message}). ` +
        "The content is live" +
        (args.recoveryMetadata === "persisted"
          ? ` and its rollback snapshot is stored under runId ${args.runId},`
          : " (this operation wrote no rollback snapshot of its own),") +
        // appendHistory writes the history file first and the audit row
        // second, so either or both may be missing. Claiming the run is
        // absent from the history would be wrong whenever only the audit
        // row failed.
        " but part or all of its history and audit record may be missing.",
    );
  }

  return {
    steps,
    warnings,
    status: warnings.length > 0 ? "activated-with-warnings" : "success",
  };
}

/**
 * Aborts before anything was written.
 *
 * applyFileChangesAtomically validates every key and reads the snapshot
 * BEFORE it opens its try block, so a throw from that phase escapes
 * unwrapped — and it escapes having touched nothing. Treating it like a
 * mid-write failure demanded manual verification of a directory the code
 * path proves is untouched, which spends the operator's trust on a false
 * alarm. Reserved for exactly that case; anything that may have written
 * goes through abortBeforeActivation and is verified.
 */
export function abortBeforeAnyWrite(
  stage: AbortStage,
  originalError: Error,
  baseDir: string,
): never {
  throw new PromotionAbortedError(
    `${stage} step failed: ${originalError.message} The promotion did not activate. ` +
      `It failed before any file was written, so ${baseDir} is unchanged and needs no checking.`,
    stage,
    originalError,
    "not-attempted",
  );
}

export class PromotionService {
  async listHistory(type: string): Promise<PromotionHistoryEntry[]> {
    const historyFile = path.join(storageConfig.directories.publishHistory, `${type}.json`);
    try {
      return JSON.parse(await fs.readFile(historyFile, "utf-8")) as PromotionHistoryEntry[];
    } catch {
      return [];
    }
  }

  // Promotes only the files actually present in storage/publish-staging/<type>/
  // right now — never the whole public/data/<type>/ directory. Every
  // category, every other file (index.json, other categories, etc.)
  // already in public/data/<type>/ is left completely untouched, since
  // promoteFilesAtomically only ever acts on the exact relPaths staged.
  async promote(type: string, userId: string, confirmPromotion: true): Promise<PromotionResult> {
    const runId = randomUUID();

    if (!PROMOTION_ENABLED || confirmPromotion !== true) {
      return {
        runId, action: "promote", type, filesAffected: [], status: "disabled",
        error: "Promotion is disabled (PROMOTION_ENABLED=false). No filesystem write of any kind was attempted.",
      };
    }

    // Everything from reading staging to the last housekeeping step runs
    // under one lock. The boundary is not "the write" but "the whole
    // operation", because the hazard is not a torn single file — the atomic
    // apply already handles that — it is a *second* operation observing this
    // one's intermediate tree. captureAndActivateVersion copies every
    // versioned type out of public/data, so a concurrent promotion reaching
    // capture while this one is mid-apply would freeze and then activate
    // this one's half-written state. Pruning is inside for the same reason:
    // it decides what to delete from the version list this operation is
    // still adding to.
    return publicationLock.run(() => this.promoteLocked(type, userId, runId));
  }

  private async promoteLocked(type: string, userId: string, runId: string): Promise<PromotionResult> {
    const staged = await listFilesRecursive(stagingDir(type));
    if (staged.size === 0) {
      throw new AppError(400, `No staged files found for type "${type}" — run a publish first.`);
    }

    const targetDir = publicDataDir(type);

    // ── Staging provenance, before the first public-content write ──
    //
    // Staging is never cleared, and writeStagedFilesAtomically leaves the
    // directory untouched when a run generates nothing — so a directory can
    // hold a superseded run's output while the publish report says the
    // intended output was empty. That is the state awards, maps and
    // political-docs are in today: each holds a temp-fixture-*.json from an
    // earlier run, and promoting one would write the fixture into
    // public/data where the index regenerator, which scans the directory
    // rather than the report, would publish it as a real record.
    //
    // This runs before promoteFilesAtomically and therefore before every
    // downstream mutation — orphan pruning, index regeneration, the
    // snapshot manifest, version capture and activation. A refusal is
    // routed through abortBeforeAnyWrite, so it carries the same "nothing
    // was written and nothing needs checking" guarantee as any other
    // pre-write abort.
    try {
      await assertStagingPromotable({
        type,
        provenanceFile: provenancePath(paths.staging.root, type),
        staged,
        // Recomputed through the publish service's own loader, so both
        // sides of the comparison are produced by one implementation. A
        // filesystem-backed type resolves this without touching the
        // database at all.
        recomputeSource: () => new PublishService().sourceFingerprint(type),
      });
    } catch (err) {
      abortBeforeAnyWrite("content", err as Error, targetDir);
    }

    // Applying the staged files is the first write, and used to be the one
    // boundary with no structured failure path: a throw here went straight
    // out raw, so the caller could not tell an intact directory from a
    // part-promoted one. The inner apply reverses what it managed to write
    // and reports any reversal it could not do; this layer then restores
    // against the same snapshot and verifies it file by file.
    let promoted: string[];
    let snapshot: PromotionSnapshot;
    try {
      ({ promoted, snapshot } = await promoteFilesAtomically(targetDir, staged));
    } catch (err) {
      if (err instanceof AtomicApplyError) {
        throw await abortBeforeActivation(
          "content", err.originalError, targetDir, err.snapshot, err.reversalFailures,
        );
      }
      // Anything that is not an AtomicApplyError came from key validation or
      // the snapshot read, both of which run before the first write.
      abortBeforeAnyWrite("content", err as Error, targetDir);
    }

    let filesAffected = promoted;
    let fullSnapshot = snapshot;
    // Surfaced rather than logged and lost: a regenerated index that fell back
    // to a default skeleton, or dropped an orphan, is something the operator
    // needs told.
    const indexNotes: string[] = [];

    // After every promotion, regenerate the section's index.json so that
    // any new files added to the directory are immediately discoverable by
    // the frontend without requiring a source-code change. Each regenerator
    // preserves existing labels and only writes if something actually changed.
    // If this step fails, the staged promotion above is rolled back too so no
    // partial state can remain.
    // Which fields are editorial and which are regenerated is declared per
    // type in index-schema.ts, and applied by one merge engine. Types with no
    // schema have no index to regenerate: formations/index.json is static
    // structural config, and nsdap files are promoted as-is.
    const indexRegenerator = schemaFor(type) ? () => regenerateIndex(type, targetDir) : null;

    if (indexRegenerator) {
      try {
        if (type === "armaments") {
          // Armaments prunes orphaned other-axis.json files (per-nation migration artifact).
          const touchedCategories = categoriesInBatch(promoted);
          const orphanDeletions = await findOrphanedOtherAxisFiles(targetDir, touchedCategories, promoted);
          if (orphanDeletions.size > 0) {
            const { applied: orphanApplied, snapshot: orphanSnapshot } = await applyFileChangesAtomically(targetDir, orphanDeletions);
            filesAffected = [...filesAffected, ...orphanApplied];
            fullSnapshot = { ...fullSnapshot, ...orphanSnapshot };
          }
        } else if (type === "campaigns" || type === "articles") {
          // Campaigns and articles prune old per-theater/per-category aggregate
          // JSON files at the root of the data directory (e.g. eastern-front.json,
          // military.json). These were written by the old pipeline and are now
          // superseded by per-record files in {theater|category}/{slug}.json subdirs.
          const orphanDeletions = await findOrphanedRootJsonFiles(targetDir, type);
          if (orphanDeletions.size > 0) {
            const { applied: orphanApplied, snapshot: orphanSnapshot } = await applyFileChangesAtomically(targetDir, orphanDeletions);
            filesAffected = [...filesAffected, ...orphanApplied];
            fullSnapshot = { ...fullSnapshot, ...orphanSnapshot };
          }
        }

        const indexChange = await indexRegenerator();
        if (indexChange) {
          indexNotes.push(...indexChange.notes);
          const { applied: indexApplied, snapshot: indexSnapshot } = await applyFileChangesAtomically(
            targetDir,
            new Map([[indexChange.relPath, indexChange.content]]),
          );
          filesAffected = [...filesAffected, ...indexApplied];
          fullSnapshot = { ...fullSnapshot, ...indexSnapshot };
        }
      } catch (err) {
        throw await abortBeforeActivation("index", err as Error, targetDir, fullSnapshot);
      }
    }

    // ── Recovery metadata, BEFORE activation ──────────────────
    // This manifest is the only way to roll this promotion back. It used to
    // be written after the pointer flip, which meant a failure here left
    // content live and permanently unrollbackable while the caller saw an
    // error and assumed nothing had happened. Persisted first, a failure is
    // simply a promotion that did not activate.
    try {
      await persistSnapshotManifest(type, runId, fullSnapshot);
    } catch (err) {
      throw await abortBeforeActivation("recovery-metadata", err as Error, targetDir, fullSnapshot);
    }

    // ── Activation ────────────────────────────────────────────
    // For a versioned type, writeActiveVersion inside this call is the exact
    // moment the new content becomes what readers are served. Everything
    // above is reversible; nothing below may throw.
    //
    // Gated, because createVersionFrom captures VERSIONED_TYPES only. Run
    // unconditionally it did real damage for nsdap: a version containing no
    // nsdap content and no change to anything else was captured, activated,
    // and then counted against "active plus three prior" — so three nsdap
    // promotions evicted three versions that recorded actual published
    // state, replacing the rollback window with duplicates. Skipping it is
    // not a loss of safety for nsdap: its content is served live from
    // public/data and was never covered by a version, and its rollback runs
    // from the snapshot manifest persisted above, which is unchanged.
    let version: string | undefined;
    if (isVersionedType(type)) {
      try {
        version = await captureAndActivateVersion();
      } catch (err) {
        throw await abortBeforeActivation("activation", err as Error, targetDir, fullSnapshot);
      }
    }

    // ── After activation: housekeeping only ───────────────────
    // The content is live and recoverable from here on, so nothing below may
    // throw — see completeAfterActivation. Both the reported activation and
    // whether anything is pruned are derived from `version` rather than
    // re-testing the type, so they cannot disagree with what actually ran.
    const { steps, warnings, status } = await completeAfterActivation({
      runId,
      // Persisted above, before activation.
      recoveryMetadata: "persisted",
      activation: version ? "activated" : "not-applicable",
      prune: version ? () => versionStore.pruneVersions() : null,
      recordHistory: () => appendHistory({
        runId, action: "promote", type, timestamp: new Date().toISOString(), userId, filesAffected,
        ...(indexNotes.length > 0 ? { indexNotes } : {}),
      }),
    });

    return {
      runId, action: "promote", type, filesAffected, steps, status,
      ...(version ? { version } : {}),
      ...(indexNotes.length > 0 ? { indexNotes } : {}),
      ...(warnings.length > 0 ? { warnings } : {}),
    };
  }

  // Restores public/data/<type>/ to exactly the state it was in
  // immediately before a specific past promotion run, using that run's
  // saved snapshot manifest — deleting any file the manifest says did not
  // exist before that promotion, restoring the saved content for every
  // other file it touched.
  async rollback(type: string, targetRunId: string, userId: string, confirmRollback: true): Promise<PromotionResult> {
    const runId = randomUUID();

    if (!PROMOTION_ENABLED || confirmRollback !== true) {
      return {
        runId, action: "rollback", type, filesAffected: [], status: "disabled",
        error: "Promotion (and therefore rollback) is disabled (PROMOTION_ENABLED=false).",
      };
    }

    // Same lock as promote(), for the same reason: a rollback rewrites
    // public/data and then captures it as a version, so it is a publication
    // operation and must not interleave with another one — including a
    // second rollback of a different type, which would otherwise be captured
    // mid-restore.
    return publicationLock.run(() => this.rollbackLocked(type, targetRunId, userId, runId));
  }

  private async rollbackLocked(
    type: string,
    targetRunId: string,
    userId: string,
    runId: string,
  ): Promise<PromotionResult> {
    // Validated in full before anything else happens: structure, entry
    // types, key safety, checksum where there is one, and that it records at
    // least one file. Every rejection here is strictly before the first read
    // of public/data, let alone the first write, the pointer, the history
    // file or the audit row.
    let snapshot: PromotionSnapshot;
    try {
      ({ snapshot } = await readSnapshotManifest(manifestPath(type, targetRunId)));
    } catch (err) {
      throw rollbackTargetError(type, targetRunId, err);
    }

    const targetDir = publicDataDir(type);
    // What this rollback is about to overwrite, so a failure part-way can be
    // put back and verified rather than left half-applied.
    //
    // Wrapped because this can now fail: a file that is present but
    // unreadable stops the capture instead of being recorded as absent. That
    // is strictly before the first write, so it is reported as such — and
    // the read error is carried through rather than reduced to a generic
    // 500, since which file and which errno is the whole diagnosis.
    let beforeRollback: PromotionSnapshot;
    try {
      beforeRollback = await captureCurrentState(targetDir, snapshot);
    } catch (err) {
      abortBeforeAnyWrite("content", err as Error, targetDir);
    }

    // ── Durable recovery point, BEFORE the first destructive write ──
    //
    // beforeRollback existed only as a local, so a process that died during
    // the restore left public/data part-way between two states with no
    // record of either. Compensation that only runs when JavaScript catches
    // an error is not recovery; it is a best case.
    //
    // Written to the ROLLBACK's own run directory, never over the target
    // promotion's manifest.json — the writer refuses that filename, because
    // overwriting it would destroy the very thing this rollback is reading.
    //
    // A failure here aborts before anything is written. That is deliberate
    // and is not downgraded to a warning: proceeding would reinstate exactly
    // the gap this closes, while reporting that it had been closed.
    const runDir = snapshotDir(type, runId);
    const activeVersionAtCapture = await versionStore.readActiveVersion();
    let recoveryChecksum: string;
    try {
      ({ checksum: recoveryChecksum } = await writeRecoveryPoint(
        recoveryPointPath(runDir),
        { type, runId, restoredFromRunId: targetRunId, activeVersionAtCapture },
        beforeRollback,
      ));
    } catch (err) {
      abortBeforeAnyWrite("recovery-metadata", err as Error, targetDir);
    }

    // ── Write-start marker ────────────────────────────────────
    //
    // Written and flushed before the first destructive write, so the two are
    // ordered on disk. What that ordering establishes depends on how a run
    // ended, and the difference matters:
    //
    //   - Its PRESENCE means only that writes were about to begin. Never
    //     that any landed, and never that the run failed or succeeded.
    //   - Its ABSENCE means writes had not begun only where absence is
    //     meaningful: a process killed with the filesystem intact, or a
    //     platform that can flush a directory entry. On Windows it cannot
    //     (fsync on a directory fails), and this marker lives in a different
    //     directory from the content files, so after a power loss a lost
    //     marker alongside completed writes is reachable. Absence is then
    //     AMBIGUOUS, not proof.
    //
    // STATE_MEANING in rollback-recovery.ts is the full statement of this,
    // and the inspection command reports the ambiguity where it applies.
    try {
      await writeWriteMarker(writeMarkerPath(runDir), {
        type, runId, restoredFromRunId: targetRunId,
        recoveryChecksum, fileCount: Object.keys(beforeRollback).length,
      });
    } catch (err) {
      abortBeforeAnyWrite("recovery-metadata", err as Error, targetDir);
    }

    // ── First destructive write ───────────────────────────────
    let restored: string[];
    try {
      restored = (await restoreFromSnapshot(targetDir, snapshot)).restored;
    } catch (err) {
      throw await abortBeforeActivation("content", err as Error, targetDir, beforeRollback);
    }

    // ── Verify the restore actually landed ────────────────────
    //
    // restoreFromSnapshot resolving is not evidence that the bytes are
    // there. Every write is a rename, and a rename that resolves without
    // moving anything — a stubbed or lying filesystem layer, a silently
    // failing driver — leaves the content untouched while the call reports
    // success. Taken on trust, that produced a rollback with
    // status: "success", a filesAffected list, an activated version and a
    // completion record, over content that was never written.
    //
    // So the disk is read back and compared against the validated target:
    // every entry with content must match byte-for-byte, and every null
    // entry must be ABSENT. Checking only the files that should exist would
    // let a deletion that never happened pass as done.
    const landed = await verifyAgainstSnapshot(targetDir, snapshot);
    if (!landed.matched) {
      // Routed through the same compensation path as a thrown write failure:
      // beforeRollback is restored and byte-verified, and the resulting
      // PromotionAbortedError carries the restoration outcome and any paths
      // that could not be put back. Nothing is activated.
      throw await abortBeforeActivation(
        "content",
        new Error(
          `the restore reported success but ${landed.mismatched.length} of ` +
            `${Object.keys(snapshot).length} file(s) do not match the target snapshot ` +
            `(${landed.mismatched.slice(0, 10).join(", ")}` +
            `${landed.mismatched.length > 10 ? ", …" : ""})`,
        ),
        targetDir,
        beforeRollback,
      );
    }

    // A rollback produces a new published state, so it becomes a new version
    // rather than reactivating an old directory — the version history stays a
    // forward-only record of what was live and when.
    //
    // Gated exactly as promote() is: rolling nsdap back would otherwise
    // capture and activate a version holding none of what it changed, and
    // spend a retention slot doing it.
    let version: string | undefined;
    if (isVersionedType(type)) {
      try {
        version = await captureAndActivateVersion();
      } catch (err) {
        throw await abortBeforeActivation("activation", err as Error, targetDir, beforeRollback);
      }
    }

    // Activated.
    //
    // recoveryMetadata is "persisted", not "not-applicable". Until R8 Stage 3
    // a rollback genuinely wrote no snapshot of its own and "not-applicable"
    // was the truthful answer; it now writes a durable, checksummed
    // pre-rollback recovery point before its first destructive write, under
    // this same runId. Continuing to report "none written" would tell an
    // operator that recovery is impossible when the artefact to recover from
    // is sitting on disk.
    const { steps, warnings, status } = await completeAfterActivation({
      runId,
      recoveryMetadata: "persisted",
      activation: version ? "activated" : "not-applicable",
      prune: version ? () => versionStore.pruneVersions() : null,
      recordHistory: () => appendHistory({
        runId, action: "rollback", type, timestamp: new Date().toISOString(), userId,
        filesAffected: restored, restoredFromRunId: targetRunId,
      }),
    });

    // ── Completion record, last ───────────────────────────────
    // Best-effort by design: the content is already live and recoverable, so
    // this must not throw. Its absence understates how far the run got —
    // inspection reports "writing", which is the safe direction to be wrong
    // in — and is never read as proof that the rollback failed.
    const allWarnings = [...warnings];
    try {
      await writeCompletion(completionPath(runDir), {
        type, runId, restoredFromRunId: targetRunId,
        activatedVersion: version ?? null, filesRestored: restored.length,
      });
    } catch (err) {
      allWarnings.push(
        `The rollback is complete and its content is live, but the completion record ` +
          `could not be written (${(err as Error).message}). The recovery point and write ` +
          `marker under runId ${runId} are unaffected; inspection will report this run as ` +
          `"writing" rather than "completed".`,
      );
    }

    return {
      runId, action: "rollback", type, filesAffected: restored, steps,
      status: allWarnings.length > 0 ? "activated-with-warnings" : status,
      ...(version ? { version } : {}),
      ...(allWarnings.length > 0 ? { warnings: allWarnings } : {}),
    };
  }
}
