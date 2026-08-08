import { BaseArchiveManifestProvider } from "./archive-manifest-provider";
import {
  ArticleArchiveManifestLoader, ArticleArchiveManifest, ArticleArchiveManifestObsoleteEntry,
} from "./articles-archive-manifest-loader";

export { ArticleArchiveManifest, ArticleArchiveManifestObsoleteEntry };

// Articles' implementation of the generic archive-caching framework
// (archive-manifest-provider.ts). All caching mechanics — lazy load,
// memoize, invalidate — are inherited from BaseArchiveManifestProvider;
// this class adds only what's articles-specific: getArticleFiles(), the
// derived active-sources-by-category view, and its own extra cache slot
// for that derived value (cleared alongside the base cache on
// invalidate()).
//
// Categories are whatever the manifest's path segment says — military,
// political, legal, economy, or any future category — never validated
// against a closed enum here or anywhere in this file. The manifest
// remains the sole source of truth for archive membership; a category
// with zero active entries (economy, today) simply never produces a key.

function groupActiveByCategory(manifest: ArticleArchiveManifest): Record<string, string[]> {
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

export class ArticleArchiveManifestProvider extends BaseArchiveManifestProvider<ArticleArchiveManifest> {
  private articleFiles?: Record<string, string[]>;

  constructor(loader: ArticleArchiveManifestLoader = new ArticleArchiveManifestLoader()) {
    super(loader);
  }

  /**
   * Declared active sources grouped by category — Record<category,
   * filename[]>, the same shape ARTICLE_FILES has always had. Derived from
   * getManifest().active, not manually maintained; cached alongside it.
   */
  getArticleFiles(): Record<string, string[]> {
    if (!this.articleFiles) {
      this.articleFiles = groupActiveByCategory(this.getManifest());
    }
    return this.articleFiles;
  }

  /** Same as getArchiveDirectory() — kept under its articles-flavored name for consistency with Campaigns'/Armaments' providers. */
  getArticlesDirectory(): string {
    return this.getArchiveDirectory();
  }

  invalidate(): void {
    super.invalidate();
    this.articleFiles = undefined;
  }
}

// The single shared instance every future consumer imports. Its private
// cache is what makes "every consumer receives the same instance" actually
// true — not by convention, but because there is exactly one of these per
// process (Node's module cache guarantees this module body runs once).
export const articleArchiveManifestProvider = new ArticleArchiveManifestProvider();
