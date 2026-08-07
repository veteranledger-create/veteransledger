import { BaseArchiveManifestProvider } from "./archive-manifest-provider";
import {
  CampaignArchiveManifestLoader, CampaignArchiveManifest, CampaignArchiveManifestObsoleteEntry,
} from "./campaigns-archive-manifest-loader";

export { CampaignArchiveManifest, CampaignArchiveManifestObsoleteEntry };

// Campaigns' implementation of the generic archive-caching framework
// (archive-manifest-provider.ts). All caching mechanics — lazy load,
// memoize, invalidate — are inherited from BaseArchiveManifestProvider;
// this class adds only what's campaign-specific: getCampaignFiles(), the
// derived active-sources-by-theater view, and its own extra cache slot for
// that derived value (cleared alongside the base cache on invalidate()).
//
// The importer, the integrity validator, the preview builder, and any
// future tooling depend on this provider exclusively — none of them touch
// the loader, or the filesystem, directly.

function groupActiveByTheater(manifest: CampaignArchiveManifest): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  for (const relPath of manifest.active) {
    const slashIdx = relPath.indexOf("/");
    if (slashIdx === -1) continue;
    const theater = relPath.slice(0, slashIdx);
    const filename = relPath.slice(slashIdx + 1);
    (out[theater] ??= []).push(filename);
  }
  return out;
}

export class CampaignArchiveManifestProvider extends BaseArchiveManifestProvider<CampaignArchiveManifest> {
  private campaignFiles?: Record<string, string[]>;

  constructor(loader: CampaignArchiveManifestLoader = new CampaignArchiveManifestLoader()) {
    super(loader);
  }

  /**
   * Declared active sources grouped by theater — Record<theater, filename[]>,
   * the same shape CAMPAIGN_FILES has always had. Derived from
   * getManifest().active, not manually maintained; cached alongside it.
   */
  getCampaignFiles(): Record<string, string[]> {
    if (!this.campaignFiles) {
      this.campaignFiles = groupActiveByTheater(this.getManifest());
    }
    return this.campaignFiles;
  }

  /** Same as getArchiveDirectory() — kept under its campaign-flavored name for existing callers. */
  getCampaignDirectory(): string {
    return this.getArchiveDirectory();
  }

  invalidate(): void {
    super.invalidate();
    this.campaignFiles = undefined;
  }
}

// The single shared instance every consumer imports. Its private cache is
// what makes "every consumer receives the same instance" actually true —
// not by convention, but because there is exactly one of these per process
// (Node's module cache guarantees this module body runs once).
export const campaignArchiveManifestProvider = new CampaignArchiveManifestProvider();
