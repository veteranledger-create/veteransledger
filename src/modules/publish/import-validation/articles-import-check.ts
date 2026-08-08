import path from "path";
import { checkArticleRecord } from "../validators/articles.conformance";
import { ValidationIssue } from "../publish.types";
import { toCandidateRecord } from "./article-record-mapper";
import { loadArticlesArchive, LoadedArticlesArchive } from "./articles-archive-loader";
import { targetExists } from "./cross-reference-lookup";

// Never imports Prisma, never writes inside public/data/ — only reads the
// real articles/*.json files (plus other content types, read-only, for
// related_records existence checks) and returns a report. Same structural
// guarantee as letters-import-check.ts.
const PUBLIC_DATA_DIR = path.resolve(__dirname, "../../../../public/data");

export interface ImportIssue extends ValidationIssue {
  category: string;
}

export interface CategoryMismatch {
  recordId: string;
  declaredCategory: string;
  fileCategory: string;
}

export interface MissingRelatedTarget {
  recordId: string;
  relatedId: string;
  relatedType: string;
}

export interface ArticleImportSummary {
  generatedAt: string;
  mode: "dry-run";
  totalRecords: number;
  byCategory: Record<string, number>;
  duplicateIds: string[];
  categoryMismatches: CategoryMismatch[];
  missingRelatedTargets: MissingRelatedTarget[];
  validation: {
    errorCount: number;
    warningCount: number;
    issuesByField: Record<string, number>;
    issues: ImportIssue[];
  };
  readyToImport: number;
  blockedByErrors: number;
}

// loadAllSourceArticles()-style direct reads (hardcoded ARTICLE_FILES grid)
// have been superseded by articles-archive-loader.ts's
// loadArticlesArchive(), which reads the Phase A manifest's declared files
// instead. This function accepts an optional preloaded archive so a caller
// driving both this and other stages from one operation (as
// runArticlesImport() does) reads the archive exactly once, no matter how
// many of these functions run as part of it. Each call that doesn't
// receive a preload loads its own fresh copy, which never caches beyond a
// single call either — deliberately request-scoped, not a new global cache.
export async function runArticlesImportDryRun(preloaded?: LoadedArticlesArchive): Promise<ArticleImportSummary> {
  const archive = preloaded ?? await loadArticlesArchive();
  const seenIds = new Map<string, string[]>();
  const byCategory: Record<string, number> = {};
  const categoryMismatches: CategoryMismatch[] = [];
  const missingRelatedTargets: MissingRelatedTarget[] = [];
  const allIssues: ImportIssue[] = [];
  let total = 0;

  for (const { category, article } of archive.declaredItems) {
    byCategory[category] = (byCategory[category] ?? 0) + 1;
    total++;

    const occurrences = seenIds.get(article.id) ?? [];
    occurrences.push(category);
    seenIds.set(article.id, occurrences);

    if (article.category && article.category !== category) {
      categoryMismatches.push({ recordId: article.id, declaredCategory: article.category, fileCategory: category });
    }

    const candidate = toCandidateRecord(article, category);
    for (const issue of checkArticleRecord(candidate)) {
      allIssues.push({ ...issue, category });
    }

    const related = Array.isArray(article.related_records) ? (article.related_records as Array<{ id?: unknown; type?: unknown }>) : [];
    for (const entry of related) {
      if (typeof entry?.id !== "string") continue;
      const relatedType = typeof entry.type === "string" ? entry.type : undefined;
      const exists = await targetExists(relatedType, entry.id, PUBLIC_DATA_DIR);
      if (!exists) {
        missingRelatedTargets.push({ recordId: article.id, relatedId: entry.id, relatedType: relatedType ?? "unknown" });
      }
    }
  }

  const duplicateIds = [...seenIds.entries()]
    .filter(([, categories]) => categories.length > 1)
    .map(([id]) => id);

  const issuesByField: Record<string, number> = {};
  let errorCount = 0;
  let warningCount = 0;
  for (const issue of allIssues) {
    issuesByField[issue.field] = (issuesByField[issue.field] ?? 0) + 1;
    if (issue.severity === "error") errorCount++;
    else warningCount++;
  }

  const recordsWithErrors = new Set(allIssues.filter((i) => i.severity === "error").map((i) => i.recordId));

  return {
    generatedAt: new Date().toISOString(),
    mode: "dry-run",
    totalRecords: total,
    byCategory,
    duplicateIds,
    categoryMismatches,
    missingRelatedTargets,
    validation: { errorCount, warningCount, issuesByField, issues: allIssues },
    readyToImport: total - recordsWithErrors.size,
    blockedByErrors: recordsWithErrors.size,
  };
}
