import fs from "fs/promises";
import path from "path";
import { randomUUID } from "crypto";
import { sha256 } from "../editorial-history/revision-store";
import { normalizeSnapshotKey, PromotionSnapshot } from "./promote-atomic";

/**
 * Reading and writing the snapshot manifest that makes a promotion
 * reversible.
 *
 * The manifest is the single artefact standing between a promotion and an
 * unrecoverable one: rollback restores from it and from nothing else. It was
 * written with a bare, non-atomic `fs.writeFile` and read with a bare
 * `JSON.parse`, which left three gaps worth closing together:
 *
 *  - An interrupted write left a truncated file. The next rollback either
 *    failed to parse it — and reported "no snapshot found", sending the
 *    operator to look for a missing file rather than a damaged one — or, if
 *    the truncation happened to land on a parseable fragment, restored a
 *    subset of what it should have.
 *  - Nothing detected silent corruption. A manifest that parses is not a
 *    manifest that is intact.
 *  - `{}` was accepted. A rollback against it reported success having
 *    restored nothing.
 *
 * ── Format ──────────────────────────────────────────────────
 *
 * New manifests are written as an envelope:
 *
 *   {
 *     "formatVersion": 1,
 *     "kind": "promotion-snapshot",
 *     "type": "armaments",
 *     "runId": "…",
 *     "createdAt": "2026-10-13T…Z",
 *     "algorithm": "sha256",
 *     "checksum": "<hex>",
 *     "snapshot": { "naval/germany.json": "…", "naval/romania.json": null }
 *   }
 *
 * Manifests written before this change are a bare snapshot object with no
 * envelope. All 26 of those on disk are read exactly as they always were and
 * are never rewritten or migrated: a rollback that has worked for a year
 * must not start failing because the writer changed. They simply carry no
 * checksum, and the reader says so rather than implying one was verified.
 *
 * ── What the checksum is and is not ─────────────────────────
 *
 * It detects accidental corruption: a truncated write, a bad sector, a
 * partial copy, an editor that mangled the file. It is NOT authentication.
 * Anyone able to modify the manifest can recompute the digest over their own
 * payload and store it in the same file, and the result will verify. Nothing
 * here defends against a party with write access to the snapshot directory;
 * the filesystem's own access control is what does that.
 */

export const SNAPSHOT_FORMAT_VERSION = 1;
export const CHECKSUM_ALGORITHM = "sha256";
const MANIFEST_KIND = "promotion-snapshot";
const HEX_64 = /^[0-9a-f]{64}$/;

export interface SnapshotEnvelope {
  formatVersion: number;
  kind: typeof MANIFEST_KIND;
  type: string;
  runId: string;
  createdAt: string;
  algorithm: typeof CHECKSUM_ALGORITHM;
  checksum: string;
  snapshot: PromotionSnapshot;
}

export type ManifestFormat = "envelope" | "legacy";

export interface LoadedManifest {
  /** The snapshot exactly as stored, keys unmodified. */
  snapshot: PromotionSnapshot;
  format: ManifestFormat;
  /** The verified digest, or null for a legacy manifest that carries none. */
  checksum: string | null;
  /** Present only for an envelope. */
  envelope: SnapshotEnvelope | null;
}

/** The manifest is not there. Distinct from being there and unusable. */
export class ManifestMissingError extends Error {
  constructor(public readonly filePath: string) {
    super(`No snapshot manifest at ${filePath}`);
    this.name = "ManifestMissingError";
  }
}

/**
 * Why a manifest that exists cannot be used. Enumerated rather than folded
 * into one message, because "it is damaged", "it is empty" and "I could not
 * open it" call for different responses from an operator.
 */
export type ManifestInvalidReason =
  | "unreadable"
  | "unparseable"
  | "not-an-object"
  | "bad-entry"
  | "unsafe-key"
  | "empty"
  | "bad-envelope"
  | "checksum-mismatch";

export class ManifestInvalidError extends Error {
  constructor(
    public readonly reason: ManifestInvalidReason,
    public readonly filePath: string,
    detail: string,
    public readonly originalError?: Error,
  ) {
    super(`Snapshot manifest at ${filePath} is unusable (${reason}): ${detail}`);
    this.name = "ManifestInvalidError";
  }
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * The bytes the checksum is computed over.
 *
 * Deterministic by construction: keys are sorted, and the result is an array
 * of [key, value] pairs rather than an object, so nothing depends on JSON
 * object key ordering — which is an insertion-order artefact and would
 * change the digest if a manifest were ever re-serialised in another order.
 *
 * The digest covers the snapshot exactly as it is stored, including the
 * spelling of its keys. A legacy Windows key ("naval\\germany.json") and its
 * portable form ("naval/germany.json") hash differently on purpose: the
 * checksum answers "are these the bytes that were written", not "do these
 * mean the same thing".
 */
export function canonicalSnapshot(snapshot: PromotionSnapshot): string {
  return JSON.stringify(Object.keys(snapshot).sort().map((key) => [key, snapshot[key]]));
}

export function snapshotChecksum(snapshot: PromotionSnapshot): string {
  return sha256(canonicalSnapshot(snapshot));
}

/**
 * Checks a parsed value really is a snapshot: a plain object whose every
 * value is a string or null, and whose every key resolves to a safe relative
 * path. Returns it unchanged — this validates, it does not repair, because
 * a manifest that needs repairing is one whose contents cannot be trusted to
 * drive a restore.
 */
export function validateSnapshotShape(value: unknown, filePath: string): PromotionSnapshot {
  if (!isPlainObject(value)) {
    throw new ManifestInvalidError(
      "not-an-object", filePath,
      `expected an object of path → content, found ${Array.isArray(value) ? "an array" : typeof value}`,
    );
  }

  for (const [key, entry] of Object.entries(value)) {
    if (entry !== null && typeof entry !== "string") {
      throw new ManifestInvalidError(
        "bad-entry", filePath,
        `entry "${key}" is ${Array.isArray(entry) ? "an array" : typeof entry}; ` +
          `every entry must be a string (the file's content) or null (the file was absent)`,
      );
    }
    try {
      normalizeSnapshotKey(key);
    } catch (err) {
      throw new ManifestInvalidError(
        "unsafe-key", filePath,
        `entry "${key}" is not a safe relative path (${(err as Error).message})`,
        err as Error,
      );
    }
  }

  return value as PromotionSnapshot;
}

/** Strict envelope parsing. An envelope that is wrong is never read as legacy. */
function parseEnvelope(parsed: Record<string, unknown>, filePath: string): SnapshotEnvelope {
  const bad = (detail: string): never => {
    throw new ManifestInvalidError("bad-envelope", filePath, detail);
  };

  if (parsed.formatVersion !== SNAPSHOT_FORMAT_VERSION) {
    bad(
      `formatVersion is ${JSON.stringify(parsed.formatVersion)}; this build reads ` +
        `version ${SNAPSHOT_FORMAT_VERSION}. A newer manifest is not guessed at.`,
    );
  }
  if (parsed.kind !== MANIFEST_KIND) {
    bad(`kind is ${JSON.stringify(parsed.kind)}, expected "${MANIFEST_KIND}"`);
  }
  if (parsed.algorithm !== CHECKSUM_ALGORITHM) {
    bad(`algorithm is ${JSON.stringify(parsed.algorithm)}, expected "${CHECKSUM_ALGORITHM}"`);
  }
  if (typeof parsed.checksum !== "string" || !HEX_64.test(parsed.checksum)) {
    bad(`checksum is not a 64-character ${CHECKSUM_ALGORITHM} hex digest`);
  }
  for (const field of ["type", "runId", "createdAt"] as const) {
    if (typeof parsed[field] !== "string" || parsed[field] === "") {
      bad(`${field} is missing or not a non-empty string`);
    }
  }

  const snapshot = validateSnapshotShape(parsed.snapshot, filePath);

  return {
    formatVersion: SNAPSHOT_FORMAT_VERSION,
    kind: MANIFEST_KIND,
    type: parsed.type as string,
    runId: parsed.runId as string,
    createdAt: parsed.createdAt as string,
    algorithm: CHECKSUM_ALGORITHM,
    checksum: parsed.checksum as string,
    snapshot,
  };
}

/**
 * Loads a manifest, in either format, and refuses anything a restore could
 * not act on.
 *
 * An empty snapshot is refused rather than returned: it describes no
 * restorable change, and the only thing a caller can do with it is report a
 * rollback that restored nothing. None of the manifests on disk are empty,
 * and the promotion path cannot produce one — it refuses to promote with no
 * staged files — so an empty manifest means damage, not an edge case.
 */
export async function readSnapshotManifest(filePath: string): Promise<LoadedManifest> {
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
    // The commonest cause is a write interrupted part-way. Saying "not valid
    // JSON" is the difference between looking for a damaged file and looking
    // for a missing one.
    throw new ManifestInvalidError(
      "unparseable", filePath,
      `not valid JSON (${(err as Error).message}). A manifest truncated by an ` +
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

  // An envelope announces itself with formatVersion. A legacy manifest maps
  // relative paths to string-or-null, so it cannot carry that field with a
  // non-string value, and a legacy key is a path ending in .json rather than
  // a bare word — the two are not confusable.
  const isEnvelope = "formatVersion" in parsed || "snapshot" in parsed;

  if (isEnvelope) {
    const envelope = parseEnvelope(parsed, filePath);
    requireRestorable(envelope.snapshot, filePath);

    const actual = snapshotChecksum(envelope.snapshot);
    if (actual !== envelope.checksum) {
      throw new ManifestInvalidError(
        "checksum-mismatch", filePath,
        `recorded ${envelope.checksum.slice(0, 12)}…, computed ${actual.slice(0, 12)}… ` +
          `over ${Object.keys(envelope.snapshot).length} entr(ies). The file has changed ` +
          `since it was written and must not be used to restore anything.`,
      );
    }

    return { snapshot: envelope.snapshot, format: "envelope", checksum: actual, envelope };
  }

  const snapshot = validateSnapshotShape(parsed, filePath);
  requireRestorable(snapshot, filePath);
  return { snapshot, format: "legacy", checksum: null, envelope: null };
}

function requireRestorable(snapshot: PromotionSnapshot, filePath: string): void {
  if (Object.keys(snapshot).length === 0) {
    throw new ManifestInvalidError(
      "empty", filePath,
      "it records no files, so restoring from it would change nothing while " +
        "reporting a completed rollback",
    );
  }
}

/** What durability the write actually achieved, as opposed to attempted. */
export interface DurabilityReport {
  /** The manifest's own bytes were flushed before the rename made them visible. */
  fileSynced: boolean;
  /** The directory entry created by the rename was flushed. */
  directorySynced: boolean;
  /** Why the directory was not synced, when it was not. */
  directorySyncSkipped?: string;
}

/**
 * Flushes a directory's own metadata, so a rename is durable and not merely
 * visible.
 *
 * Not supported on Windows: Node cannot open a directory for the handle this
 * needs, and `fsync` on it fails with EPERM. Verified on this host rather
 * than assumed — see the test. NTFS journals metadata, so the rename itself
 * stays atomic (a reader sees the old name or the new one, never a torn
 * entry), but without this flush the new name is not guaranteed to survive a
 * power loss even though the file's contents are. That is a real gap and is
 * reported rather than papered over.
 */
/**
 * Whether this platform can flush a directory entry at all.
 *
 * Not a guess: the durability test in snapshot-manifest.test.ts asserts the
 * reported outcome per platform against a real write, so this constant and
 * the measured behaviour cannot drift apart without a test failing.
 *
 * Its consequence is not confined to the write path. Where a directory entry
 * cannot be flushed, the *absence* of a file after a crash does not establish
 * that it was never written — which is what any inference drawn from a
 * missing artefact depends on.
 */
export function directoryFsyncAvailable(): boolean {
  return process.platform !== "win32";
}

async function syncDirectory(dir: string): Promise<{ ok: boolean; skipped?: string }> {
  let handle: import("fs/promises").FileHandle | undefined;
  try {
    handle = await fs.open(dir, "r");
    await handle.sync();
    return { ok: true };
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code ?? "unknown";
    return { ok: false, skipped: `${code} on ${process.platform}` };
  } finally {
    await handle?.close().catch(() => undefined);
  }
}

/**
 * Writes a manifest so that it is either entirely present and intact, or not
 * present at all.
 *
 * Required ordering, and why each step is where it is:
 *
 *   1. serialise, with the checksum computed over the snapshot
 *   2. write the bytes to a temp file IN THE SAME DIRECTORY — a rename is
 *      only atomic within one filesystem
 *   3. fsync the temp file — the bytes must be durable BEFORE a name points
 *      at them, or a crash can leave a correctly-named empty file, which is
 *      worse than no file because it reads as a manifest
 *   4. rename over the final path — the single step that makes it visible
 *   5. fsync the directory, so the new name is durable too
 *
 * A failure at any point before step 4 leaves the previous manifest, if any,
 * exactly as it was, and the temp file is removed.
 */
export async function writeJsonAtomically(filePath: string, body: string): Promise<DurabilityReport> {
  const dir = path.dirname(filePath);
  await fs.mkdir(dir, { recursive: true });

  const tmpPath = path.join(dir, `.tmp-${randomUUID()}-${path.basename(filePath)}`);
  let fileSynced = false;
  try {
    const handle = await fs.open(tmpPath, "w");
    try {
      await handle.writeFile(body, "utf-8");
      await handle.sync();
      fileSynced = true;
    } finally {
      await handle.close();
    }
    await fs.rename(tmpPath, filePath);
  } catch (err) {
    await fs.rm(tmpPath, { force: true }).catch(() => undefined);
    throw err;
  }

  const dirSync = await syncDirectory(dir);
  return {
    fileSynced,
    directorySynced: dirSync.ok,
    ...(dirSync.skipped ? { directorySyncSkipped: dirSync.skipped } : {}),
  };
}

export async function writeSnapshotManifest(
  filePath: string,
  meta: { type: string; runId: string; createdAt?: string },
  snapshot: PromotionSnapshot,
): Promise<DurabilityReport> {
  validateSnapshotShape(snapshot, filePath);

  const envelope: SnapshotEnvelope = {
    formatVersion: SNAPSHOT_FORMAT_VERSION,
    kind: MANIFEST_KIND,
    type: meta.type,
    runId: meta.runId,
    createdAt: meta.createdAt ?? new Date().toISOString(),
    algorithm: CHECKSUM_ALGORITHM,
    checksum: snapshotChecksum(snapshot),
    snapshot,
  };

  return writeJsonAtomically(filePath, `${JSON.stringify(envelope, null, 2)}\n`);
}
