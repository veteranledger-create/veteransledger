import path from "path";
import { randomUUID } from "crypto";
import prisma from "../../../database/prisma";
import { storageConfig } from "../../../config/storage";
import { LegacyArticle, NormalizedBodyBlock, normalizeBodyBlocks, toCandidateRecord, toRecordCreateInput } from "./article-record-mapper";
import { runArticlesImportDryRun } from "./articles-import-check";
import { loadArticlesArchive, LoadedArticlesArchive, LoadedArticle } from "./articles-archive-loader";
import { articleArchiveManifestProvider } from "./articles-archive-manifest-provider";
import { validateArticleArchiveIntegrity, ArticleArchiveIntegrityReport } from "./articles-archive-integrity";
import { toArticleJson, ArticleJson } from "../generators/articles.generator";
import { writeStagedFilesAtomically } from "../atomic-stage-writer";
import { rollbackImportRunWithCollections } from "./rollback";

export type ImportMode = "insert-only" | "sync";

export interface PreImportSnapshot {
  recordCount: number;
  collectionCount: number;
  existingArticleSlugs: string[];
}

export interface ImportPreview {
  generatedAt: string;
  mode: ImportMode;
  recordsToCreate: string[];
  recordsToUpdate: string[];
  collectionsToCreate: string[];
  collectionsExisting: string[];
  /**
   * Absent (not a fake passing report) when execution was disabled before
   * the archive was ever loaded — distinct from a check that actually ran.
   * Always present when buildImportPreview() runs for real, including
   * every preview-only call (previewArticles() in restore-from-archive.ts).
   */
  archiveIntegrity?: ArticleArchiveIntegrityReport;
}

export interface StructuralDiff {
  recordId: string;
  field: string;
  sourceValue: unknown;
  generatedValue: unknown;
  classification: "expected" | "unexpected";
}

export interface ImportResult {
  runId: string;
  executedAt: string;
  mode: ImportMode;
  preImportSnapshot: PreImportSnapshot;
  preview: ImportPreview;
  recordsCreated: { id: string; slug: string; category: string }[];
  collectionsCreated: { slug: string; id: string }[];
  recordsSkipped: string[];
  verification: {
    recordsCompared: number;
    expectedDifferences: StructuralDiff[];
    unexpectedDifferences: StructuralDiff[];
  };
  status: "success" | "failed" | "verification_failed" | "execution_disabled" | "archive_integrity_failed";
  error?: string;
}

// ── Articles execution gate ───────────────────────────────────────────
// Independent from Letters' gate in letters-importer.ts — enabling one
// must never risk enabling the other. Same two-factor design: this flag
// AND the caller's literal-typed confirmExecution must both agree.
//
// History: briefly set to true twice — once for the Military-category
// pilot (3 records, runId 5debb61f-b4bf-4568-96d7-85e53c34f807), once for
// Phase 2D's remaining 5 records across 3 collections (runId
// 64fde3ef-5e37-489b-bc87-34a60c59a0e4) — each time reset to false
// immediately after the run completed.
const EXECUTION_ENABLED = false;

export interface RunImportOptions {
  mode: ImportMode;
  confirmExecution: true;
  categories?: string[];
  maxRecords?: number;
}

// ── Read-only: safe to call for real right now ──────────────────────────

export async function takePreImportSnapshot(): Promise<PreImportSnapshot> {
  const recordCount = await prisma.record.count();
  const collectionCount = await prisma.collection.count();
  const existing = await prisma.record.findMany({ where: { type: "ARTICLE" }, select: { slug: true } });
  return {
    recordCount,
    collectionCount,
    existingArticleSlugs: existing.map((r) => r.slug).filter((s): s is string => !!s),
  };
}

// ── Consolidated archive loading ─────────────────────────────────────────
// buildImportPreview() and runArticlesImport() both accept (or produce) an
// optional preloaded archive so a caller driving both from one run (as
// runArticlesImport() does below) reads the 8 declared article files from
// disk exactly once, no matter how many of these functions run as part of
// it. Neither function caches anything itself — each call that doesn't
// receive a preload loads its own fresh copy via loadArticlesArchive(),
// which never caches beyond a single call either. This is deliberately
// request-scoped, not a new global cache.

function groupByCategory(items: LoadedArticle[]): { category: string; articles: LegacyArticle[] }[] {
  const map = new Map<string, LegacyArticle[]>();
  for (const { category, article } of items) {
    const list = map.get(category) ?? [];
    list.push(article);
    map.set(category, list);
  }
  return [...map.entries()].map(([category, articles]) => ({ category, articles }));
}

export async function buildImportPreview(mode: ImportMode, snapshot: PreImportSnapshot, preloaded?: LoadedArticlesArchive): Promise<ImportPreview> {
  const archive = preloaded ?? await loadArticlesArchive();
  const archiveIntegrity = await validateArticleArchiveIntegrity(archive);

  const existingSet = new Set(snapshot.existingArticleSlugs);
  const recordsToCreate: string[] = [];
  const recordsToUpdate: string[] = [];
  for (const { article } of archive.declaredItems) {
    (existingSet.has(article.id) ? recordsToUpdate : recordsToCreate).push(article.id);
  }

  const collectionSlugs = Object.keys(articleArchiveManifestProvider.getArticleFiles()).map((c) => `articles-${c}`);
  const existingCollections = await prisma.collection.findMany({
    where: { slug: { in: collectionSlugs } },
    select: { slug: true },
  });
  const existingCollectionSlugs = new Set(existingCollections.map((c) => c.slug));

  return {
    generatedAt: new Date().toISOString(),
    mode,
    recordsToCreate,
    recordsToUpdate,
    collectionsToCreate: collectionSlugs.filter((s) => !existingCollectionSlugs.has(s)),
    collectionsExisting: [...existingCollectionSlugs],
    archiveIntegrity,
  };
}

// ── In-memory round-trip verification — pure functions, no fs/Prisma ────
// Most fields here are direct pass-through (Articles doesn't have Letters'
// legacy-field-rename problem), so this is simpler than Letters' comparator
// in that respect — but it needs two capabilities Letters never did:
// structural array comparison for `body[]`, and a completeness check that
// every pass-through extension field survived the round trip.
const SCALAR_FIELDS: string[] = ["title", "subtitle", "author", "summary", "archival_note"];

export function compareRoundTrip(article: LegacyArticle, generated: ArticleJson): StructuralDiff[] {
  const diffs: StructuralDiff[] = [];

  for (const field of SCALAR_FIELDS) {
    const expected = (article[field] as string | undefined) ?? undefined;
    const actual = (generated[field] as string | undefined) ?? undefined;
    if (JSON.stringify(expected) !== JSON.stringify(actual)) {
      diffs.push({ recordId: article.id, field, sourceValue: expected, generatedValue: actual, classification: "unexpected" });
    }
  }

  // Structural body comparison — normalize the source the same way the
  // importer did, then compare block-by-block.
  const expectedBody: NormalizedBodyBlock[] = normalizeBodyBlocks(article.body);
  const actualBody = generated.body ?? [];
  if (JSON.stringify(expectedBody) !== JSON.stringify(actualBody)) {
    const bodyChangedOnlyByNormalization =
      expectedBody.length === actualBody.length &&
      expectedBody.every((b, i) => b.text === actualBody[i]?.text);
    diffs.push({
      recordId: article.id, field: "body",
      sourceValue: article.body, generatedValue: actualBody,
      // A pure type-label change (heading<-subheading, text<-content) is
      // the deliberate normalization from the approved strategy; anything
      // that changes the actual text content is a real bug.
      classification: bodyChangedOnlyByNormalization ? "expected" : "unexpected",
    });
  }

  // images derived from image — expected, same pattern as Letters' derived
  // collection/excerpt.
  if (article.image && generated.images?.length) {
    diffs.push({ recordId: article.id, field: "images", sourceValue: undefined, generatedValue: generated.images, classification: "expected" });
  }

  // recordId — always regenerated fresh from the live database id at
  // publish time, never a stable pass-through value (recovery preserves
  // the original id on create when present, but the candidate used here
  // for verification always carries the slug as its id, so
  // generated.recordId is always the slug) — a difference from the
  // source recordId is structurally expected, same as related_records.
  if (article.recordId !== undefined) {
    diffs.push({ recordId: article.id, field: "recordId", sourceValue: article.recordId, generatedValue: generated.recordId, classification: "expected" });
  }

  // Pass-through extras completeness — every extension field in the source
  // must survive, unchanged, in the generated output.
  const explicitKeys = new Set(["id", "recordId", "category", "title", "subtitle", "date_published", "author", "image", "tags", "summary", "body", "archival_note", "sources", "related_records"]);
  for (const [key, value] of Object.entries(article)) {
    if (explicitKeys.has(key)) continue;
    const actual = generated[key];
    if (JSON.stringify(value) !== JSON.stringify(actual)) {
      diffs.push({ recordId: article.id, field: key, sourceValue: value, generatedValue: actual, classification: "unexpected" });
    }
  }

  return diffs;
}

export async function rollbackImportRun(runId: string): Promise<{ deletedRecords: number; deletedCollections: number }> {
  return rollbackImportRunWithCollections("ARTICLE", runId, "articles");
}

async function writeImportResult(result: ImportResult): Promise<void> {
  const outDir = path.join(storageConfig.directories.importReports, "articles", "results", result.runId);
  const files = new Map([["import-result.json", JSON.stringify(result, null, 2)]]);
  await writeStagedFilesAtomically(outDir, files);
}

// ── The transactional importer itself ──────────────────────────────────
export async function runArticlesImport(options: RunImportOptions): Promise<ImportResult> {
  const runId = randomUUID();
  const executedAt = new Date().toISOString();

  // Gate 1+2: EXECUTION_ENABLED + confirmExecution — checked first, before
  // any other work including the archive load itself, so the disabled
  // path performs zero filesystem or database access of any kind.
  // Deliberately not reordered to load first (unlike Campaigns) — there is
  // no real archive scan to make the disabled placeholder "honest" about
  // here, and doing one anyway would be a load introduced solely for a
  // state that never uses it.
  if (!EXECUTION_ENABLED || options.confirmExecution !== true) {
    return {
      runId,
      executedAt,
      mode: options.mode,
      preImportSnapshot: { recordCount: -1, collectionCount: -1, existingArticleSlugs: [] },
      preview: { generatedAt: executedAt, mode: options.mode, recordsToCreate: [], recordsToUpdate: [], collectionsToCreate: [], collectionsExisting: [] },
      recordsCreated: [],
      collectionsCreated: [],
      recordsSkipped: [],
      verification: { recordsCompared: 0, expectedDifferences: [], unexpectedDifferences: [] },
      status: "execution_disabled",
      error: "Articles import execution is disabled (EXECUTION_ENABLED=false). No database access of any kind was attempted.",
    };
  }

  // Loaded exactly once for the whole run — every gate below, the preview,
  // and the transaction's actual record data all come from this same
  // in-memory archive, never a fresh read per step.
  const archive = await loadArticlesArchive();

  // Gate 3: archive integrity — runs before anything else that depends on
  // this archive's content, including the conformance dry-run below. No
  // bypass flag exists.
  const archiveIntegrity = await validateArticleArchiveIntegrity(archive);
  if (!archiveIntegrity.passed) {
    const result: ImportResult = {
      runId,
      executedAt,
      mode: options.mode,
      preImportSnapshot: { recordCount: -1, collectionCount: -1, existingArticleSlugs: [] },
      preview: { generatedAt: executedAt, mode: options.mode, recordsToCreate: [], recordsToUpdate: [], collectionsToCreate: [], collectionsExisting: [], archiveIntegrity },
      recordsCreated: [],
      collectionsCreated: [],
      recordsSkipped: [],
      verification: { recordsCompared: 0, expectedDifferences: [], unexpectedDifferences: [] },
      status: "archive_integrity_failed",
      error: `Archive integrity check failed with ${archiveIntegrity.violations.length} violation(s) — aborting before any write: ${archiveIntegrity.violations.map((v) => v.message).join(" | ")}`,
    };
    await writeImportResult(result);
    throw new Error(result.error);
  }

  // Gate 4: blockedByErrors — no bypass flags, force modes, or ignore
  // lists exist anywhere in this function.
  const dryRun = await runArticlesImportDryRun(archive);
  if (dryRun.blockedByErrors > 0) {
    throw new Error(`Pre-flight check failed: ${dryRun.blockedByErrors} record(s) have blocking errors — aborting before any write.`);
  }

  const snapshot = await takePreImportSnapshot();
  const preview = await buildImportPreview(options.mode, snapshot, archive);
  const allGroups = groupByCategory(archive.declaredItems);
  const groups = options.categories ? allGroups.filter((g) => options.categories!.includes(g.category)) : allGroups;

  if (options.categories) {
    const unknown = options.categories.filter((c) => !(c in articleArchiveManifestProvider.getArticleFiles()));
    if (unknown.length) throw new Error(`Unknown category(ies) requested: ${unknown.join(", ")}`);
  }

  const scopedRecordCount = groups.reduce((sum, g) => sum + g.articles.length, 0);
  if (options.maxRecords !== undefined && scopedRecordCount > options.maxRecords) {
    throw new Error(
      `Requested scope contains ${scopedRecordCount} record(s), exceeding maxRecords=${options.maxRecords} — aborting before any write rather than silently dropping records.`,
    );
  }
  const existingSet = new Set(snapshot.existingArticleSlugs);

  const recordsCreated: ImportResult["recordsCreated"] = [];
  const collectionsCreated: ImportResult["collectionsCreated"] = [];
  const recordsSkipped: string[] = [];
  const expectedDifferences: StructuralDiff[] = [];
  const unexpectedDifferences: StructuralDiff[] = [];
  let recordsCompared = 0;

  let status: ImportResult["status"] = "success";
  let errorMessage: string | undefined;

  try {
    await prisma.$transaction(async (tx) => {
      for (const { category, articles } of groups) {
        const collectionRow = await tx.collection.upsert({
          where: { slug: `articles-${category}` },
          update: {},
          create: {
            slug: `articles-${category}`,
            title: `${category[0].toUpperCase()}${category.slice(1)} Articles`,
            category: "articles",
            // Tagged only on create, never on update — a pre-existing
            // Collection from an earlier run keeps its original tag (or
            // none), so a later run's rollback can never claim it.
            metadata: { importRunId: runId },
          },
        });
        if (preview.collectionsToCreate.includes(`articles-${category}`)) {
          collectionsCreated.push({ slug: collectionRow.slug, id: collectionRow.id });
        }

        for (const article of articles) {
          const alreadyExists = existingSet.has(article.id);
          if (alreadyExists && options.mode === "insert-only") {
            recordsSkipped.push(article.id);
            continue;
          }

          const input = toRecordCreateInput(article, category, collectionRow.id);
          (input.metadata as Record<string, unknown>).importRunId = runId;

          const row = await tx.record.upsert({
            where: { slug: article.id },
            update: options.mode === "sync" ? (input as never) : {},
            create: input as never,
          });
          if (!alreadyExists) recordsCreated.push({ id: row.id, slug: article.id, category });

          const candidate = toCandidateRecord(article, category);
          const generated = toArticleJson(candidate);
          recordsCompared++;
          for (const diff of compareRoundTrip(article, generated)) {
            (diff.classification === "expected" ? expectedDifferences : unexpectedDifferences).push(diff);
          }
        }
      }

      if (unexpectedDifferences.length > 0) {
        throw new Error(`Round-trip verification found ${unexpectedDifferences.length} unexpected difference(s) — rolling back, zero changes committed.`);
      }
    });
  } catch (err) {
    status = unexpectedDifferences.length > 0 ? "verification_failed" : "failed";
    errorMessage = (err as Error).message;
  }

  const result: ImportResult = {
    runId,
    executedAt,
    mode: options.mode,
    preImportSnapshot: snapshot,
    preview,
    recordsCreated: status === "success" ? recordsCreated : [],
    collectionsCreated: status === "success" ? collectionsCreated : [],
    recordsSkipped: status === "success" ? recordsSkipped : [],
    verification: { recordsCompared, expectedDifferences, unexpectedDifferences },
    status,
    ...(errorMessage ? { error: errorMessage } : {}),
  };

  await writeImportResult(result);
  if (status !== "success") throw new Error(errorMessage);
  return result;
}
