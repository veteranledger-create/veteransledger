import path from "path";
import { BaseArchiveManifestLoader } from "./archive-manifest-loader";

// Articles' implementation of the generic archive-loading framework
// (archive-manifest-loader.ts). Everything mechanical — read, parse,
// never-throw fallback — lives in BaseArchiveManifestLoader; this class
// supplies only the three things that are actually specific to the
// articles archive: where it lives, what "empty" looks like, and what
// counts as a validly-shaped articles.archive.json.

export interface ArticleArchiveManifestObsoleteEntry {
  file: string;
  replacedBy: string;
  reason: string;
  date?: string;
  notes?: string;
}

export interface ArticleArchiveManifest {
  active: string[];
  obsolete: ArticleArchiveManifestObsoleteEntry[];
}

const ARTICLES_DIR = path.resolve(__dirname, "../../../../public/data/articles");

export class ArticleArchiveManifestLoader extends BaseArchiveManifestLoader<ArticleArchiveManifest> {
  constructor() {
    super(ARTICLES_DIR, "articles.archive.json");
  }

  protected getEmptyManifest(): ArticleArchiveManifest {
    return { active: [], obsolete: [] };
  }

  protected isValidManifestShape(parsed: unknown): parsed is ArticleArchiveManifest {
    const obj = parsed as Record<string, unknown> | null;
    return !!obj && Array.isArray(obj.active) && Array.isArray(obj.obsolete);
  }
}
