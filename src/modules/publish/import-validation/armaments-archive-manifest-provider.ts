import { BaseArchiveManifestProvider } from "./archive-manifest-provider";
import {
  ArmamentArchiveManifestLoader, ArmamentArchiveManifest, ArmamentArchiveManifestObsoleteEntry,
} from "./armaments-archive-manifest-loader";

export { ArmamentArchiveManifest, ArmamentArchiveManifestObsoleteEntry };

// Armaments' implementation of the generic archive-caching framework
// (archive-manifest-provider.ts). All caching mechanics — lazy load,
// memoize, invalidate — are inherited from BaseArchiveManifestProvider;
// this class adds only what's armaments-specific: getArmamentFiles(), the
// derived active-sources-by-category view, and its own extra cache slot
// for that derived value (cleared alongside the base cache on
// invalidate()).
//
// fileNation labels are whatever the manifest's path segment says —
// "germany", "hungary-romania-bulgaria",
// "czechoslovakia-germany-captured", anything — never validated against a
// closed enum here or anywhere in this file. There is deliberately no
// NATIONS-style grid in this framework layer.

function groupActiveByCategory(manifest: ArmamentArchiveManifest): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  for (const relPath of manifest.active) {
    const slashIdx = relPath.indexOf("/");
    if (slashIdx === -1) continue;
    const category = relPath.slice(0, slashIdx);
    const filename = relPath.slice(slashIdx + 1);
    (out[category] ??= []).push(filename);
  }
  return out;
}

export class ArmamentArchiveManifestProvider extends BaseArchiveManifestProvider<ArmamentArchiveManifest> {
  private armamentFiles?: Record<string, string[]>;

  constructor(loader: ArmamentArchiveManifestLoader = new ArmamentArchiveManifestLoader()) {
    super(loader);
  }

  /**
   * Declared active sources grouped by category — Record<category,
   * filename[]>, where each filename is "<fileNation>.json" exactly as it
   * appears in the manifest path. Derived from getManifest().active, not
   * manually maintained; cached alongside it.
   */
  getArmamentFiles(): Record<string, string[]> {
    if (!this.armamentFiles) {
      this.armamentFiles = groupActiveByCategory(this.getManifest());
    }
    return this.armamentFiles;
  }

  /** Same as getArchiveDirectory() — kept under its armaments-flavored name for consistency with Campaigns' provider. */
  getArmamentsDirectory(): string {
    return this.getArchiveDirectory();
  }

  invalidate(): void {
    super.invalidate();
    this.armamentFiles = undefined;
  }
}

// The single shared instance every future consumer imports. Its private
// cache is what makes "every consumer receives the same instance" actually
// true — not by convention, but because there is exactly one of these per
// process (Node's module cache guarantees this module body runs once).
export const armamentArchiveManifestProvider = new ArmamentArchiveManifestProvider();
