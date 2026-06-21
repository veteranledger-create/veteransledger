import fs from "fs/promises";
import path from "path";
import { randomUUID } from "crypto";
import prisma from "../../../database/prisma";
import { storageConfig } from "../../../config/storage";
import { COLLECTION_FILES, LegacyLetter, pick, toCandidateRecord, toRecordCreateInput } from "./letter-record-mapper";
import { runLettersImportDryRun } from "./letters-import-check";
import { toLetterJson, LetterJson } from "../generators/letters.generator";
import { writeStagedFilesAtomically } from "../atomic-stage-writer";
import { rollbackImportRun as sharedRollbackImportRun } from "./rollback";

const LETTERS_DIR = path.resolve(__dirname, "../../../../public/data/letters");

export type ImportMode = "insert-only" | "sync";

export interface PreImportSnapshot {
  recordCount: number;
  collectionCount: number;
  existingLetterSlugs: string[];
}

export interface ImportPreview {
  generatedAt: string;
  mode: ImportMode;
  recordsToCreate: string[];
  recordsToUpdate: string[];
  collectionsToCreate: string[];
  collectionsExisting: string[];
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
  recordsCreated: { id: string; slug: string; collection: string }[];
  collectionsCreated: { slug: string; id: string }[];
  recordsSkipped: string[];
  verification: {
    recordsCompared: number;
    expectedDifferences: StructuralDiff[];
    unexpectedDifferences: StructuralDiff[];
  };
  status: "success" | "failed" | "verification_failed" | "execution_disabled";
  error?: string;
}

// ── Phase 1C execution gate ──────────────────────────────────────────────
// Two independent things must agree before a single write happens: this
// module-level flag, AND the caller explicitly passing confirmExecution:
// true (a literal-typed field, so TypeScript itself refuses to compile a
// call that omits it). Either one being "off" is enough to keep this 100%
// inert.
//
// History: briefly set to true twice — once for the German-collection
// pilot (4 records, runId 7804f36a-8a80-4830-aa57-6c58e352f142), once for
// Phase 1D's remaining 20 records across 5 collections (runId
// a0d24161-72a6-4cba-b891-5bdfdd0a84a2) — each time reset to false
// immediately after the run completed.
const EXECUTION_ENABLED = false;

export interface RunImportOptions {
  mode: ImportMode;
  confirmExecution: true;
  // Scoping for controlled/pilot runs. Both default to "everything" when
  // omitted. maxRecords is enforced as a hard fail-closed cap, not a
  // silent truncation — if the requested scope contains more records than
  // the cap allows, the import refuses to start rather than guessing which
  // ones to drop (a dropped record could be the target of another
  // record's related_records entry, which would be a confusing partial
  // state to leave behind).
  collections?: string[];
  maxRecords?: number;
}

// ── Read-only: safe to call for real right now ──────────────────────────

export async function takePreImportSnapshot(): Promise<PreImportSnapshot> {
  const recordCount = await prisma.record.count();
  const collectionCount = await prisma.collection.count();
  const existing = await prisma.record.findMany({ where: { type: "LETTER" }, select: { slug: true } });
  return {
    recordCount,
    collectionCount,
    existingLetterSlugs: existing.map((r) => r.slug).filter((s): s is string => !!s),
  };
}

async function loadAllSourceLetters(): Promise<{ collection: string; letters: LegacyLetter[] }[]> {
  const out: { collection: string; letters: LegacyLetter[] }[] = [];
  for (const [collection, filename] of Object.entries(COLLECTION_FILES)) {
    const letters: LegacyLetter[] = JSON.parse(await fs.readFile(path.join(LETTERS_DIR, filename), "utf-8"));
    out.push({ collection, letters });
  }
  return out;
}

export async function buildImportPreview(mode: ImportMode, snapshot: PreImportSnapshot): Promise<ImportPreview> {
  const groups = await loadAllSourceLetters();
  const existingSet = new Set(snapshot.existingLetterSlugs);
  const recordsToCreate: string[] = [];
  const recordsToUpdate: string[] = [];
  for (const { letters } of groups) {
    for (const letter of letters) {
      (existingSet.has(letter.id) ? recordsToUpdate : recordsToCreate).push(letter.id);
    }
  }

  const collectionSlugs = Object.keys(COLLECTION_FILES).map((c) => `letters-${c}`);
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
  };
}

// ── In-memory round-trip verification — pure functions, no fs/Prisma ────
// For each canonical output field, re-derives the *expected* value from
// the source record using the exact same fallback chain the generator
// itself uses, then compares it against what the generator actually
// produced. A naive key-by-key diff would flag every legacy-shaped record
// as wholly different (author vs from, body vs full_text, etc.) — this
// re-derivation is what makes the comparison meaningful instead.
const COMPARABLE_FIELDS: (keyof LetterJson)[] = [
  "from", "from_unit", "to", "location_written", "subject", "context",
  "full_text", "original_text", "notes", "archive_source", "nation",
  "language", "translated", "date", "sources",
];

function deriveExpectedField(letter: LegacyLetter, field: keyof LetterJson): unknown {
  switch (field) {
    case "from": return pick(letter.from, letter.author);
    case "from_unit": return pick(letter.from_unit, letter.unit);
    case "to": return pick(letter.to, letter.recipient);
    case "location_written": return pick(letter.location_written, letter.location);
    case "context": return pick(letter.context, letter.historical_context);
    case "full_text": return pick(letter.full_text, letter.body, letter.translation);
    case "original_text": return pick(letter.original_text, letter.original);
    case "notes": return pick(letter.notes, letter.archival_note);
    case "archive_source": return pick(letter.archive_source, letter.archival_note);
    case "subject": return letter.subject;
    case "nation": return letter.nation;
    case "language": return letter.language;
    case "translated": return letter.translated;
    case "date": return letter.date;
    case "sources": return letter.sources;
    default: return undefined;
  }
}

// Pre-classified as expected (additive/derived, not a rename) — see
// Phase 1A/1B for why each of these is a deliberate generator behavior,
// not a bug: related_records gets resolved urls added when the source
// omitted them, collection gets populated from language when the source
// predates that field, excerpt gets derived from full_text/body when the
// source has no excerpt field at all.
export function compareRoundTrip(letter: LegacyLetter, generated: LetterJson): StructuralDiff[] {
  const diffs: StructuralDiff[] = [];

  for (const field of COMPARABLE_FIELDS) {
    const expected = deriveExpectedField(letter, field) ?? undefined;
    const actual = generated[field] ?? undefined;
    if (JSON.stringify(expected) !== JSON.stringify(actual)) {
      diffs.push({ recordId: letter.id, field, sourceValue: expected, generatedValue: actual, classification: "unexpected" });
    }
  }

  if (!letter.collection && generated.collection) {
    diffs.push({ recordId: letter.id, field: "collection", sourceValue: undefined, generatedValue: generated.collection, classification: "expected" });
  }
  if (!pick(letter.excerpt) && generated.excerpt) {
    diffs.push({ recordId: letter.id, field: "excerpt", sourceValue: undefined, generatedValue: generated.excerpt, classification: "expected" });
  }
  const sourceRelated = Array.isArray(letter.related_records) ? (letter.related_records as Array<{ url?: string }>) : [];
  if (sourceRelated.some((r) => !r.url) && (generated.related_records?.length ?? 0) > 0) {
    diffs.push({ recordId: letter.id, field: "related_records", sourceValue: "url missing in source", generatedValue: "url resolved by generator", classification: "expected" });
  }

  return diffs;
}

// Rollback tagging itself (writing metadata.importRunId) still happens
// inline in the transaction below — only the delete-by-runId utility is
// shared, now that Articles needs the identical mechanism. Re-exported
// under the original name so nothing importing from here needs to change.
export async function rollbackImportRun(runId: string): Promise<{ deletedRecords: number }> {
  return sharedRollbackImportRun("LETTER", runId);
}

async function writeImportResult(result: ImportResult): Promise<void> {
  // Each run gets its own never-before-existing subdirectory, so the
  // atomic writer's wholesale-replace semantics (Phase 0.5) can't clobber
  // a previous run's report the way reusing one shared directory would.
  const outDir = path.join(storageConfig.directories.importReports, "letters", "results", result.runId);
  const files = new Map([["import-result.json", JSON.stringify(result, null, 2)]]);
  await writeStagedFilesAtomically(outDir, files);
}

// ── The transactional importer itself ──────────────────────────────────
export async function runLettersImport(options: RunImportOptions): Promise<ImportResult> {
  const runId = randomUUID();
  const executedAt = new Date().toISOString();

  if (!EXECUTION_ENABLED || options.confirmExecution !== true) {
    return {
      runId,
      executedAt,
      mode: options.mode,
      preImportSnapshot: { recordCount: -1, collectionCount: -1, existingLetterSlugs: [] },
      preview: { generatedAt: executedAt, mode: options.mode, recordsToCreate: [], recordsToUpdate: [], collectionsToCreate: [], collectionsExisting: [] },
      recordsCreated: [],
      collectionsCreated: [],
      recordsSkipped: [],
      verification: { recordsCompared: 0, expectedDifferences: [], unexpectedDifferences: [] },
      status: "execution_disabled",
      error: "Phase 1C execution is disabled (EXECUTION_ENABLED=false). No database access of any kind was attempted.",
    };
  }

  const dryRun = await runLettersImportDryRun();
  if (dryRun.blockedByErrors > 0) {
    throw new Error(`Pre-flight check failed: ${dryRun.blockedByErrors} record(s) have blocking errors — aborting before any write.`);
  }

  const snapshot = await takePreImportSnapshot();
  const preview = await buildImportPreview(options.mode, snapshot);
  const allGroups = await loadAllSourceLetters();
  const groups = options.collections ? allGroups.filter((g) => options.collections!.includes(g.collection)) : allGroups;

  if (options.collections) {
    const unknown = options.collections.filter((c) => !(c in COLLECTION_FILES));
    if (unknown.length) throw new Error(`Unknown collection(s) requested: ${unknown.join(", ")}`);
  }

  const scopedRecordCount = groups.reduce((sum, g) => sum + g.letters.length, 0);
  if (options.maxRecords !== undefined && scopedRecordCount > options.maxRecords) {
    throw new Error(
      `Requested scope contains ${scopedRecordCount} record(s), exceeding maxRecords=${options.maxRecords} — aborting before any write rather than silently dropping records.`,
    );
  }
  const existingSet = new Set(snapshot.existingLetterSlugs);

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
      for (const { collection, letters } of groups) {
        const collectionRow = await tx.collection.upsert({
          where: { slug: `letters-${collection}` },
          update: {},
          create: { slug: `letters-${collection}`, title: `${collection[0].toUpperCase()}${collection.slice(1)} Letters`, category: "letters" },
        });
        if (preview.collectionsToCreate.includes(`letters-${collection}`)) {
          collectionsCreated.push({ slug: collectionRow.slug, id: collectionRow.id });
        }

        for (const letter of letters) {
          const alreadyExists = existingSet.has(letter.id);
          if (alreadyExists && options.mode === "insert-only") {
            recordsSkipped.push(letter.id);
            continue;
          }

          const input = toRecordCreateInput(letter, collection, collectionRow.id);
          (input.metadata as Record<string, unknown>).importRunId = runId;

          const row = await tx.record.upsert({
            where: { slug: letter.id },
            update: options.mode === "sync" ? (input as never) : {},
            create: input as never,
          });
          if (!alreadyExists) recordsCreated.push({ id: row.id, slug: letter.id, collection });

          const candidate = toCandidateRecord(letter, collection);
          const generated = toLetterJson(candidate);
          recordsCompared++;
          for (const diff of compareRoundTrip(letter, generated)) {
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
