import fs from "fs/promises";
import path from "path";
import { randomUUID } from "crypto";

export interface PromotionSnapshot {
  // null means the file did not exist before this promotion — restoring
  // it on rollback means deleting it, not writing empty content.
  [relPath: string]: string | null;
}

// Per-file atomic merge into a directory that holds OTHER real content
// this call must never touch — unlike writeStagedFilesAtomically (which
// wholesale-replaces a directory it fully owns, safe for
// storage/publish-staging/ but never safe for public/data/, which also
// holds every other category's real archive content). Each file is
// snapshotted, then swapped via a same-directory rename (atomic on the
// same filesystem). If any swap fails partway, every file already
// swapped is restored from the snapshot just taken before rethrowing —
// the directory is never left in a mixed old/new state.
export async function promoteFilesAtomically(
  baseDir: string,
  files: Map<string, string>,
): Promise<{ promoted: string[]; snapshot: PromotionSnapshot }> {
  const snapshot: PromotionSnapshot = {};
  for (const relPath of files.keys()) {
    const fullPath = path.join(baseDir, relPath);
    try {
      snapshot[relPath] = await fs.readFile(fullPath, "utf-8");
    } catch {
      snapshot[relPath] = null; // genuinely new — nothing to restore but deletion
    }
  }

  const promoted: string[] = [];
  try {
    for (const [relPath, content] of files) {
      const fullPath = path.join(baseDir, relPath);
      await fs.mkdir(path.dirname(fullPath), { recursive: true });
      const tmpPath = path.join(path.dirname(fullPath), `.tmp-${randomUUID()}-${path.basename(fullPath)}`);
      await fs.writeFile(tmpPath, content, "utf-8");
      await fs.rename(tmpPath, fullPath);
      promoted.push(relPath);
    }
  } catch (err) {
    await restoreFromSnapshot(baseDir, snapshot, promoted);
    throw err;
  }

  return { promoted, snapshot };
}

// Shared by both the promotion failure-path above and the real rollback
// feature — restoring a snapshot is the identical operation either way,
// just triggered by a different caller.
export async function restoreFromSnapshot(
  baseDir: string,
  snapshot: PromotionSnapshot,
  onlyPaths?: string[],
): Promise<void> {
  const paths = onlyPaths ?? Object.keys(snapshot);
  for (const relPath of paths) {
    const fullPath = path.join(baseDir, relPath);
    const original = snapshot[relPath];
    if (original === null) {
      await fs.rm(fullPath, { force: true });
    } else {
      const tmpPath = path.join(path.dirname(fullPath), `.tmp-${randomUUID()}-${path.basename(fullPath)}`);
      await fs.writeFile(tmpPath, original, "utf-8");
      await fs.rename(tmpPath, fullPath);
    }
  }
}
