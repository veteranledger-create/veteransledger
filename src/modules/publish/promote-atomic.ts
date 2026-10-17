import fs from "fs/promises";
import path from "path";
import { randomUUID } from "crypto";
import { normalizeRelativePath, resolveWithin } from "../../utilities/safe-path";

export interface PromotionSnapshot {
  // null means the file did not exist before this operation — restoring
  // it means deleting it, not writing empty content.
  [relPath: string]: string | null;
}

// ── Snapshot key portability ────────────────────────────────────
// Snapshot manifests persisted on Windows recorded their keys with
// backslashes (e.g. "naval\\germany.json"). On Linux those are not path
// separators at all, so a naive path.join would create/look for a single
// file literally named "naval\germany.json" instead of descending into
// naval/. Of the 26 manifests currently on disk, 199 of 250 keys use
// backslashes and 12 use forward slashes — armaments contains both — so
// resolution has to accept either, and mixed, without rewriting a single
// stored manifest.
//
// Keys are normalised to a portable, POSIX-style form on the way in and on
// the way out, which both fixes legacy restores and means every future
// manifest is written platform-independently.

// The split/containment logic itself is shared with the rest of the path
// layer (src/utilities/safe-path.ts); "snapshot key" is just this module's
// name for a relative path underneath the directory being promoted into.

/** Portable storage form for a snapshot key: POSIX separators, no redundant segments. */
export function normalizeSnapshotKey(key: string): string {
  return normalizeRelativePath(key, "snapshot key");
}

/**
 * Resolves a snapshot key against its base directory, with a containment
 * check as defence in depth — a key may only ever address a file inside baseDir.
 */
export function resolveSnapshotPath(baseDir: string, key: string): string {
  return resolveWithin(baseDir, key, "snapshot key");
}

/** One file the compensating reversal could not put back. */
export interface ReversalFailure {
  path: string;
  message: string;
}

/**
 * An atomic apply that failed, and what became of the changes it had already
 * made.
 *
 * The reversal used to be `.catch(() => undefined)` per file, so a reversal
 * that itself failed was invisible and the caller saw only the original write
 * error — unable to tell an intact directory from a part-applied one. Every
 * reversal is still attempted, in the same order as before; the difference is
 * that failures are collected and reported instead of discarded.
 *
 * The snapshot is carried too, so the caller can verify the directory against
 * it rather than taking the reversal's word for it.
 */
export class AtomicApplyError extends Error {
  constructor(
    public readonly originalError: Error,
    public readonly snapshot: PromotionSnapshot,
    /** Keys the reversal put back successfully. */
    public readonly reverted: string[],
    public readonly reversalFailures: ReversalFailure[],
  ) {
    const tail = reversalFailures.length === 0
      ? `All ${reverted.length} change(s) already applied were reversed.`
      : `${reversalFailures.length} of ${reverted.length + reversalFailures.length} change(s) ` +
        `COULD NOT BE REVERSED (${reversalFailures.map((f) => f.path).join(", ")}).`;
    super(`${originalError.message} — ${tail}`);
    this.name = "AtomicApplyError";
  }

  /** True when the reversal put every applied change back. */
  get fullyReverted(): boolean {
    return this.reversalFailures.length === 0;
  }
}

/**
 * A file that is there but could not be read while taking a snapshot.
 *
 * Raised rather than recorded, because in a snapshot `null` does not mean
 * "unknown" — it means "this file did not exist, and restoring it means
 * deleting it". Encoding a failed read as `null` therefore turns a transient
 * EACCES, EBUSY, EIO or EMFILE into a deletion instruction against a file
 * that is present, and the compensating reversal then carries it out and
 * reports a clean success. The snapshot is taken before any write, so
 * refusing here costs nothing and loses nothing.
 */
export class UnreadableFileError extends Error {
  constructor(
    /** The snapshot key, in its portable form. */
    public readonly path: string,
    public readonly originalError: NodeJS.ErrnoException,
  ) {
    super(
      `Cannot snapshot "${path}": it exists or its state could not be ` +
        `determined, and reading it failed (${originalError.code ?? "no error code"}: ` +
        `${originalError.message}). Recording it as absent would mean recording a ` +
        `deletion of a file that may be present, so nothing was written.`,
    );
    this.name = "UnreadableFileError";
  }

  /** The underlying errno code, when the platform supplied one. */
  get code(): string | undefined {
    return this.originalError.code;
  }
}

/**
 * The current content of one file for a snapshot, or null when — and only
 * when — the filesystem confirms it is not there.
 *
 * ENOENT is the single error that means absent. Every other code leaves the
 * file's existence unestablished, and the one representation available for
 * "unestablished" is also the representation for "delete this", so there is
 * no safe value to record. ENOTDIR and EISDIR are deliberately not treated
 * as absent either: both describe a path that is occupied by something a
 * restore could not remove with `rm` and could not overwrite with a rename.
 *
 * The ordinary "new file in a directory that does not exist yet" case is
 * ENOENT — Node reports that for any missing path component — so a promotion
 * staging genuinely new records is unaffected.
 */
export async function readForSnapshot(fullPath: string, key: string): Promise<string | null> {
  try {
    return await fs.readFile(fullPath, "utf-8");
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw new UnreadableFileError(key, err as NodeJS.ErrnoException);
  }
}

async function applyOne(fullPath: string, content: string | null): Promise<void> {
  if (content === null) {
    await fs.rm(fullPath, { force: true });
    return;
  }
  await fs.mkdir(path.dirname(fullPath), { recursive: true });
  const tmpPath = path.join(path.dirname(fullPath), `.tmp-${randomUUID()}-${path.basename(fullPath)}`);
  await fs.writeFile(tmpPath, content, "utf-8");
  await fs.rename(tmpPath, fullPath);
}

// The one shared, fully-recoverable primitive behind both promotion and
// rollback — each is "apply this map of relPath -> new content (or null
// to delete) into a directory that holds OTHER real content this call
// must never touch." Unlike writeStagedFilesAtomically (which
// wholesale-replaces a directory it fully owns — safe for
// storage/publish-staging/, never safe for public/data/, which also
// holds every other category's real content), this only ever touches
// the exact relPaths in `changes`.
//
// Every target is snapshotted first. Changes are then applied one at a
// time via a same-directory rename (atomic on the same filesystem) or an
// unlink. If any single change fails partway through, every change
// already applied is immediately reversed using the snapshot taken at
// the very start — so a failure can never leave a directory in a state
// that is partway between "before" and "after," regardless of whether
// this call is doing a promotion or a rollback.
export async function applyFileChangesAtomically(
  baseDir: string,
  changes: Map<string, string | null>,
): Promise<{ applied: string[]; snapshot: PromotionSnapshot }> {
  // Every key is validated and normalised up front, so an unsafe key fails
  // before anything is written rather than partway through.
  const resolved = [...changes.entries()].map(([relPath, content]) => ({
    key: normalizeSnapshotKey(relPath),
    fullPath: resolveSnapshotPath(baseDir, relPath),
    content,
  }));

  // Still before the try below, and deliberately so: an unreadable target
  // throws from here, which is strictly before the first write, so the
  // caller's "failed before anything was written" path handles it.
  const snapshot: PromotionSnapshot = {};
  for (const { key, fullPath } of resolved) {
    snapshot[key] = await readForSnapshot(fullPath, key);
  }

  const applied: string[] = [];
  const appliedPaths: string[] = [];
  try {
    for (const { key, fullPath, content } of resolved) {
      await applyOne(fullPath, content);
      applied.push(key);
      appliedPaths.push(fullPath);
    }
  } catch (err) {
    // Reverse exactly what was already applied, in the order applied, using
    // the snapshot taken before any change was made. Every one is attempted
    // even if an earlier reversal fails — stopping early would leave more
    // behind, not less — and each failure is recorded rather than swallowed.
    const reverted: string[] = [];
    const reversalFailures: ReversalFailure[] = [];
    for (let i = 0; i < applied.length; i++) {
      try {
        await applyOne(appliedPaths[i], snapshot[applied[i]]);
        reverted.push(applied[i]);
      } catch (reversalError) {
        reversalFailures.push({ path: applied[i], message: (reversalError as Error).message });
      }
    }
    throw new AtomicApplyError(err as Error, snapshot, reverted, reversalFailures);
  }

  return { applied, snapshot };
}

// Thin, intention-revealing wrapper for the promotion case specifically —
// promotion only ever writes, never deletes.
export async function promoteFilesAtomically(
  baseDir: string,
  files: Map<string, string>,
): Promise<{ promoted: string[]; snapshot: PromotionSnapshot }> {
  const { applied, snapshot } = await applyFileChangesAtomically(baseDir, files);
  return { promoted: applied, snapshot };
}

// Thin wrapper for rollback — restoring a saved snapshot is exactly
// "apply these saved contents (including nulls, meaning delete)," with
// the identical all-or-nothing guarantee as promotion itself.
export async function restoreFromSnapshot(
  baseDir: string,
  snapshot: PromotionSnapshot,
  onlyPaths?: string[],
): Promise<{ restored: string[] }> {
  // A stored manifest may key entries in either separator convention, and a
  // caller may ask for paths in the other one. Both sides are normalised
  // before lookup so a legacy Windows-written snapshot restores correctly on
  // any platform, and vice versa.
  const byNormalized = new Map<string, string | null>();
  for (const [key, content] of Object.entries(snapshot)) {
    byNormalized.set(normalizeSnapshotKey(key), content);
  }

  const paths = onlyPaths ?? [...byNormalized.keys()];
  const changes = new Map<string, string | null>();
  for (const p of paths) {
    const key = normalizeSnapshotKey(p);
    if (!byNormalized.has(key)) {
      throw new Error(`Cannot restore "${p}": not present in this snapshot`);
    }
    changes.set(key, byNormalized.get(key) ?? null);
  }

  const { applied } = await applyFileChangesAtomically(baseDir, changes);
  return { restored: applied };
}
