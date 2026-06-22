import fs from "fs/promises";
import path from "path";
import { randomUUID } from "crypto";

// Writes a whole directory's worth of generated files in one all-or-nothing
// operation: every file lands in a fresh temp directory first, and only if
// every single write succeeds does the real `outDir` get replaced — via an
// atomic rename, not a copy — with the temp directory's contents. If any
// write fails partway through, the temp directory is deleted and `outDir`
// is left completely untouched: whatever was there before this call
// (including nothing) is exactly what's there after a failed call. This is
// the rollback guarantee — there's no separate rollback step because
// nothing real is ever modified until everything has already succeeded.
//
// Replacing the whole directory each call (rather than patching files in
// place) also means a file that disappears from one run to the next — a
// language with zero letters this time, say — simply isn't present
// afterward, instead of lingering as a stale leftover forever.
export async function writeStagedFilesAtomically(
  outDir: string,
  files: Map<string, string>,
): Promise<string[]> {
  // Zero files is treated as "nothing to publish this run", not "delete
  // everything" — a validation bug or a transient empty query result
  // should never be able to silently wipe out previously-good staged
  // output. A real, intentional removal of all content for a type is a
  // decision for a human, not an accidental side effect of this call.
  if (files.size === 0) return [];

  const tmpDir = `${outDir}.tmp-${randomUUID()}`;
  await fs.mkdir(tmpDir, { recursive: true });

  try {
    for (const [filename, content] of files) {
      const fullPath = path.join(tmpDir, filename);
      // Every prior consumer (Letters) only ever used flat filenames, so
      // this was never needed until Armaments introduced nested paths
      // (e.g. "naval/italy.json") for its category+nation grouping. A
      // no-op for flat filenames, since the parent is just tmpDir itself,
      // which already exists.
      await fs.mkdir(path.dirname(fullPath), { recursive: true });
      await fs.writeFile(fullPath, content, "utf-8");
    }
  } catch (err) {
    await fs.rm(tmpDir, { recursive: true, force: true }).catch(() => undefined);
    throw err;
  }

  await fs.rm(outDir, { recursive: true, force: true });
  await fs.rename(tmpDir, outDir);

  return [...files.keys()].map((filename) => path.join(outDir, filename));
}
