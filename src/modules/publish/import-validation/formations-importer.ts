import fs from "fs/promises";
import path from "path";
import { randomUUID } from "crypto";
import prisma from "../../../database/prisma";
import { storageConfig } from "../../../config/storage";
import {
  FORMATION_FILES, LegacyFormation, toCandidateRecord, toRecordCreateInput,
} from "./formations-record-mapper";
import { toFormationJson } from "../generators/formations.generator";
import { checkFormationRecord } from "../validators/formations.conformance";
import { writeStagedFilesAtomically } from "../atomic-stage-writer";
import { rollbackImportRun as sharedRollbackImportRun } from "./rollback";

const FORMATIONS_DIR = path.resolve(__dirname, "../../../../public/data/formations");

export type ImportMode = "insert-only" | "sync";

export interface PreImportSnapshot {
  recordCount: number;
  existingFormationSlugs: string[];
}

export interface ImportPreview {
  generatedAt: string;
  mode: ImportMode;
  recordsToCreate: string[];
  recordsToUpdate: string[];
  blockedByErrors: number;
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
  recordsCreated: { id: string; slug: string; section: string }[];
  recordsSkipped: string[];
  recordsInvalid: { slug: string; issues: string[] }[];
  verification: {
    recordsCompared: number;
    expectedDifferences: StructuralDiff[];
    unexpectedDifferences: StructuralDiff[];
  };
  status: "success" | "failed" | "verification_failed" | "execution_disabled" | "blocked_by_errors";
  error?: string;
}

// ── Formations execution gate ────────────────────────────────────────────
// Same two-factor design as every other onboarded content type's gate
// (Armaments/Articles/Campaigns/Letters/Personnel): this flag AND the
// caller's literal-typed confirmExecution must both agree. Independent
// from every other type's gate — enabling one must never risk enabling
// another.
const EXECUTION_ENABLED = false;

export interface RunImportOptions {
  mode: ImportMode;
  confirmExecution: true;
  sections?: string[];
  maxRecords?: number;
}

// ── Read-only: safe to call for real right now ──────────────────────────

export async function takePreImportSnapshot(): Promise<PreImportSnapshot> {
  const recordCount = await prisma.record.count();
  const existing = await prisma.record.findMany({ where: { type: "FORMATION" }, select: { slug: true } });
  return {
    recordCount,
    existingFormationSlugs: existing.map((r) => r.slug).filter((s): s is string => !!s),
  };
}

async function readFormationFile(filePath: string): Promise<LegacyFormation[]> {
  try {
    const raw = await fs.readFile(filePath, "utf-8");
    const data = JSON.parse(raw);
    return Array.isArray(data) ? data : [];
  } catch {
    return [];
  }
}

export async function loadAllSourceFormations(): Promise<{ section: string; formations: LegacyFormation[] }[]> {
  const out: { section: string; formations: LegacyFormation[] }[] = [];
  for (const [section, file] of Object.entries(FORMATION_FILES)) {
    out.push({ section, formations: await readFormationFile(path.join(FORMATIONS_DIR, file)) });
  }
  return out;
}

function validateAll(groups: { section: string; formations: LegacyFormation[] }[]): {
  blockedByErrors: number;
  invalid: { slug: string; issues: string[] }[];
} {
  let blockedByErrors = 0;
  const invalid: { slug: string; issues: string[] }[] = [];
  for (const { section, formations } of groups) {
    for (const formation of formations) {
      const candidate = toCandidateRecord(formation, section);
      const issues = checkFormationRecord(candidate);
      const errors = issues.filter((i) => i.severity === "error");
      if (errors.length > 0) {
        blockedByErrors++;
        invalid.push({ slug: formation.id ?? "(missing id)", issues: errors.map((e) => `${e.field}: ${e.message}`) });
      }
    }
  }
  return { blockedByErrors, invalid };
}

export async function buildImportPreview(mode: ImportMode, snapshot: PreImportSnapshot): Promise<ImportPreview> {
  const groups = await loadAllSourceFormations();
  const existingSet = new Set(snapshot.existingFormationSlugs);
  const recordsToCreate: string[] = [];
  const recordsToUpdate: string[] = [];
  for (const { formations } of groups) {
    for (const formation of formations) {
      if (!formation.id) continue;
      (existingSet.has(formation.id) ? recordsToUpdate : recordsToCreate).push(formation.id);
    }
  }
  const { blockedByErrors } = validateAll(groups);

  return {
    generatedAt: new Date().toISOString(),
    mode,
    recordsToCreate,
    recordsToUpdate,
    blockedByErrors,
  };
}

// ── In-memory round-trip verification — pure function, no fs/Prisma ─────
export function compareRoundTrip(formation: LegacyFormation, section: string, generated: Record<string, unknown>): StructuralDiff[] {
  const diffs: StructuralDiff[] = [];
  const push = (field: string, sourceValue: unknown, generatedValue: unknown, classification: "expected" | "unexpected") =>
    diffs.push({ recordId: formation.id, field, sourceValue, generatedValue, classification });

  if (generated.name !== formation.name) push("name", formation.name, generated.name, "unexpected");
  if ((generated.nation ?? "Germany") !== (formation.nation ?? "Germany")) push("nation", formation.nation, generated.nation, "unexpected");

  return diffs;
}

export async function rollbackImportRun(runId: string): Promise<{ deletedRecords: number }> {
  return sharedRollbackImportRun("FORMATION", runId);
}

async function writeImportResult(result: ImportResult): Promise<void> {
  const outDir = path.join(storageConfig.directories.importReports, "formations", "results", result.runId);
  const files = new Map([["import-result.json", JSON.stringify(result, null, 2)]]);
  await writeStagedFilesAtomically(outDir, files);
}

// ── The transactional importer itself ──────────────────────────────────
export async function runFormationsImport(options: RunImportOptions): Promise<ImportResult> {
  const runId = randomUUID();
  const executedAt = new Date().toISOString();

  if (!EXECUTION_ENABLED || options.confirmExecution !== true) {
    return {
      runId,
      executedAt,
      mode: options.mode,
      preImportSnapshot: { recordCount: -1, existingFormationSlugs: [] },
      preview: { generatedAt: executedAt, mode: options.mode, recordsToCreate: [], recordsToUpdate: [], blockedByErrors: 0 },
      recordsCreated: [],
      recordsSkipped: [],
      recordsInvalid: [],
      verification: { recordsCompared: 0, expectedDifferences: [], unexpectedDifferences: [] },
      status: "execution_disabled",
      error: "Formations import execution is disabled (EXECUTION_ENABLED=false). No database access of any kind was attempted.",
    };
  }

  const allGroups = await loadAllSourceFormations();
  const groups = options.sections ? allGroups.filter((g) => options.sections!.includes(g.section)) : allGroups;

  if (options.sections) {
    const unknown = options.sections.filter((s) => !(s in FORMATION_FILES));
    if (unknown.length) throw new Error(`Unknown section(s) requested: ${unknown.join(", ")}`);
  }

  const { blockedByErrors, invalid } = validateAll(groups);
  if (blockedByErrors > 0) {
    const result: ImportResult = {
      runId, executedAt, mode: options.mode,
      preImportSnapshot: { recordCount: -1, existingFormationSlugs: [] },
      preview: { generatedAt: executedAt, mode: options.mode, recordsToCreate: [], recordsToUpdate: [], blockedByErrors },
      recordsCreated: [], recordsSkipped: [], recordsInvalid: invalid,
      verification: { recordsCompared: 0, expectedDifferences: [], unexpectedDifferences: [] },
      status: "blocked_by_errors",
      error: `Pre-flight check failed: ${blockedByErrors} record(s) have blocking errors — aborting before any write.`,
    };
    await writeImportResult(result);
    throw new Error(result.error);
  }

  const snapshot = await takePreImportSnapshot();
  const preview = await buildImportPreview(options.mode, snapshot);

  const scopedCount = groups.reduce((sum, g) => sum + g.formations.length, 0);
  if (options.maxRecords !== undefined && scopedCount > options.maxRecords) {
    throw new Error(
      `Requested scope contains ${scopedCount} record(s), exceeding maxRecords=${options.maxRecords} — aborting before any write rather than silently dropping records.`,
    );
  }

  const existingSet = new Set(snapshot.existingFormationSlugs);
  const recordsCreated: ImportResult["recordsCreated"] = [];
  const recordsSkipped: string[] = [];
  const expectedDifferences: StructuralDiff[] = [];
  const unexpectedDifferences: StructuralDiff[] = [];
  let recordsCompared = 0;

  let status: ImportResult["status"] = "success";
  let errorMessage: string | undefined;

  try {
    await prisma.$transaction(async (tx) => {
      for (const { section, formations } of groups) {
        for (const formation of formations) {
          if (!formation.id || !formation.name) continue; // already screened by validateAll above
          const alreadyExists = existingSet.has(formation.id);
          if (alreadyExists && options.mode === "insert-only") {
            recordsSkipped.push(formation.id);
            continue;
          }

          const input = toRecordCreateInput(formation, section);
          (input.metadata as Record<string, unknown>).importRunId = runId;

          const row = await tx.record.upsert({
            where: { slug: formation.id },
            update: options.mode === "sync" ? (input as never) : {},
            create: input as never,
          });
          if (!alreadyExists) recordsCreated.push({ id: row.id, slug: formation.id, section });

          const candidate = toCandidateRecord(formation, section);
          const generated = toFormationJson(candidate);
          recordsCompared++;
          for (const diff of compareRoundTrip(formation, section, generated)) {
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
    recordsSkipped: status === "success" ? recordsSkipped : [],
    recordsInvalid: invalid,
    verification: { recordsCompared, expectedDifferences, unexpectedDifferences },
    status,
    ...(errorMessage ? { error: errorMessage } : {}),
  };

  await writeImportResult(result);
  if (status !== "success") throw new Error(errorMessage);
  return result;
}
