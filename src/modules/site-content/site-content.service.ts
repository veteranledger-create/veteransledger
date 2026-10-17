import path from "path";
import fs from "fs/promises";
import { paths } from "../../config/paths";
import { resolveWithin } from "../../utilities/safe-path";
import { AppError } from "../../middleware/error.middleware";
import { isAllowedKey } from "./editable-keys";
import { validateContent } from "../editorial-history/content-validation";
import { revisionStore, Revision, ReconcileReport, RevisionStore } from "../editorial-history/revision-store";
import { isRegeneratedIndexKey, publicationLock } from "../publish/publication-lock";

/**
 * Read and write the hand-maintained JSON under public/data/.
 *
 * The files stay exactly where they are, served by the same URLs. What has
 * changed is that a save is now recorded before it is applied, and is
 * validated before either: this API previously accepted any JSON body and
 * wrote it straight over the file with a non-atomic fs.writeFile, so a
 * truncated write or a body that was a bare string would destroy a manifest
 * with nothing to recover from.
 */

function validateKey(key: string): void {
  if (!key || typeof key !== "string") throw new AppError(400, "key is required");
  // Block path traversal and absolute paths
  if (key.includes("..") || path.isAbsolute(key) || key.includes("\\")) {
    throw new AppError(400, "Invalid key");
  }
  // Must end in .json
  if (!key.endsWith(".json")) throw new AppError(400, "key must reference a .json file");
  // Must match an allowed prefix
  if (!isAllowedKey(key)) throw new AppError(403, `Key '${key}' is not editable via this API`);
}

/**
 * The allowlist above is the real boundary: editorial content shares a
 * directory with generated archive output, so containment alone would still
 * permit an editorial save to land on a published record. The containment
 * check stays as defence in depth.
 */
function resolvedPath(contentRoot: string, key: string): string {
  try {
    return resolveWithin(contentRoot, key, "key");
  } catch {
    throw new AppError(400, "Invalid key");
  }
}

/** The exact on-disk serialisation this API has always written. */
function serialize(content: unknown): string {
  return `${JSON.stringify(content, null, 2)}\n`;
}

export interface SaveOptions {
  actor?: string | null;
  note?: string | null;
}

export class SiteContentService {
  constructor(
    private readonly store: RevisionStore = revisionStore,
    /** Where the editable files live. Overridden only by tests. */
    private readonly contentRoot: string = paths.editorial.root,
  ) {}

  async read(key: string): Promise<unknown> {
    validateKey(key);
    const filePath = resolvedPath(this.contentRoot, key);
    try {
      const raw = await fs.readFile(filePath, "utf-8");
      return JSON.parse(raw);
    } catch (err: unknown) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") throw new AppError(404, `Not found: ${key}`);
      throw new AppError(500, "Failed to read site content");
    }
  }

  /** Current parsed content, or null when the file does not exist yet. */
  private async currentContent(filePath: string): Promise<unknown | null> {
    try {
      return JSON.parse(await fs.readFile(filePath, "utf-8"));
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") return null;
      // Unparseable current content must not block replacing it, but it also
      // cannot be compared against — so shape checks are skipped, not faked.
      return null;
    }
  }

  /**
   * Runs a save under the publication lock when, and only when, the file is
   * one the promotion pipeline regenerates.
   *
   * Eight section manifests are editable here and rebuilt at promotion time.
   * Regeneration is a read-modify-write and so is a save: without this, a
   * save landing inside regeneration's window is discarded by it, and a
   * regeneration landing inside a save's window is discarded by the save.
   * D6 narrowed which fields a save may contain; it did not decide which of
   * two concurrent writers wins.
   *
   * The lock spans reading the current content as well as writing, because
   * the validation that reads it is comparing against the state the write
   * assumes — a regeneration between the two would make the check describe a
   * file that no longer exists in that form.
   *
   * Everything else — navigation.json, the about/legal/nsdap trees — has no
   * second writer, so it is left to run unserialised rather than queued
   * behind a long promotion for no benefit.
   */
  private async coordinated<T>(key: string, fn: () => Promise<T>): Promise<T> {
    return isRegeneratedIndexKey(key) ? publicationLock.run(fn) : fn();
  }

  async write(key: string, content: unknown, options: SaveOptions = {}): Promise<Revision> {
    validateKey(key);
    const filePath = resolvedPath(this.contentRoot, key);

    return this.coordinated(key, async () => {
      const failure = validateContent(key, content, await this.currentContent(filePath));
      if (failure) throw new AppError(failure.status, failure.message);

      try {
        return await this.store.recordAndApply({
          key,
          targetFile: filePath,
          content: serialize(content),
          actor: options.actor ?? null,
          note: options.note ?? null,
          source: "save",
        });
      } catch (err) {
        // The revision is written before the editable file, so a failure here
        // means the file on disk is untouched. Saying so is the point: the
        // caller must not believe a save landed.
        throw new AppError(
          500,
          `Save was not applied — its history could not be recorded: ${(err as Error).message}`,
        );
      }
    });
  }

  async history(key: string): Promise<Revision[]> {
    validateKey(key);
    return this.store.list(key);
  }

  /**
   * Puts one file back to a recorded revision.
   *
   * The revision's bytes are checksum-verified by the store before they are
   * used, re-validated through exactly the same checks a normal save runs,
   * and then applied as a NEW revision. History is append-only: a restore is
   * recorded, never a rewind, so the state being replaced stays recoverable.
   */
  async restore(key: string, revisionId: string, options: SaveOptions = {}): Promise<Revision> {
    validateKey(key);
    const filePath = resolvedPath(this.contentRoot, key);

    // Coordinated on the same terms as write(). A restore is a save of
    // recorded bytes through the identical validate-then-apply path to the
    // identical file, so excluding it would leave the race openable from the
    // Admin's own revision history.
    return this.coordinated(key, async () => {
      let bytes: string;
      try {
        bytes = await this.store.read(key, revisionId);
      } catch (err) {
        throw new AppError(409, `Cannot restore: ${(err as Error).message}`);
      }

      let parsed: unknown;
      try {
        parsed = JSON.parse(bytes);
      } catch {
        throw new AppError(409, `Cannot restore: revision ${revisionId} is not valid JSON`);
      }

      const failure = validateContent(key, parsed, await this.currentContent(filePath));
      if (failure) {
        throw new AppError(failure.status, `Cannot restore: ${failure.message}`);
      }

      try {
        return await this.store.recordAndApply({
          key,
          targetFile: filePath,
          // The revision's own bytes, not a re-serialisation — the files on disk
          // do not all match JSON.stringify's formatting, and a restore must
          // reproduce what was recorded.
          content: bytes,
          actor: options.actor ?? null,
          note: options.note ?? `restored from ${revisionId}`,
          source: "restore",
        });
      } catch (err) {
        throw new AppError(500, `Restore was not applied: ${(err as Error).message}`);
      }
    });
  }

  /** Detects and adopts revision blobs that are on disk but not in the log. */
  async reconcile(key: string): Promise<ReconcileReport> {
    validateKey(key);
    return this.store.reconcile(key);
  }
}
