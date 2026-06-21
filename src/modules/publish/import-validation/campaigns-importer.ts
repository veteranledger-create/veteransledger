import fs from "fs/promises";
import path from "path";
import { randomUUID } from "crypto";
import prisma from "../../../database/prisma";
import { storageConfig } from "../../../config/storage";
import {
  CAMPAIGN_FILES, LegacyCampaign, deriveSummary, normalizeCombatants, normalizePhases,
  toCandidateRecord, toRecordCreateInput,
} from "./campaign-record-mapper";
import { runCampaignsImportDryRun } from "./campaigns-import-check";
import { toCampaignJson, CampaignJson } from "../generators/campaigns.generator";
import { writeStagedFilesAtomically } from "../atomic-stage-writer";
import { rollbackImportRun as sharedRollbackImportRun } from "./rollback";
import { pick } from "./text-utils";

const CAMPAIGNS_DIR = path.resolve(__dirname, "../../../../public/data/campaigns");

export type ImportMode = "insert-only" | "sync";

export interface PreImportSnapshot {
  recordCount: number;
  collectionCount: number;
  existingCampaignSlugs: string[];
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
  recordsCreated: { id: string; slug: string; theater: string }[];
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

// ── Campaigns execution gate ─────────────────────────────────────────────
// Independent from Letters' and Articles' gates — enabling one must never
// risk enabling another. Same two-factor design: this flag AND the
// caller's literal-typed confirmExecution must both agree.
//
// History: briefly set to true twice — once for the Africa-theater pilot
// (5 records, runId 1b4acc11-9f9b-4eba-a896-17785ece05a4), once for Phase
// 3D's remaining 30 records across 4 theaters (runId
// 1bb10a5f-3198-47ba-adf3-bc67f0f97253) — each time reset to false
// immediately after the run completed.
const EXECUTION_ENABLED = false;

export interface RunImportOptions {
  mode: ImportMode;
  confirmExecution: true;
  theaters?: string[];
  maxRecords?: number;
}

// ── Read-only: safe to call for real right now ──────────────────────────

export async function takePreImportSnapshot(): Promise<PreImportSnapshot> {
  const recordCount = await prisma.record.count();
  const collectionCount = await prisma.collection.count();
  const existing = await prisma.record.findMany({ where: { type: "CAMPAIGN" }, select: { slug: true } });
  return {
    recordCount,
    collectionCount,
    existingCampaignSlugs: existing.map((r) => r.slug).filter((s): s is string => !!s),
  };
}

async function loadAllSourceCampaigns(): Promise<{ theater: string; campaigns: LegacyCampaign[] }[]> {
  const out: { theater: string; campaigns: LegacyCampaign[] }[] = [];
  for (const [theater, filenames] of Object.entries(CAMPAIGN_FILES)) {
    const campaigns: LegacyCampaign[] = [];
    for (const filename of filenames) {
      campaigns.push(JSON.parse(await fs.readFile(path.join(CAMPAIGNS_DIR, theater, filename), "utf-8")));
    }
    out.push({ theater, campaigns });
  }
  return out;
}

export async function buildImportPreview(mode: ImportMode, snapshot: PreImportSnapshot): Promise<ImportPreview> {
  const groups = await loadAllSourceCampaigns();
  const existingSet = new Set(snapshot.existingCampaignSlugs);
  const recordsToCreate: string[] = [];
  const recordsToUpdate: string[] = [];
  for (const { campaigns } of groups) {
    for (const campaign of campaigns) {
      (existingSet.has(campaign.id) ? recordsToUpdate : recordsToCreate).push(campaign.id);
    }
  }

  const collectionSlugs = Object.keys(CAMPAIGN_FILES).map((t) => `campaigns-${t}`);
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
// Most fields are checked by re-deriving the expected value with the same
// pure function the import path used (normalizeCombatants, normalizePhases,
// deriveSummary) and comparing directly — since both sides call the same
// function, a real mismatch here is always a bug, never something that
// needs a special-case excuse. Only two fields are genuinely asymmetric by
// design and need pre-classification: related_records (the generator never
// trusts the source's url, per the Phase 3 decision to treat the
// theater-prefixed form as a bug, not the target format) and summary (the
// generator derives one when missing, mirroring Letters' excerpt).
export function compareRoundTrip(campaign: LegacyCampaign, theater: string, generated: CampaignJson): StructuralDiff[] {
  const diffs: StructuralDiff[] = [];
  const push = (field: string, sourceValue: unknown, generatedValue: unknown, classification: "expected" | "unexpected") =>
    diffs.push({ recordId: campaign.id, field, sourceValue, generatedValue, classification });

  if (generated.theater !== theater) {
    push("theater", theater, generated.theater, "unexpected");
  }

  const expectedRegionLabel = pick(campaign.theatre) ?? undefined;
  if (expectedRegionLabel !== generated.region_label) {
    push("region_label", expectedRegionLabel, generated.region_label, "unexpected");
  }

  const expectedStart = pick(campaign.dates?.start, campaign.date_start);
  const expectedEnd = pick(campaign.dates?.end, campaign.date_end);
  if ((expectedStart ?? undefined) !== generated.dates.start || (expectedEnd ?? undefined) !== generated.dates.end) {
    push("dates", { start: expectedStart, end: expectedEnd }, generated.dates, "unexpected");
  }

  const expectedCombatants = normalizeCombatants(campaign.combatants, campaign.commanders) ?? {
    axis: { commanders: [], strength: null, nations: [] },
    allied: { commanders: [], strength: null, nations: [] },
  };
  if (JSON.stringify(expectedCombatants) !== JSON.stringify(generated.combatants)) {
    push("combatants", expectedCombatants, generated.combatants, "unexpected");
  }

  const expectedPhases = normalizePhases(campaign.phases);
  if (JSON.stringify(expectedPhases) !== JSON.stringify(generated.phases)) {
    push("phases", expectedPhases, generated.phases, "unexpected");
  }

  const expectedCasualties = campaign.casualties ?? undefined;
  if (JSON.stringify(expectedCasualties) !== JSON.stringify(generated.casualties)) {
    push("casualties", expectedCasualties, generated.casualties, "unexpected");
  }

  // Summary: expected to differ only when the source had none and
  // deriveSummary actually produced something — same rule the conformance
  // validator uses to decide error vs. warning.
  const sourceHasSummary = !!pick(campaign.summary);
  if (!sourceHasSummary) {
    const derived = deriveSummary(pick(campaign.context), pick(campaign.significance), pick(campaign.outcome));
    if (derived && derived === generated.summary) {
      push("summary", undefined, generated.summary, "expected");
    } else if ((pick(campaign.summary) ?? undefined) !== generated.summary) {
      push("summary", campaign.summary, generated.summary, "unexpected");
    }
  } else if (campaign.summary !== generated.summary) {
    push("summary", campaign.summary, generated.summary, "unexpected");
  }

  // related_records — always expected to differ when the source had any
  // entries, since the generator never reuses a source url.
  const sourceRelated = Array.isArray(campaign.related_records) ? (campaign.related_records as Array<{ id?: unknown }>) : [];
  if (sourceRelated.length > 0) {
    push("related_records", "source urls (possibly theater-prefixed)", "flat /campaigns/:id urls (always regenerated)", "expected");
  }

  return diffs;
}

export async function rollbackImportRun(runId: string): Promise<{ deletedRecords: number }> {
  return sharedRollbackImportRun("CAMPAIGN", runId);
}

async function writeImportResult(result: ImportResult): Promise<void> {
  const outDir = path.join(storageConfig.directories.importReports, "campaigns", "results", result.runId);
  const files = new Map([["import-result.json", JSON.stringify(result, null, 2)]]);
  await writeStagedFilesAtomically(outDir, files);
}

// ── The transactional importer itself ──────────────────────────────────
export async function runCampaignsImport(options: RunImportOptions): Promise<ImportResult> {
  const runId = randomUUID();
  const executedAt = new Date().toISOString();

  if (!EXECUTION_ENABLED || options.confirmExecution !== true) {
    return {
      runId,
      executedAt,
      mode: options.mode,
      preImportSnapshot: { recordCount: -1, collectionCount: -1, existingCampaignSlugs: [] },
      preview: { generatedAt: executedAt, mode: options.mode, recordsToCreate: [], recordsToUpdate: [], collectionsToCreate: [], collectionsExisting: [] },
      recordsCreated: [],
      collectionsCreated: [],
      recordsSkipped: [],
      verification: { recordsCompared: 0, expectedDifferences: [], unexpectedDifferences: [] },
      status: "execution_disabled",
      error: "Campaigns import execution is disabled (EXECUTION_ENABLED=false). No database access of any kind was attempted.",
    };
  }

  const dryRun = await runCampaignsImportDryRun();
  if (dryRun.blockedByErrors > 0) {
    throw new Error(`Pre-flight check failed: ${dryRun.blockedByErrors} record(s) have blocking errors — aborting before any write.`);
  }

  const snapshot = await takePreImportSnapshot();
  const preview = await buildImportPreview(options.mode, snapshot);
  const allGroups = await loadAllSourceCampaigns();
  const groups = options.theaters ? allGroups.filter((g) => options.theaters!.includes(g.theater)) : allGroups;

  if (options.theaters) {
    const unknown = options.theaters.filter((t) => !(t in CAMPAIGN_FILES));
    if (unknown.length) throw new Error(`Unknown theater(s) requested: ${unknown.join(", ")}`);
  }

  const scopedRecordCount = groups.reduce((sum, g) => sum + g.campaigns.length, 0);
  if (options.maxRecords !== undefined && scopedRecordCount > options.maxRecords) {
    throw new Error(
      `Requested scope contains ${scopedRecordCount} record(s), exceeding maxRecords=${options.maxRecords} — aborting before any write rather than silently dropping records.`,
    );
  }
  const existingSet = new Set(snapshot.existingCampaignSlugs);

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
      for (const { theater, campaigns } of groups) {
        const collectionRow = await tx.collection.upsert({
          where: { slug: `campaigns-${theater}` },
          update: {},
          create: { slug: `campaigns-${theater}`, title: `${theater.split("-").map((w) => w[0].toUpperCase() + w.slice(1)).join(" ")} Campaigns`, category: "campaigns" },
        });
        if (preview.collectionsToCreate.includes(`campaigns-${theater}`)) {
          collectionsCreated.push({ slug: collectionRow.slug, id: collectionRow.id });
        }

        for (const campaign of campaigns) {
          const alreadyExists = existingSet.has(campaign.id);
          if (alreadyExists && options.mode === "insert-only") {
            recordsSkipped.push(campaign.id);
            continue;
          }

          const input = toRecordCreateInput(campaign, theater, collectionRow.id);
          (input.metadata as Record<string, unknown>).importRunId = runId;

          const row = await tx.record.upsert({
            where: { slug: campaign.id },
            update: options.mode === "sync" ? (input as never) : {},
            create: input as never,
          });
          if (!alreadyExists) recordsCreated.push({ id: row.id, slug: campaign.id, theater });

          const candidate = toCandidateRecord(campaign, theater);
          const generated = toCampaignJson(candidate);
          recordsCompared++;
          for (const diff of compareRoundTrip(campaign, theater, generated)) {
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
