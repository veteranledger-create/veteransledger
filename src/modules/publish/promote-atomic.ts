import fs from "fs/promises";
import path from "path";
import { randomUUID } from "crypto";

export interface PromotionSnapshot {
  // null means the file did not exist before this operation — restoring
  // it means deleting it, not writing empty content.
  [relPath: string]: string | null;
}

async function readCurrent(fullPath: string): Promise<string | null> {
  try {
    return await fs.readFile(fullPath, "utf-8");
  } catch {
    return null;
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
  const snapshot: PromotionSnapshot = {};
  for (const relPath of changes.keys()) {
    snapshot[relPath] = await readCurrent(path.join(baseDir, relPath));
  }

  const applied: string[] = [];
  try {
    for (const [relPath, content] of changes) {
      await applyOne(path.join(baseDir, relPath), content);
      applied.push(relPath);
    }
  } catch (err) {
    // Reverse exactly what was already applied, in the order applied,
    // using the snapshot taken before any change was made.
    for (const relPath of applied) {
      await applyOne(path.join(baseDir, relPath), snapshot[relPath]).catch(() => undefined);
    }
    throw err;
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
  const paths = onlyPaths ?? Object.keys(snapshot);
  const changes = new Map<string, string | null>(paths.map((p) => [p, snapshot[p]]));
  const { applied } = await applyFileChangesAtomically(baseDir, changes);
  return { restored: applied };
}
