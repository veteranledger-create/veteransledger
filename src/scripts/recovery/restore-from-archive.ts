/**
 * Production Recovery — Restore Database from Published Archive.
 *
 * Orchestrates the 7 onboarded importers (armaments, articles, campaigns,
 * letters, personnel, formations, timeline) against the published archive
 * under public/data/**. Each importer is independently transactional,
 * idempotent (upsert/skip by slug or id), and gated behind its own
 * EXECUTION_ENABLED flag — this script does not bypass any of that; it
 * only aggregates their existing preview/run entry points so the whole
 * recovery can be previewed and executed as one operation.
 *
 * Usage:
 *   npx ts-node src/scripts/recovery/restore-from-archive.ts            (preview only — default, always safe)
 *   npx ts-node src/scripts/recovery/restore-from-archive.ts --execute  (writes to the database)
 *
 * --execute additionally requires every importer's own EXECUTION_ENABLED
 * flag to be flipped true in its source file — this script deliberately
 * cannot do that for you, so an accidental --execute run against a
 * codebase where those flags are still false is a no-op, not a partial
 * write. See docs/recovery-architecture.md for the full design.
 */

import path from "path";
import fs from "fs/promises";
import { storageConfig } from "../../config/storage";

import * as armaments from "../../modules/publish/import-validation/armaments-importer";
import * as personnel from "../../modules/publish/import-validation/personnel-importer";
import * as campaigns from "../../modules/publish/import-validation/campaigns-importer";
import * as letters from "../../modules/publish/import-validation/letters-importer";
import * as articles from "../../modules/publish/import-validation/articles-importer";
import * as formations from "../../modules/publish/import-validation/formations-importer";
import * as timeline from "../../modules/publish/import-validation/timeline-importer";

interface TypePreviewSummary {
  type: string;
  objectKind: "records" | "entities" | "timelineEvents";
  toCreate: number;
  toUpdate: number;
  extra?: string;
}

interface TypeRunSummary {
  type: string;
  status: string;
  created: number;
  skipped: number;
  invalidOrErrors: number;
  runId: string;
  error?: string;
}

const MODE = "insert-only" as const;

async function previewArmaments(): Promise<TypePreviewSummary> {
  const snapshot = await armaments.takePreImportSnapshot();
  const preview = await armaments.buildImportPreview(MODE, snapshot);
  return {
    type: "armaments", objectKind: "records",
    toCreate: preview.recordsToCreate.length, toUpdate: preview.recordsToUpdate.length,
    extra: `${preview.collectionsToCreate.length} collection(s) to create`,
  };
}

async function previewArticles(): Promise<TypePreviewSummary> {
  const snapshot = await articles.takePreImportSnapshot();
  const preview = await articles.buildImportPreview(MODE, snapshot);
  return {
    type: "articles", objectKind: "records",
    toCreate: preview.recordsToCreate.length, toUpdate: preview.recordsToUpdate.length,
    extra: `${preview.collectionsToCreate.length} collection(s) to create`,
  };
}

async function previewCampaigns(): Promise<TypePreviewSummary> {
  const snapshot = await campaigns.takePreImportSnapshot();
  const preview = await campaigns.buildImportPreview(MODE, snapshot);
  return {
    type: "campaigns", objectKind: "records",
    toCreate: preview.recordsToCreate.length, toUpdate: preview.recordsToUpdate.length,
    extra: `${preview.collectionsToCreate.length} collection(s) to create`,
  };
}

async function previewLetters(): Promise<TypePreviewSummary> {
  const snapshot = await letters.takePreImportSnapshot();
  const preview = await letters.buildImportPreview(MODE, snapshot);
  return {
    type: "letters", objectKind: "records",
    toCreate: preview.recordsToCreate.length, toUpdate: preview.recordsToUpdate.length,
    extra: `${preview.collectionsToCreate.length} collection(s) to create`,
  };
}

async function previewFormations(): Promise<TypePreviewSummary> {
  const snapshot = await formations.takePreImportSnapshot();
  const preview = await formations.buildImportPreview(MODE, snapshot);
  return {
    type: "formations", objectKind: "records",
    toCreate: preview.recordsToCreate.length, toUpdate: preview.recordsToUpdate.length,
  };
}

async function previewPersonnel(): Promise<TypePreviewSummary> {
  const snapshot = await personnel.takePreEntityImportSnapshot();
  const preview = await personnel.buildEntityImportPreview(MODE, snapshot);
  return {
    type: "personnel", objectKind: "entities",
    toCreate: preview.recordsToCreate.length, toUpdate: preview.recordsToUpdate.length,
    extra: `${preview.relationshipCount} Personnel-to-Personnel relationship(s) to create`,
  };
}

async function previewTimeline(): Promise<TypePreviewSummary> {
  const snapshot = await timeline.takePreImportSnapshot();
  const preview = await timeline.buildImportPreview(MODE, snapshot);
  return {
    type: "timeline", objectKind: "timelineEvents",
    toCreate: preview.eventsToCreate.length, toUpdate: preview.eventsToUpdate.length,
  };
}

async function buildPreview(): Promise<TypePreviewSummary[]> {
  return [
    await previewArmaments(),
    await previewArticles(),
    await previewCampaigns(),
    await previewLetters(),
    await previewFormations(),
    await previewPersonnel(),
    await previewTimeline(),
  ];
}

function printPreview(summaries: TypePreviewSummary[]): void {
  console.log("\n── Recovery preview — objects that WILL be restored ──\n");
  let totalCreate = 0;
  for (const s of summaries) {
    totalCreate += s.toCreate;
    console.log(
      `  ${s.type.padEnd(11)} (${s.objectKind.padEnd(13)}): ${String(s.toCreate).padStart(3)} to create, ` +
      `${String(s.toUpdate).padStart(3)} already present${s.extra ? ` — ${s.extra}` : ""}`,
    );
  }
  console.log(`\n  TOTAL new objects to create: ${totalCreate}\n`);
}

async function runAll(): Promise<TypeRunSummary[]> {
  const results: TypeRunSummary[] = [];

  const attempt = async <T extends { status: string; error?: string; runId?: string }>(
    type: string,
    fn: () => Promise<T>,
    countKeys: { created: keyof T; skipped: keyof T; invalid?: keyof T },
  ) => {
    try {
      const r = await fn();
      const created = Array.isArray(r[countKeys.created]) ? (r[countKeys.created] as unknown[]).length : 0;
      const skipped = Array.isArray(r[countKeys.skipped]) ? (r[countKeys.skipped] as unknown[]).length : 0;
      const invalid = countKeys.invalid && Array.isArray(r[countKeys.invalid]) ? (r[countKeys.invalid] as unknown[]).length : 0;
      results.push({ type, status: r.status, created, skipped, invalidOrErrors: invalid, runId: r.runId ?? "" });
    } catch (err) {
      results.push({ type, status: "failed", created: 0, skipped: 0, invalidOrErrors: 0, runId: "", error: (err as Error).message });
    }
  };

  await attempt("armaments", () => armaments.runArmamentsImport({ mode: MODE, confirmExecution: true }), { created: "recordsCreated", skipped: "recordsSkipped" });
  await attempt("articles", () => articles.runArticlesImport({ mode: MODE, confirmExecution: true }), { created: "recordsCreated", skipped: "recordsSkipped" });
  await attempt("campaigns", () => campaigns.runCampaignsImport({ mode: MODE, confirmExecution: true }), { created: "recordsCreated", skipped: "recordsSkipped" });
  await attempt("letters", () => letters.runLettersImport({ mode: MODE, confirmExecution: true }), { created: "recordsCreated", skipped: "recordsSkipped" });
  await attempt("formations", () => formations.runFormationsImport({ mode: MODE, confirmExecution: true }), { created: "recordsCreated", skipped: "recordsSkipped", invalid: "recordsInvalid" });
  await attempt("personnel", () => personnel.runPersonnelImport({ mode: MODE, confirmExecution: true }), { created: "recordsCreated", skipped: "recordsSkipped" });
  await attempt("timeline", () => timeline.runTimelineImport({ mode: MODE, confirmExecution: true }), { created: "eventsCreated", skipped: "eventsSkipped", invalid: "eventsInvalid" });

  return results;
}

function printRunResults(results: TypeRunSummary[]): void {
  console.log("\n── Recovery run results — objects that WERE restored ──\n");
  let totalCreated = 0;
  for (const r of results) {
    totalCreated += r.created;
    console.log(
      `  ${r.type.padEnd(11)}: status=${r.status.padEnd(20)} created=${String(r.created).padStart(3)} ` +
      `skipped=${String(r.skipped).padStart(3)} invalid=${String(r.invalidOrErrors).padStart(3)}` +
      (r.error ? `  ERROR: ${r.error}` : ""),
    );
  }
  console.log(`\n  TOTAL objects created: ${totalCreated}\n`);
}

async function writeRecoveryReport(mode: "preview" | "execute", preview: TypePreviewSummary[], run?: TypeRunSummary[]): Promise<string> {
  const runId = new Date().toISOString().replace(/[:.]/g, "-");
  const outDir = path.join(storageConfig.directories.importReports, "recovery", runId);
  await fs.mkdir(outDir, { recursive: true });
  const report = { generatedAt: new Date().toISOString(), mode, preview, run: run ?? null };
  await fs.writeFile(path.join(outDir, "recovery-report.json"), JSON.stringify(report, null, 2));
  return path.join(outDir, "recovery-report.json");
}

async function main() {
  const execute = process.argv.includes("--execute");

  const preview = await buildPreview();
  printPreview(preview);

  if (!execute) {
    console.log("Preview-only run (default). Pass --execute to actually write to the database.");
    console.log("Note: --execute additionally requires each importer's own EXECUTION_ENABLED flag to be true.");
    const reportPath = await writeRecoveryReport("preview", preview);
    console.log(`Preview report written to ${reportPath}`);
    return;
  }

  const run = await runAll();
  printRunResults(run);
  const reportPath = await writeRecoveryReport("execute", preview, run);
  console.log(`Recovery report written to ${reportPath}`);
}

main()
  .catch((err) => { console.error(err); process.exit(1); })
  .finally(async () => {
    const prisma = (await import("../../database/prisma")).default;
    await prisma.$disconnect();
  });
