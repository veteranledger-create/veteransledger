import fs from "fs/promises";
import path from "path";
import { LegacyArticle } from "./article-record-mapper";
import { articleArchiveManifestProvider } from "./articles-archive-manifest-provider";

// Articles-specific archive-record loading — deliberately NOT part of the
// generic framework (archive-manifest-loader.ts / archive-manifest-provider.ts).
// The provider remains responsible only for manifest access (getManifest,
// getArticleFiles, getArticlesDirectory); this file is what actually reads
// the individual article JSON files the manifest declares, and it is the
// single place that does so.
//
// Unlike Armaments (one file holds an array of records), Articles is
// one file per record — the same model as Campaigns. There is no
// extractItems()-equivalent step: a declared file's parsed content *is*
// the record, so this loader never inspects raw's internal shape beyond
// the null check below.
//
// loadArticlesArchive() is not wired into runArticlesImport()/
// runArticlesImportDryRun()/buildImportPreview() yet — the existing
// loadAllSourceArticles()/inline read loops remain the production path
// until a later wiring phase. Nothing here is cached beyond a single
// call — the returned object is a plain, disposable snapshot; calling
// this function again always re-reads from disk. This is deliberately
// NOT a global cache.

export interface ArticleArchiveFileEntry {
  category: string;
  relPath: string;
  /** Parsed JSON content of any shape, or undefined if the file could not be read or parsed. */
  raw: unknown;
  /**
   * Only meaningful when raw is undefined. True if the failure happened
   * reading the file itself (permission denied, removed between the
   * readdir listing and the read, other I/O error) — false/absent means
   * the read succeeded but JSON.parse failed. Same distinction Campaigns'
   * and Armaments' loaders make, for the same reason: a future integrity
   * validator must never mislabel one as the other.
   */
  readError?: boolean;
}

/**
 * category + the parsed article content, flattened one entry per record —
 * no named "LoadedArticle" type exists yet in article-record-mapper.ts (that
 * file is off-limits to modify this phase), so this is defined here,
 * matching exactly the {category, article} shape the current pipeline
 * already works with implicitly (loadAllSourceArticles()'s per-item loop),
 * just given a proper name for the first time.
 */
export interface LoadedArticle {
  category: string;
  article: LegacyArticle;
}

export interface LoadedArticlesArchive {
  /**
   * Every .json file physically present in every category folder the
   * manifest declares at least one active file for — declared or not.
   * This single scan is what both "read every declared file" and "find
   * undeclared files" are built from; a file is read from disk exactly
   * once here regardless of how many downstream checks need its content.
   */
  filesOnDisk: ArticleArchiveFileEntry[];
  /**
   * Every declared, successfully-parsed article — flattened, one entry
   * per record. A declared file that is missing, unreadable, or fails to
   * parse simply contributes zero entries here (never thrown) — callers
   * that need to know *why* look it up in filesOnDisk instead. This is
   * not itself an integrity judgment; classifying these states is a
   * future validator's job, not this loader's.
   */
  declaredItems: LoadedArticle[];
}

function lookupRaw(filesOnDisk: ArticleArchiveFileEntry[]): (relPath: string) => unknown {
  const index = new Map<string, unknown>();
  for (const entry of filesOnDisk) index.set(entry.relPath, entry.raw);
  return (relPath) => index.get(relPath);
}

export async function loadArticlesArchive(): Promise<LoadedArticlesArchive> {
  const articlesDir = articleArchiveManifestProvider.getArticlesDirectory();
  const articleFiles = articleArchiveManifestProvider.getArticleFiles();
  const manifest = articleArchiveManifestProvider.getManifest();

  // Scan every category folder that's either declared-active or referenced
  // by an obsolete entry's "file"/"replacedBy" — mirrors Campaigns' and
  // Armaments' loaders exactly. The Phase A manifest's obsolete list is
  // currently empty, so this expansion is a no-op today, but a future
  // obsolete entry never silently stops being scanned because of it.
  const categories = new Set<string>(Object.keys(articleFiles));
  for (const entry of manifest.obsolete) {
    categories.add(entry.file.slice(0, entry.file.indexOf("/")));
    categories.add(entry.replacedBy.slice(0, entry.replacedBy.indexOf("/")));
  }

  const filesOnDisk: ArticleArchiveFileEntry[] = [];

  for (const category of categories) {
    const dir = path.join(articlesDir, category);
    let onDiskFilenames: string[];
    try {
      onDiskFilenames = (await fs.readdir(dir)).filter((f) => f.endsWith(".json"));
    } catch {
      onDiskFilenames = [];
    }

    for (const filename of onDiskFilenames) {
      const relPath = `${category}/${filename}`;
      let raw: unknown;
      let readError = false;
      let content: string | undefined;
      try {
        content = await fs.readFile(path.join(dir, filename), "utf-8");
      } catch {
        readError = true;
      }
      if (content !== undefined) {
        try {
          raw = JSON.parse(content);
        } catch {
          raw = undefined;
        }
      }
      filesOnDisk.push({ category, relPath, raw, ...(readError ? { readError: true } : {}) });
    }
  }

  const findRaw = lookupRaw(filesOnDisk);
  const declaredItems: LoadedArticle[] = [];
  for (const [category, filenames] of Object.entries(articleFiles)) {
    for (const filename of filenames) {
      const relPath = `${category}/${filename}`;
      const raw = findRaw(relPath);
      if (raw === undefined) continue;
      // A declared file containing the literal JSON value `null` parses
      // successfully (raw !== undefined — not "missing" or "malformed"),
      // but every downstream consumer (the dry-run loop, conformance)
      // immediately reads article.id/article.title, which throws on null
      // before ever reaching a check. Coerced to {} — the same minimal
      // strategy Campaigns uses (one-record-per-file model: an empty
      // object is the correct "nothing here" stand-in for a single
      // record, unlike Armaments' [] choice for its per-file-container
      // model). Not a new abstraction — the same pattern, applied here.
      declaredItems.push({ category, article: (raw === null ? {} : raw) as unknown as LegacyArticle });
    }
  }

  return { filesOnDisk, declaredItems };
}
