import { randomUUID } from "crypto";
import path from "path";
import prisma from "../../../database/prisma";
import { storageConfig } from "../../../config/storage";
import {
  LegacyPersonnel, SlugNameConflict, detectSlugNameConflicts,
  splitRelatedRecords, toCandidateEntity, toEntityCreateInput,
} from "./personnel-entity-mapper";
import { loadAllPersonnel, runPersonnelImportDryRun, verifyRelatedRecordsConsistency } from "./personnel-import-check";
import { toPersonnelJson, PersonnelJson } from "../generators/personnel.generator";
import { writeStagedFilesAtomically } from "../atomic-stage-writer";
import { rollbackEntityImportRun } from "./rollback";

export type ImportMode = "insert-only" | "sync";

export interface PreEntityImportSnapshot {
  entityCount: number;
  existingPersonnelSlugs: string[];
}

export interface RelationshipPreviewEntry {
  fromSlug: string;
  toSlug: string;
}

export interface NonPersonnelReferenceEntry {
  fromSlug: string;
  type: string;
  targetId: string;
}

export interface EntityImportPreview {
  generatedAt: string;
  mode: ImportMode;
  recordsToCreate: string[];
  recordsToUpdate: string[];
  // Real Relationship rows this import would create — Entity-to-Entity
  // links only, per the approved architecture.
  personnelRelationshipsToCreate: RelationshipPreviewEntry[];
  // Everything that stays in metadata.related_records JSON instead,
  // because Relationship cannot point at a Record.
  nonPersonnelReferences: NonPersonnelReferenceEntry[];
  relationshipCount: number;
  // Surfaced here too (not just in the dry-run checker's report) so a
  // caller building only the preview still sees blocking conflicts without
  // needing to separately call runPersonnelImportDryRun.
  blockingSlugConflicts: SlugNameConflict[];
}

// ── Read-only: safe to call for real right now ──────────────────────────

export async function takePreEntityImportSnapshot(): Promise<PreEntityImportSnapshot> {
  const entityCount = await prisma.entity.count();
  const existing = await prisma.entity.findMany({ where: { type: "PERSON" }, select: { slug: true } });
  return {
    entityCount,
    existingPersonnelSlugs: existing.map((e) => e.slug).filter((s): s is string => !!s),
  };
}

export async function buildEntityImportPreview(mode: ImportMode, snapshot: PreEntityImportSnapshot): Promise<EntityImportPreview> {
  const loaded = await loadAllPersonnel();
  const allPeople = loaded.map((l) => l.person);
  const allIds = new Set(allPeople.map((p) => p.id));
  const existingSet = new Set(snapshot.existingPersonnelSlugs);

  const recordsToCreate: string[] = [];
  const recordsToUpdate: string[] = [];
  const personnelRelationshipsToCreate: RelationshipPreviewEntry[] = [];
  const nonPersonnelReferences: NonPersonnelReferenceEntry[] = [];

  for (const { person } of loaded) {
    (existingSet.has(person.id) ? recordsToUpdate : recordsToCreate).push(person.id);

    const { personnelLinks, otherLinks } = splitRelatedRecords(person.related_records);
    for (const link of personnelLinks) {
      // Only a real, resolvable target becomes a Relationship row — a
      // dangling reference is reported separately as a missing related
      // target by the dry-run checker, not silently turned into a
      // Relationship pointing at nothing.
      if (allIds.has(link.id)) {
        personnelRelationshipsToCreate.push({ fromSlug: person.id, toSlug: link.id });
      }
    }
    for (const link of otherLinks) {
      nonPersonnelReferences.push({ fromSlug: person.id, type: link.type ?? "unknown", targetId: link.id });
    }
  }

  return {
    generatedAt: new Date().toISOString(),
    mode,
    recordsToCreate,
    recordsToUpdate,
    personnelRelationshipsToCreate,
    nonPersonnelReferences,
    relationshipCount: personnelRelationshipsToCreate.length,
    blockingSlugConflicts: detectSlugNameConflicts(allPeople),
  };
}

// ── Personnel execution gate ─────────────────────────────────────────────
// Independent from Letters'/Articles'/Campaigns' gates — enabling one must
// never risk enabling another. Same two-factor design: this flag AND the
// caller's literal-typed confirmExecution must both agree.
//
// History: briefly set to true three times — the army-branch pilot (13
// entities, 2 relationships, runId 51766163-eb16-48fc-961b-c733fdd7fe46),
// the waffen-ss pilot (8 entities, 6 relationships including the cross-run
// lookup to walter-model, runId 20638511-5ac0-4912-ba8b-f188bb62de22), and
// the final remainder — kriegsmarine/luftwaffe/foreign, 25 entities, 20
// relationships, runId c05431b9-7420-4174-9814-aca5afeda48b — each time
// reset to false immediately after the run completed. Personnel migration
// is now complete: 46/46 entities, 28/28 relationships.
const EXECUTION_ENABLED = false;

export interface RunImportOptions {
  mode: ImportMode;
  confirmExecution: true;
  branches?: string[];
  maxRecords?: number;
}

export interface StructuralDiff {
  recordId: string;
  field: string;
  sourceValue: unknown;
  generatedValue: unknown;
  classification: "expected" | "unexpected";
}

export interface RelationshipMismatch {
  fromSlug: string;
  toSlug: string;
  issue: "expected_but_missing" | "unexpected_extra";
}

export interface ImportResult {
  runId: string;
  executedAt: string;
  mode: ImportMode;
  preImportSnapshot: PreEntityImportSnapshot;
  preview: EntityImportPreview;
  recordsCreated: { id: string; slug: string; branch: string }[];
  recordsSkipped: string[];
  relationshipsCreated: { id: string; fromSlug: string; toSlug: string }[];
  verification: {
    entitiesCompared: number;
    expectedDifferences: StructuralDiff[];
    unexpectedDifferences: StructuralDiff[];
    relationshipsExpected: number;
    relationshipsCreated: number;
    relationshipMismatches: RelationshipMismatch[];
  };
  status: "success" | "failed" | "verification_failed" | "execution_disabled" | "blocked_by_errors" | "consistency_check_failed";
  error?: string;
}

// ── In-memory round-trip verification — entity fields only ──────────────
// Relationship correctness is verified entirely separately (see Pass 2
// below) — this comparator only checks the scalar/array fields the
// generator reconstructs directly from metadata, plus the otherLinks
// portion of related_records. Called with personnelLinks=[] deliberately,
// so generated.related_records here contains only the otherLinks-derived
// entries — exactly what the "expected" classification below is about.
const SCALAR_FIELDS = ["name", "rank", "branch", "portrait", "birthplace", "biography", "nation", "service"];
const ARRAY_FIELDS = ["commands", "awards", "campaigns"];

function compareRoundTrip(person: LegacyPersonnel, generated: PersonnelJson): StructuralDiff[] {
  const diffs: StructuralDiff[] = [];
  const push = (field: string, sourceValue: unknown, generatedValue: unknown, classification: "expected" | "unexpected") =>
    diffs.push({ recordId: person.id, field, sourceValue, generatedValue, classification });

  for (const field of SCALAR_FIELDS) {
    const expected = (person[field] as string | undefined) ?? undefined;
    const actual = (generated[field] as string | undefined) ?? undefined;
    if (JSON.stringify(expected) !== JSON.stringify(actual)) push(field, expected, actual, "unexpected");
  }

  for (const field of ARRAY_FIELDS) {
    const expected = (person[field] as string[] | undefined) ?? undefined;
    const actual = (generated[field] as string[] | undefined) ?? undefined;
    if (JSON.stringify(expected) !== JSON.stringify(actual)) push(field, expected, actual, "unexpected");
  }

  if ((person.born ?? undefined) !== generated.born) push("born", person.born, generated.born, "unexpected");
  if ((person.died ?? undefined) !== generated.died) push("died", person.died, generated.died, "unexpected");

  // related_records (otherLinks only — personnelLinks=[] was passed in) —
  // always expected to differ when the source had any, since urls are
  // always regenerated fresh, never trusted from source (confirmed
  // necessary during Phase 4A verification: Personnel's source data
  // carries the same stale theater-prefixed Campaign urls, and stale
  // category-prefixed Article urls, that the respective migrations
  // themselves stopped trusting).
  const { otherLinks } = splitRelatedRecords(person.related_records);
  if (otherLinks.length > 0) {
    push("related_records", "source urls (possibly stale)", "flat urls (always regenerated)", "expected");
  }

  // Pass-through extras completeness — every one-off field (kills,
  // tank_kills, ships_sunk, tonnage_sunk, aircraft, vehicles) must survive
  // the round trip unchanged.
  const explicitKeys = new Set([
    "id", "name", "rank", "branch", "portrait", "born", "died", "birthplace",
    "biography", "commands", "awards", "campaigns", "sources", "related_records",
    "nation", "service",
  ]);
  for (const [key, value] of Object.entries(person)) {
    if (explicitKeys.has(key)) continue;
    const actual = generated[key];
    if (JSON.stringify(value) !== JSON.stringify(actual)) push(key, value, actual, "unexpected");
  }

  return diffs;
}

async function writeImportResult(result: ImportResult): Promise<void> {
  const outDir = path.join(storageConfig.directories.importReports, "personnel", "results", result.runId);
  const files = new Map([["import-result.json", JSON.stringify(result, null, 2)]]);
  await writeStagedFilesAtomically(outDir, files);
}

function emptyImportResult(runId: string, executedAt: string, mode: ImportMode, status: ImportResult["status"], error: string): ImportResult {
  return {
    runId,
    executedAt,
    mode,
    preImportSnapshot: { entityCount: -1, existingPersonnelSlugs: [] },
    preview: { generatedAt: executedAt, mode, recordsToCreate: [], recordsToUpdate: [], personnelRelationshipsToCreate: [], nonPersonnelReferences: [], relationshipCount: 0, blockingSlugConflicts: [] },
    recordsCreated: [],
    recordsSkipped: [],
    relationshipsCreated: [],
    verification: { entitiesCompared: 0, expectedDifferences: [], unexpectedDifferences: [], relationshipsExpected: 0, relationshipsCreated: 0, relationshipMismatches: [] },
    status,
    error,
  };
}

// ── The transactional importer itself ──────────────────────────────────
export async function runPersonnelImport(options: RunImportOptions): Promise<ImportResult> {
  const runId = randomUUID();
  const executedAt = new Date().toISOString();

  if (!EXECUTION_ENABLED || options.confirmExecution !== true) {
    return emptyImportResult(runId, executedAt, options.mode, "execution_disabled",
      "Personnel import execution is disabled (EXECUTION_ENABLED=false). No database access of any kind was attempted.");
  }

  // Fail-closed pre-flight #1 — conformance errors. No bypass flags, force
  // modes, ignore lists, or automatic exclusions exist anywhere in this
  // function. As of this writing, erwin-rommel-afk is a real, unresolved
  // blocker — this importer will refuse to start until it's corrected in
  // the source data or handled by a separately approved scope change, not
  // by adding an escape hatch here.
  const dryRun = await runPersonnelImportDryRun();
  if (dryRun.blockedByErrors > 0) {
    const result = emptyImportResult(runId, executedAt, options.mode, "blocked_by_errors",
      `Pre-flight check failed: ${dryRun.blockedByErrors} record(s) have blocking errors (see integrityReport.blockingSlugConflicts) — aborting before any write. No bypass exists.`);
    await writeImportResult(result);
    throw new Error(result.error);
  }

  // Fail-closed pre-flight #2 — consistency gate. Guarantees the preview
  // (built from buildEntityImportPreview) and this transaction operate on
  // identical assumptions about how related_records splits.
  const consistency = await verifyRelatedRecordsConsistency();
  if (!consistency.splitIsConsistent || consistency.personnelLinksDangling.length > 0) {
    const result = emptyImportResult(runId, executedAt, options.mode, "consistency_check_failed",
      `Pre-flight consistency check failed: splitIsConsistent=${consistency.splitIsConsistent}, ${consistency.personnelLinksDangling.length} dangling Personnel-type link(s) — aborting before any write.`);
    await writeImportResult(result);
    throw new Error(result.error);
  }

  const snapshot = await takePreEntityImportSnapshot();
  const preview = await buildEntityImportPreview(options.mode, snapshot);
  const allGroups = await loadAllPersonnel();
  const groups = options.branches ? allGroups.filter((g) => options.branches!.includes(g.branch)) : allGroups;

  if (options.branches) {
    const knownBranches = new Set(allGroups.map((g) => g.branch));
    const unknown = options.branches.filter((b) => !knownBranches.has(b));
    if (unknown.length) throw new Error(`Unknown branch(es) requested: ${unknown.join(", ")}`);
  }

  if (options.maxRecords !== undefined && groups.length > options.maxRecords) {
    throw new Error(
      `Requested scope contains ${groups.length} record(s), exceeding maxRecords=${options.maxRecords} — aborting before any write rather than silently dropping records.`,
    );
  }
  const existingSet = new Set(snapshot.existingPersonnelSlugs);

  const recordsCreated: ImportResult["recordsCreated"] = [];
  const recordsSkipped: string[] = [];
  const relationshipsCreatedList: ImportResult["relationshipsCreated"] = [];
  const expectedDifferences: StructuralDiff[] = [];
  const unexpectedDifferences: StructuralDiff[] = [];
  const relationshipMismatches: RelationshipMismatch[] = [];
  let entitiesCompared = 0;
  let relationshipsExpectedCount = 0;

  let status: ImportResult["status"] = "success";
  let errorMessage: string | undefined;

  try {
    await prisma.$transaction(async (tx) => {
      // ── Pass 1: Entity creation only — no Relationship rows here ──────
      const slugToId = new Map<string, string>();
      for (const { branch, person } of groups) {
        const alreadyExists = existingSet.has(person.id);
        if (alreadyExists && options.mode === "insert-only") {
          recordsSkipped.push(person.id);
          continue;
        }

        const input = toEntityCreateInput(person, branch);
        (input.metadata as Record<string, unknown>).importRunId = runId;

        const row = await tx.entity.upsert({
          where: { slug: person.id },
          update: options.mode === "sync" ? (input as never) : {},
          create: input as never,
        });
        slugToId.set(person.id, row.id);
        if (!alreadyExists) recordsCreated.push({ id: row.id, slug: person.id, branch });

        const candidate = toCandidateEntity(person, branch);
        const generated = toPersonnelJson(candidate, []);
        entitiesCompared++;
        for (const diff of compareRoundTrip(person, generated)) {
          (diff.classification === "expected" ? expectedDifferences : unexpectedDifferences).push(diff);
        }
      }

      if (unexpectedDifferences.length > 0) {
        throw new Error(`Entity round-trip verification found ${unexpectedDifferences.length} unexpected difference(s) — rolling back, zero changes committed.`);
      }

      // ── Pass 2: Relationship creation only — strictly after Pass 1 ────
      // completes, never interleaved with entity upserts above.
      const inScopeFromSlugs = new Set(groups.map((g) => g.person.id));
      const expectedRelationships = preview.personnelRelationshipsToCreate.filter((r) => inScopeFromSlugs.has(r.fromSlug));
      relationshipsExpectedCount = expectedRelationships.length;

      for (const rel of expectedRelationships) {
        const fromId = slugToId.get(rel.fromSlug);
        let toId = slugToId.get(rel.toSlug);
        if (!toId) {
          // Target wasn't part of this run's scope — check whether it
          // already exists from a prior run rather than assuming it does.
          const existingTarget = await tx.entity.findUnique({ where: { slug: rel.toSlug }, select: { id: true } });
          toId = existingTarget?.id;
        }
        // If the target genuinely isn't imported anywhere yet, this
        // relationship is deferred to a future run, not silently skipped
        // as if it didn't exist — it simply isn't created in this run.
        if (!fromId || !toId) continue;

        const row = await tx.relationship.create({
          data: { fromId, toId, type: "Personnel", metadata: { importRunId: runId } },
        });
        relationshipsCreatedList.push({ id: row.id, fromSlug: rel.fromSlug, toSlug: rel.toSlug });
      }

      // Independent re-query verification — don't trust the loop above's
      // own bookkeeping. Re-derive the actual slug pairs from a fresh
      // query and diff against what was expected.
      const actualRows = await tx.relationship.findMany({
        where: { type: "Personnel", metadata: { path: ["importRunId"], equals: runId } },
      });
      const idToSlug = new Map<string, string>();
      for (const [slug, id] of slugToId) idToSlug.set(id, slug);
      for (const rel of expectedRelationships) {
        // Make sure pre-existing (prior-run) targets resolve in the
        // reverse map too, so they're comparable below.
        if (!idToSlug.has(slugToId.get(rel.toSlug) ?? "")) {
          const existingTarget = await tx.entity.findUnique({ where: { slug: rel.toSlug }, select: { id: true } });
          if (existingTarget) idToSlug.set(existingTarget.id, rel.toSlug);
        }
      }

      const actualPairs = new Set(
        actualRows.map((r) => `${idToSlug.get(r.fromId) ?? r.fromId}->${idToSlug.get(r.toId) ?? r.toId}`),
      );
      const expectedPairs = new Set(expectedRelationships.map((r) => `${r.fromSlug}->${r.toSlug}`));

      for (const pair of expectedPairs) {
        if (!actualPairs.has(pair)) {
          const [fromSlug, toSlug] = pair.split("->");
          relationshipMismatches.push({ fromSlug, toSlug, issue: "expected_but_missing" });
        }
      }
      for (const pair of actualPairs) {
        if (!expectedPairs.has(pair)) {
          const [fromSlug, toSlug] = pair.split("->");
          relationshipMismatches.push({ fromSlug, toSlug, issue: "unexpected_extra" });
        }
      }

      if (relationshipMismatches.length > 0) {
        throw new Error(`Relationship verification found ${relationshipMismatches.length} mismatch(es) — rolling back, zero changes committed.`);
      }
    });
  } catch (err) {
    status = (unexpectedDifferences.length > 0 || relationshipMismatches.length > 0) ? "verification_failed" : "failed";
    errorMessage = (err as Error).message;
  }

  const result: ImportResult = {
    runId,
    executedAt,
    mode: options.mode,
    preImportSnapshot: snapshot,
    preview,
    recordsCreated: status === "success" ? recordsCreated : [],
    recordsSkipped: status === "success" ? recordsSkipped : [],
    relationshipsCreated: status === "success" ? relationshipsCreatedList : [],
    verification: {
      entitiesCompared,
      expectedDifferences,
      unexpectedDifferences,
      relationshipsExpected: relationshipsExpectedCount,
      relationshipsCreated: relationshipsCreatedList.length,
      relationshipMismatches,
    },
    status,
    ...(errorMessage ? { error: errorMessage } : {}),
  };

  await writeImportResult(result);
  if (status !== "success") throw new Error(errorMessage);
  return result;
}

export async function rollbackImportRun(runId: string): Promise<{ deletedRecords: number }> {
  return rollbackEntityImportRun("PERSON", runId);
}
