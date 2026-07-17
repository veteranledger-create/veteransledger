import fs from "fs/promises";
import path from "path";
import { randomUUID } from "crypto";
import prisma from "../../../database/prisma";
import { storageConfig } from "../../../config/storage";
import { LegacyTimelineEvent, fallbackNaturalKey, toTimelineEventCreateInput } from "./timeline-record-mapper";
import { checkTimelineEvent, TimelineEventRow } from "../validators/timeline.conformance";
import { writeStagedFilesAtomically } from "../atomic-stage-writer";
import { rollbackTimelineImportRun } from "./rollback";

const TIMELINE_FILE = path.resolve(__dirname, "../../../../public/data/timeline/events.json");

export type ImportMode = "insert-only" | "sync";

export interface PreImportSnapshot {
  eventCount: number;
  existingIds: string[];
  existingNaturalKeys: string[];
}

export interface ImportPreview {
  generatedAt: string;
  mode: ImportMode;
  eventsToCreate: string[];
  eventsToUpdate: string[];
  blockedByErrors: number;
}

export interface ImportResult {
  runId: string;
  executedAt: string;
  mode: ImportMode;
  preImportSnapshot: PreImportSnapshot;
  preview: ImportPreview;
  eventsCreated: { id: string; title: string }[];
  eventsSkipped: string[];
  eventsInvalid: { key: string; issues: string[] }[];
  status: "success" | "failed" | "execution_disabled" | "blocked_by_errors";
  error?: string;
}

// ── Timeline execution gate ──────────────────────────────────────────────
// Same two-factor design as every other onboarded content type's gate.
// Independent from every other type's gate.
const EXECUTION_ENABLED = false;

export interface RunImportOptions {
  mode: ImportMode;
  confirmExecution: true;
  maxRecords?: number;
}

// ── Read-only: safe to call for real right now ──────────────────────────

export async function takePreImportSnapshot(): Promise<PreImportSnapshot> {
  const eventCount = await prisma.timelineEvent.count();
  const existing = await prisma.timelineEvent.findMany({ select: { id: true, year: true, title: true } });
  return {
    eventCount,
    existingIds: existing.map((e) => e.id),
    existingNaturalKeys: existing.map((e) => `${e.year ?? ""}::${e.title}`),
  };
}

export async function loadAllSourceEvents(): Promise<LegacyTimelineEvent[]> {
  try {
    const raw = await fs.readFile(TIMELINE_FILE, "utf-8");
    const data = JSON.parse(raw);
    return Array.isArray(data.events) ? data.events : [];
  } catch {
    return [];
  }
}

function toRow(event: LegacyTimelineEvent): TimelineEventRow {
  return {
    id: event.id ?? fallbackNaturalKey(event),
    year: event.year ?? null,
    date: event.date ? new Date(event.date) : null,
    endDate: event.endDate ? new Date(event.endDate) : null,
    title: event.title,
    summary: event.summary ?? null,
    category: event.category ?? null,
    location: event.location ?? null,
    significance: event.significance ?? null,
    metadata: { sources: event.sources ?? [], related_records: event.related_records ?? [] },
    published: true,
  };
}

function validateAll(events: LegacyTimelineEvent[]): { blockedByErrors: number; invalid: { key: string; issues: string[] }[] } {
  let blockedByErrors = 0;
  const invalid: { key: string; issues: string[] }[] = [];
  for (const event of events) {
    const issues = checkTimelineEvent(toRow(event));
    const errors = issues.filter((i) => i.severity === "error");
    if (errors.length > 0) {
      blockedByErrors++;
      invalid.push({ key: event.id ?? fallbackNaturalKey(event), issues: errors.map((e) => `${e.field}: ${e.message}`) });
    }
  }
  return { blockedByErrors, invalid };
}

export async function buildImportPreview(mode: ImportMode, snapshot: PreImportSnapshot): Promise<ImportPreview> {
  const events = await loadAllSourceEvents();
  const existingIdSet = new Set(snapshot.existingIds);
  const existingKeySet = new Set(snapshot.existingNaturalKeys);
  const eventsToCreate: string[] = [];
  const eventsToUpdate: string[] = [];
  for (const event of events) {
    const hasId = typeof event.id === "string" && event.id.trim().length > 0;
    const key = hasId ? event.id! : fallbackNaturalKey(event);
    const exists = hasId ? existingIdSet.has(event.id!) : existingKeySet.has(fallbackNaturalKey(event));
    (exists ? eventsToUpdate : eventsToCreate).push(key);
  }
  const { blockedByErrors } = validateAll(events);
  return { generatedAt: new Date().toISOString(), mode, eventsToCreate, eventsToUpdate, blockedByErrors };
}

export async function rollbackImportRun(runId: string): Promise<{ deletedRecords: number }> {
  return rollbackTimelineImportRun(runId);
}

async function writeImportResult(result: ImportResult): Promise<void> {
  const outDir = path.join(storageConfig.directories.importReports, "timeline", "results", result.runId);
  const files = new Map([["import-result.json", JSON.stringify(result, null, 2)]]);
  await writeStagedFilesAtomically(outDir, files);
}

// ── The transactional importer itself ──────────────────────────────────
export async function runTimelineImport(options: RunImportOptions): Promise<ImportResult> {
  const runId = randomUUID();
  const executedAt = new Date().toISOString();

  if (!EXECUTION_ENABLED || options.confirmExecution !== true) {
    return {
      runId,
      executedAt,
      mode: options.mode,
      preImportSnapshot: { eventCount: -1, existingIds: [], existingNaturalKeys: [] },
      preview: { generatedAt: executedAt, mode: options.mode, eventsToCreate: [], eventsToUpdate: [], blockedByErrors: 0 },
      eventsCreated: [],
      eventsSkipped: [],
      eventsInvalid: [],
      status: "execution_disabled",
      error: "Timeline import execution is disabled (EXECUTION_ENABLED=false). No database access of any kind was attempted.",
    };
  }

  const events = await loadAllSourceEvents();
  const { blockedByErrors, invalid } = validateAll(events);
  if (blockedByErrors > 0) {
    const result: ImportResult = {
      runId, executedAt, mode: options.mode,
      preImportSnapshot: { eventCount: -1, existingIds: [], existingNaturalKeys: [] },
      preview: { generatedAt: executedAt, mode: options.mode, eventsToCreate: [], eventsToUpdate: [], blockedByErrors },
      eventsCreated: [], eventsSkipped: [], eventsInvalid: invalid,
      status: "blocked_by_errors",
      error: `Pre-flight check failed: ${blockedByErrors} event(s) have blocking errors — aborting before any write.`,
    };
    await writeImportResult(result);
    throw new Error(result.error);
  }

  const snapshot = await takePreImportSnapshot();
  const preview = await buildImportPreview(options.mode, snapshot);

  if (options.maxRecords !== undefined && events.length > options.maxRecords) {
    throw new Error(
      `Source contains ${events.length} event(s), exceeding maxRecords=${options.maxRecords} — aborting before any write rather than silently dropping records.`,
    );
  }

  const existingIdSet = new Set(snapshot.existingIds);
  const existingKeySet = new Set(snapshot.existingNaturalKeys);
  const eventsCreated: ImportResult["eventsCreated"] = [];
  const eventsSkipped: string[] = [];

  let status: ImportResult["status"] = "success";
  let errorMessage: string | undefined;

  try {
    await prisma.$transaction(async (tx) => {
      for (const event of events) {
        const hasId = typeof event.id === "string" && event.id.trim().length > 0;
        const alreadyExists = hasId ? existingIdSet.has(event.id!) : existingKeySet.has(fallbackNaturalKey(event));

        if (alreadyExists && options.mode === "insert-only") {
          eventsSkipped.push(hasId ? event.id! : fallbackNaturalKey(event));
          continue;
        }

        const input = toTimelineEventCreateInput(event);
        (input.metadata as Record<string, unknown>).importRunId = runId;

        if (hasId) {
          const row = await tx.timelineEvent.upsert({
            where: { id: event.id! },
            update: options.mode === "sync" ? (input as never) : {},
            create: input as never,
          });
          if (!alreadyExists) eventsCreated.push({ id: row.id, title: row.title });
        } else if (!alreadyExists) {
          // No preserved id and no existing match — safe to create fresh;
          // Prisma assigns a new cuid since toTimelineEventCreateInput
          // omits `id` entirely for this path.
          const row = await tx.timelineEvent.create({ data: input as never });
          eventsCreated.push({ id: row.id, title: row.title });
        }
        // else: no id, but natural key already exists in sync mode — no
        // reliable way to target an update without an id, so left as-is
        // rather than risking a duplicate row.
      }
    });
  } catch (err) {
    status = "failed";
    errorMessage = (err as Error).message;
  }

  const result: ImportResult = {
    runId,
    executedAt,
    mode: options.mode,
    preImportSnapshot: snapshot,
    preview,
    eventsCreated: status === "success" ? eventsCreated : [],
    eventsSkipped: status === "success" ? eventsSkipped : [],
    eventsInvalid: invalid,
    status,
    ...(errorMessage ? { error: errorMessage } : {}),
  };

  await writeImportResult(result);
  if (status !== "success") throw new Error(errorMessage);
  return result;
}
