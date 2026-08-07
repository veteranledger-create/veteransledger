import { ArchiveManifestLoader } from "./archive-manifest-loader";

// Generic framework — a cache layer over an ArchiveManifestLoader<TManifest>,
// with no knowledge of what TManifest actually contains. Every archive
// type's provider (Campaigns, and later Armaments/Articles/Letters/
// Formations/Personnel) extends this and adds only its own domain-specific
// derived getters (e.g. CampaignArchiveManifestProvider.getCampaignFiles()).
// The caching mechanics — lazy load, memoize, invalidate — live here once.

export interface ArchiveManifestProvider<TManifest> {
  getManifest(): TManifest;
  getLoadError(): string | undefined;
  getArchiveDirectory(): string;
  getManifestPath(): string;
  invalidate(): void;
}

export class BaseArchiveManifestProvider<TManifest> implements ArchiveManifestProvider<TManifest> {
  protected readonly loader: ArchiveManifestLoader<TManifest>;
  private manifest?: TManifest;
  private loadError?: string;
  private loaded = false;

  constructor(loader: ArchiveManifestLoader<TManifest>) {
    this.loader = loader;
  }

  protected ensureLoaded(): void {
    if (this.loaded) return;
    this.loaded = true;
    const result = this.loader.load();
    this.manifest = result.manifest;
    this.loadError = result.loadError;
  }

  /** The parsed manifest — loaded and cached on first call, never re-loaded. */
  getManifest(): TManifest {
    this.ensureLoaded();
    return this.manifest!;
  }

  /** Set only when the manifest failed to load/parse; undefined otherwise. */
  getLoadError(): string | undefined {
    this.ensureLoaded();
    return this.loadError;
  }

  /** Delegates to the loader — pure path computation, not cached (no I/O to save). */
  getArchiveDirectory(): string {
    return this.loader.getArchiveDirectory();
  }

  /** Delegates to the loader — pure path computation, not cached (no I/O to save). */
  getManifestPath(): string {
    return this.loader.getManifestPath();
  }

  /**
   * Clears the cache so the next getter call triggers a fresh
   * loader.load(). A cache-policy operation, implemented entirely here —
   * the loader has no concept of invalidation and needs no change to
   * support it. Subclasses that cache additional derived values (like
   * CampaignArchiveManifestProvider's getCampaignFiles()) should override
   * this, call super.invalidate(), and clear their own derived cache too.
   */
  invalidate(): void {
    this.loaded = false;
    this.manifest = undefined;
    this.loadError = undefined;
  }
}
