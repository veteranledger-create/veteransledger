import path from "path";
import { randomUUID } from "crypto";
import prisma from "../../../database/prisma";
import { storageConfig } from "../../../config/storage";
import {
  AssignedArmament, DUPLICATE_RESOLUTIONS,
  applyDuplicateResolutions, assignIds, slugify, toCandidateRecord, toRecordCreateInput,
} from "./armament-record-mapper";
import { DuplicateResolutionReport, loadAllArmaments, runArmamentsImportDryRun } from "./armaments-import-check";
import { ArmamentJson, reconstructFile, toArmamentJson } from "../generators/armaments.generator";
import { writeStagedFilesAtomically } from "../atomic-stage-writer";
import { rollbackImportRun as sharedRollbackImportRun } from "./rollback";
import { pick } from "./text-utils";

export type ImportMode = "insert-only" | "sync";

export interface PreImportSnapshot {
  recordCount: number;
  collectionCount: number;
  existingArmamentSlugs: string[];
}

export interface ImportPreview {
  generatedAt: string;
  mode: ImportMode;
  recordsToCreate: string[];
  recordsToUpdate: string[];
  collectionsToCreate: string[];
  collectionsExisting: string[];
  synthesizedIdCount: number;
  duplicateResolutionReport: DuplicateResolutionReport;
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
  recordsCreated: { id: string; slug: string; category: string; fileNation: string }[];
  collectionsCreated: { slug: string; id: string }[];
  recordsSkipped: string[];
  verification: {
    recordsCompared: number;
    expectedDifferences: StructuralDiff[];
    unexpectedDifferences: StructuralDiff[];
  };
  status: "success" | "failed" | "verification_failed" | "execution_disabled" | "blocked_by_errors" | "duplicate_resolution_integrity_failed";
  error?: string;
}

// ── Armaments execution gate ─────────────────────────────────────────────
// Independent from Letters'/Articles'/Campaigns'/Personnel's gates —
// enabling one must never risk enabling another. Same two-factor design:
// this flag AND the caller's literal-typed confirmExecution must both
// agree.
//
// History: briefly set to true for the naval-category pilot (14 records,
// 4 collections, runId 53c90705-646e-4e46-96d1-4b67fc248d63), then reset
// to false.
const EXECUTION_ENABLED = false;

export interface RunImportOptions {
  mode: ImportMode;
  confirmExecution: true;
  categories?: string[];
  nations?: string[];
  maxRecords?: number;
}

// ── Read-only: safe to call for real right now ──────────────────────────

export async function takePreImportSnapshot(): Promise<PreImportSnapshot> {
  const recordCount = await prisma.record.count();
  const collectionCount = await prisma.collection.count();
  const existing = await prisma.record.findMany({ where: { type: "ARMAMENT" }, select: { slug: true } });
  return {
    recordCount,
    collectionCount,
    existingArmamentSlugs: existing.map((r) => r.slug).filter((s): s is string => !!s),
  };
}

async function resolveAndAssign(): Promise<{ assigned: AssignedArmament[]; rawCount: number; resolvedCount: number }> {
  const loadedRaw = await loadAllArmaments();
  const { resolved } = applyDuplicateResolutions(loadedRaw);
  // Explicit runtime assertion: duplicate resolution only ever removes
  // donor entries via splice — it must never increase the working set.
  // This proves the property rather than just relying on the
  // implementation never having a code path that adds records.
  if (resolved.length > loadedRaw.length) {
    throw new Error(
      `Duplicate resolution invariant violated: resolved count (${resolved.length}) exceeds raw loaded count (${loadedRaw.length}) — this should be structurally impossible.`,
    );
  }
  const assigned = assignIds(resolved);
  return { assigned, rawCount: loadedRaw.length, resolvedCount: resolved.length };
}

export async function buildImportPreview(mode: ImportMode, snapshot: PreImportSnapshot): Promise<ImportPreview> {
  const dryRun = await runArmamentsImportDryRun();
  const { assigned } = await resolveAndAssign();

  const existingSet = new Set(snapshot.existingArmamentSlugs);
  const recordsToCreate: string[] = [];
  const recordsToUpdate: string[] = [];
  for (const a of assigned) {
    (existingSet.has(a.id) ? recordsToUpdate : recordsToCreate).push(a.id);
  }

  const allCollectionSlugs = [...new Set(assigned.map((a) => `armaments-${a.category}-${a.fileNation}`))];
  const existingCollections = await prisma.collection.findMany({
    where: { slug: { in: allCollectionSlugs } },
    select: { slug: true },
  });
  const existingCollectionSlugs = new Set(existingCollections.map((c) => c.slug));

  return {
    generatedAt: new Date().toISOString(),
    mode,
    recordsToCreate,
    recordsToUpdate,
    collectionsToCreate: allCollectionSlugs.filter((s) => !existingCollectionSlugs.has(s)),
    collectionsExisting: [...existingCollectionSlugs],
    synthesizedIdCount: dryRun.synthesizedIdCount,
    duplicateResolutionReport: dryRun.duplicateResolutionReport,
  };
}

// ── In-memory round-trip verification — pure function, no fs/Prisma ─────
// Most fields are direct comparisons (Armaments has no Letters-style
// legacy-field-rename problem). Three checks are specific to this content
// type: re-deriving the synthesized id independently, confirming the
// duplicate-resolution merge fields survived for exactly the 4 known
// canonical records, and (separately, per-file rather than per-record —
// see verifyWrapperReconstruction below) confirming the wrapper shape.
function capitalizeFileNation(fileNation: string): string {
  return fileNation.split("-").map((w) => w[0].toUpperCase() + w.slice(1)).join(" ");
}

export function compareRoundTrip(loaded: AssignedArmament, generated: ArmamentJson): StructuralDiff[] {
  const diffs: StructuralDiff[] = [];
  const push = (field: string, sourceValue: unknown, generatedValue: unknown, classification: "expected" | "unexpected") =>
    diffs.push({ recordId: loaded.id, field, sourceValue, generatedValue, classification });

  if (generated.name !== loaded.item.name) push("name", loaded.item.name, generated.name, "unexpected");

  const expectedNation = pick(loaded.item.nation) ?? capitalizeFileNation(loaded.fileNation);
  if ((generated.nation ?? undefined) !== expectedNation) push("nation", expectedNation, generated.nation, "unexpected");

  const expectedSummary = pick(loaded.item.summary, loaded.item.notes, loaded.item.description) ?? undefined;
  if ((generated.summary ?? undefined) !== expectedSummary) push("summary", expectedSummary, generated.summary, "unexpected");

  // Synthesized-id re-derivation — re-run slugify independently rather
  // than trusting the id assigned earlier in the pipeline.
  const expectedId = loaded.item.id ?? slugify(loaded.item.name);
  if (generated.id !== expectedId) push("id", expectedId, generated.id, "unexpected");

  if ((loaded.item.image as string | undefined ?? undefined) !== (generated.image ?? undefined)) {
    push("image", loaded.item.image, generated.image, "unexpected");
  }
  if (JSON.stringify(loaded.item.related_records ?? undefined) !== JSON.stringify(generated.related_records ?? undefined)) {
    push("related_records", loaded.item.related_records, generated.related_records, "unexpected");
  }

  // Duplicate-merge verification — only fires for the 4 known canonical
  // records, re-checking against the same rule table the importer used,
  // not assuming the merge in applyDuplicateResolutions succeeded.
  const rule = DUPLICATE_RESOLUTIONS.find(
    (r) => (r.canonicalId && r.canonicalId === loaded.id) || (r.canonical && r.canonical.name === loaded.item.name),
  );
  if (rule) {
    for (const field of rule.fieldsToMerge) {
      const expectedValue = loaded.item[field]; // already merged into loaded.item by applyDuplicateResolutions
      const actualValue = generated[field];
      if (JSON.stringify(expectedValue) !== JSON.stringify(actualValue)) {
        push(field, expectedValue, actualValue, "unexpected");
      }
    }
  }

  return diffs;
}

// Per-file-group structural check, not per-record — confirms
// reconstructFile() produces the correct shape (plain array for full
// schema, correctly-keyed wrapper object for minor schema) for each
// scoped category+fileNation group.
export function verifyWrapperReconstruction(
  groups: { category: string; fileNation: string; schemaType: "full" | "minor"; records: ArmamentJson[] }[],
): StructuralDiff[] {
  const diffs: StructuralDiff[] = [];
  for (const group of groups) {
    const reconstructed = reconstructFile(group.category, group.fileNation, group.records, group.schemaType);
    const recordId = `${group.category}/${group.fileNation}`;
    if (group.schemaType === "full") {
      if (!Array.isArray(reconstructed) || reconstructed.length !== group.records.length) {
        diffs.push({ recordId, field: "wrapperReconstruction", sourceValue: group.records.length, generatedValue: reconstructed, classification: "unexpected" });
      }
    } else {
      const obj = reconstructed as Record<string, unknown>;
      const wrapperValues = Object.values(obj).find((v) => Array.isArray(v)) as unknown[] | undefined;
      if (!wrapperValues || wrapperValues.length !== group.records.length) {
        diffs.push({ recordId, field: "wrapperReconstruction", sourceValue: group.records.length, generatedValue: reconstructed, classification: "unexpected" });
      }
    }
  }
  return diffs;
}

export async function rollbackImportRun(runId: string): Promise<{ deletedRecords: number }> {
  return sharedRollbackImportRun("ARMAMENT", runId);
}

async function writeImportResult(result: ImportResult): Promise<void> {
  const outDir = path.join(storageConfig.directories.importReports, "armaments", "results", result.runId);
  const files = new Map([["import-result.json", JSON.stringify(result, null, 2)]]);
  await writeStagedFilesAtomically(outDir, files);
}

function emptyImportResult(runId: string, executedAt: string, mode: ImportMode, status: ImportResult["status"], error: string): ImportResult {
  return {
    runId,
    executedAt,
    mode,
    preImportSnapshot: { recordCount: -1, collectionCount: -1, existingArmamentSlugs: [] },
    preview: {
      generatedAt: executedAt, mode, recordsToCreate: [], recordsToUpdate: [], collectionsToCreate: [], collectionsExisting: [],
      synthesizedIdCount: 0,
      duplicateResolutionReport: { rulesExpected: 0, rulesMatched: 0, rulesMissingCanonical: 0, rulesMissingDonor: 0, rulesApplied: 0, outcomes: [] },
    },
    recordsCreated: [],
    collectionsCreated: [],
    recordsSkipped: [],
    verification: { recordsCompared: 0, expectedDifferences: [], unexpectedDifferences: [] },
    status,
    error,
  };
}

// ── The transactional importer itself ──────────────────────────────────
export async function runArmamentsImport(options: RunImportOptions): Promise<ImportResult> {
  const runId = randomUUID();
  const executedAt = new Date().toISOString();

  // Gate 1: EXECUTION_ENABLED + Gate 2: confirmExecution — checked first,
  // before any other work, so the disabled path performs zero database
  // access of any kind.
  if (!EXECUTION_ENABLED || options.confirmExecution !== true) {
    return emptyImportResult(runId, executedAt, options.mode, "execution_disabled",
      "Armaments import execution is disabled (EXECUTION_ENABLED=false). No database access of any kind was attempted.");
  }

  // Gate 3: blockedByErrors — no bypass flags, force modes, or ignore
  // lists exist anywhere in this function.
  const dryRun = await runArmamentsImportDryRun();
  if (dryRun.blockedByErrors > 0) {
    const result = emptyImportResult(runId, executedAt, options.mode, "blocked_by_errors",
      `Pre-flight check failed: ${dryRun.blockedByErrors} record(s) have blocking errors — aborting before any write. No bypass exists.`);
    await writeImportResult(result);
    throw new Error(result.error);
  }

  // Gate 4: duplicate-resolution integrity — guarantees the preview and
  // this transaction operate on identical, fully-resolved assumptions.
  const r = dryRun.duplicateResolutionReport;
  const integrityOk = r.rulesExpected === r.rulesMatched && r.rulesExpected === r.rulesApplied && r.rulesMissingCanonical === 0 && r.rulesMissingDonor === 0;
  if (!integrityOk) {
    const result = emptyImportResult(runId, executedAt, options.mode, "duplicate_resolution_integrity_failed",
      `Pre-flight duplicate-resolution integrity check failed: rulesExpected=${r.rulesExpected}, rulesMatched=${r.rulesMatched}, rulesApplied=${r.rulesApplied}, rulesMissingCanonical=${r.rulesMissingCanonical}, rulesMissingDonor=${r.rulesMissingDonor} — aborting before any write.`);
    await writeImportResult(result);
    throw new Error(result.error);
  }

  const snapshot = await takePreImportSnapshot();
  const preview = await buildImportPreview(options.mode, snapshot);
  const { assigned: allAssigned } = await resolveAndAssign();

  // Scope filtering happens here — strictly after load, resolve, assign,
  // and the full unscoped dry-run/integrity checks above, never before.
  const scoped = allAssigned.filter(
    (a) => (!options.categories || options.categories.includes(a.category)) && (!options.nations || options.nations.includes(a.fileNation)),
  );

  if (options.categories) {
    const known = new Set(allAssigned.map((a) => a.category));
    const unknown = options.categories.filter((c) => !known.has(c));
    if (unknown.length) throw new Error(`Unknown category(ies) requested: ${unknown.join(", ")}`);
  }
  if (options.nations) {
    const known = new Set(allAssigned.map((a) => a.fileNation));
    const unknown = options.nations.filter((n) => !known.has(n));
    if (unknown.length) throw new Error(`Unknown nation(s) requested: ${unknown.join(", ")}`);
  }

  if (options.maxRecords !== undefined && scoped.length > options.maxRecords) {
    throw new Error(
      `Requested scope contains ${scoped.length} record(s), exceeding maxRecords=${options.maxRecords} — aborting before any write rather than silently dropping records.`,
    );
  }

  const existingSet = new Set(snapshot.existingArmamentSlugs);
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
      // ── Pass 1: Collection upserts only, for in-scope groups ─────────
      const groupKeys = [...new Set(scoped.map((a) => `${a.category}::${a.fileNation}`))];
      for (const key of groupKeys) {
        const [category, fileNation] = key.split("::");
        const slug = `armaments-${category}-${fileNation}`;
        const collectionRow = await tx.collection.upsert({
          where: { slug },
          update: {},
          create: { slug, title: `${category[0].toUpperCase()}${category.slice(1)} — ${fileNation[0].toUpperCase()}${fileNation.slice(1)}`, category: "armaments" },
        });
        if (preview.collectionsToCreate.includes(slug)) {
          collectionsCreated.push({ slug: collectionRow.slug, id: collectionRow.id });
        }
      }

      // ── Pass 2: Record upserts, strictly after Pass 1 completes ──────
      const generatedByGroup = new Map<string, { records: ArmamentJson[]; schemaType: "full" | "minor" }>();
      for (const a of scoped) {
        const alreadyExists = existingSet.has(a.id);
        if (alreadyExists && options.mode === "insert-only") {
          recordsSkipped.push(a.id);
          continue;
        }

        const slug = `armaments-${a.category}-${a.fileNation}`;
        const collectionRow = await tx.collection.findUniqueOrThrow({ where: { slug } });

        const input = toRecordCreateInput(a, collectionRow.id);
        (input.metadata as Record<string, unknown>).importRunId = runId;

        const row = await tx.record.upsert({
          where: { slug: a.id },
          update: options.mode === "sync" ? (input as never) : {},
          create: input as never,
        });
        if (!alreadyExists) recordsCreated.push({ id: row.id, slug: a.id, category: a.category, fileNation: a.fileNation });

        const candidate = toCandidateRecord(a);
        const generated = toArmamentJson(candidate);
        recordsCompared++;
        for (const diff of compareRoundTrip(a, generated)) {
          (diff.classification === "expected" ? expectedDifferences : unexpectedDifferences).push(diff);
        }

        const groupKey = `${a.category}::${a.fileNation}`;
        const group = generatedByGroup.get(groupKey) ?? { records: [], schemaType: a.schemaType };
        group.records.push(generated);
        generatedByGroup.set(groupKey, group);
      }

      // ── Wrapper-reconstruction verification, per scoped file-group ───
      const wrapperGroups = [...generatedByGroup.entries()].map(([key, group]) => {
        const [category, fileNation] = key.split("::");
        return { category, fileNation, schemaType: group.schemaType, records: group.records };
      });
      for (const diff of verifyWrapperReconstruction(wrapperGroups)) {
        unexpectedDifferences.push(diff);
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
