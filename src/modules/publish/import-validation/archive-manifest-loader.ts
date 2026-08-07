import fs from "fs";
import path from "path";

// Generic framework — knows nothing about campaigns, armaments, or any
// other archive type. A loader's only job, for any TManifest shape, is:
// locate the manifest file, read it, parse it, return it. Never cache,
// never throw.

export interface ArchiveManifestLoadResult<TManifest> {
  manifest: TManifest;
  loadError?: string;
}

export interface ArchiveManifestLoader<TManifest> {
  getArchiveDirectory(): string;
  getManifestPath(): string;
  load(): ArchiveManifestLoadResult<TManifest>;
}

/**
 * Reusable base implementation of the read-parse-validate-never-throw
 * cycle every archive type needs identically. A concrete archive type
 * (Campaigns, and later Armaments/Articles/Letters/Formations/Personnel)
 * extends this and supplies exactly three archive-specific things:
 *   - where the manifest lives (constructor args),
 *   - what an empty/fallback manifest looks like,
 *   - how to recognize a validly-shaped parsed manifest.
 * Everything else — the actual fs.readFileSync, JSON.parse, and the three
 * failure modes (missing file / invalid JSON / wrong shape) — lives here
 * once, not copy-pasted per archive type.
 */
export abstract class BaseArchiveManifestLoader<TManifest> implements ArchiveManifestLoader<TManifest> {
  private readonly archiveDirectory: string;
  private readonly manifestFilename: string;
  private readonly manifestPath: string;

  constructor(archiveDirectory: string, manifestFilename: string) {
    this.archiveDirectory = archiveDirectory;
    this.manifestFilename = manifestFilename;
    this.manifestPath = path.join(archiveDirectory, manifestFilename);
  }

  /** The empty/fallback manifest to return when loading fails for any reason. */
  protected abstract getEmptyManifest(): TManifest;

  /** Archive-specific shape check on the parsed JSON — e.g. "has active[] and obsolete[]". */
  protected abstract isValidManifestShape(parsed: unknown): parsed is TManifest;

  getArchiveDirectory(): string {
    return this.archiveDirectory;
  }

  getManifestPath(): string {
    return this.manifestPath;
  }

  /**
   * Reads and parses the manifest fresh, every call — no memoization here
   * or anywhere in this class. Deliberately never throws: loaders in this
   * framework are transitively reachable from the live server's boot path
   * (via each archive type's generator), so a missing or malformed
   * manifest must degrade to an empty result rather than take down server
   * startup. The caller (a provider, ultimately an integrity validator) is
   * responsible for surfacing loadError as a real, reportable problem.
   */
  load(): ArchiveManifestLoadResult<TManifest> {
    let raw: string;
    try {
      raw = fs.readFileSync(this.manifestPath, "utf-8");
    } catch (err) {
      return {
        manifest: this.getEmptyManifest(),
        loadError: `${this.manifestFilename} could not be read at ${this.manifestPath}: ${(err as Error).message}`,
      };
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch (err) {
      return {
        manifest: this.getEmptyManifest(),
        loadError: `${this.manifestFilename} at ${this.manifestPath} is not valid JSON: ${(err as Error).message}`,
      };
    }

    if (!this.isValidManifestShape(parsed)) {
      return {
        manifest: this.getEmptyManifest(),
        loadError: `${this.manifestFilename} at ${this.manifestPath} is malformed.`,
      };
    }

    return { manifest: parsed };
  }
}
