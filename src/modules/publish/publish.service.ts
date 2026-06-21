import fs from "fs/promises";
import path from "path";
import { randomUUID } from "crypto";
import prisma from "../../database/prisma";
import { AppError } from "../../middleware/error.middleware";
import { storageConfig } from "../../config/storage";
import { PublishReport, RecordLike, ValidationIssue, ValidationStats } from "./publish.types";
import { checkLetterRecord } from "./validators/letters.conformance";
import { toLetterJson, resolveCollectionKey } from "./generators/letters.generator";
import { writeStagedFilesAtomically } from "./atomic-stage-writer";

// Letters is the only onboarded type in Phase 0 — see src/validators/publish.validator.ts
// for the allow-list that gates which `:type` values reach this service at all.
const SUPPORTED_TYPES = ["letters"] as const;
type SupportedType = (typeof SUPPORTED_TYPES)[number];

function toRecordLike(row: {
  id: string;
  title: string;
  slug: string | null;
  summary: string | null;
  content: string | null;
  date: Date | null;
  nationality: string | null;
  tags: string[];
  metadata: unknown;
  published: boolean;
}): RecordLike {
  return {
    id: row.id,
    title: row.title,
    slug: row.slug,
    summary: row.summary,
    content: row.content,
    date: row.date,
    nationality: row.nationality,
    tags: row.tags,
    metadata: (row.metadata as Record<string, unknown> | null) ?? null,
    published: row.published,
  };
}

function computeStats(issues: ValidationIssue[]): ValidationStats {
  const issuesByField: Record<string, number> = {};
  let errorCount = 0;
  let warningCount = 0;
  for (const issue of issues) {
    issuesByField[issue.field] = (issuesByField[issue.field] ?? 0) + 1;
    if (issue.severity === "error") errorCount++;
    else warningCount++;
  }
  return { errorCount, warningCount, issuesByField };
}

export class PublishService {
  private assertSupported(type: string): SupportedType {
    if (!SUPPORTED_TYPES.includes(type as SupportedType)) {
      throw new AppError(400, `Unsupported publish type: ${type}. Supported: ${SUPPORTED_TYPES.join(", ")}`);
    }
    return type as SupportedType;
  }

  private async loadPublishedLetters(): Promise<RecordLike[]> {
    const rows = await prisma.record.findMany({
      where: { type: "LETTER", published: true },
      orderBy: { date: "asc" },
    });
    return rows.map(toRecordLike);
  }

  // Only error-severity issues exclude a record from generation — warnings
  // are collected for the report but a record with warnings only still
  // publishes. See letters.conformance.ts for which checks are which.
  private checkAll(records: RecordLike[]): { valid: RecordLike[]; issues: ValidationIssue[] } {
    const issues: ValidationIssue[] = [];
    const valid: RecordLike[] = [];
    for (const record of records) {
      const recordIssues = checkLetterRecord(record);
      issues.push(...recordIssues);
      const hasError = recordIssues.some((i) => i.severity === "error");
      if (!hasError) valid.push(record);
    }
    return { valid, issues };
  }

  private async persistReport(report: PublishReport): Promise<void> {
    const reportsDir = path.join(storageConfig.directories.publishReports, report.type);
    await fs.mkdir(reportsDir, { recursive: true });
    const body = JSON.stringify(report, null, 2);
    await fs.writeFile(path.join(reportsDir, `${report.runId}.json`), body, "utf-8");
    await fs.writeFile(path.join(reportsDir, "latest.json"), body, "utf-8");
  }

  private async logAudit(userId: string, action: "PUBLISH_VALIDATE" | "PUBLISH_RUN", report: PublishReport): Promise<void> {
    await prisma.auditLog.create({
      data: { userId, action, entity: "Record", entityId: report.runId, metadata: report as unknown as object },
    });
  }

  // Dry run: load + validate only, never writes a staged content file.
  // Still persists its report and logs an audit entry — a validation pass
  // is part of the publish history too.
  async validate(type: string, userId: string): Promise<PublishReport> {
    this.assertSupported(type);
    const runId = randomUUID();
    const records = await this.loadPublishedLetters();
    const { valid, issues } = this.checkAll(records);

    const report: PublishReport = {
      runId,
      type,
      mode: "validate",
      status: "success",
      generatedAt: new Date().toISOString(),
      recordsChecked: records.length,
      valid: valid.length,
      invalid: records.length - valid.length,
      issues,
      stats: computeStats(issues),
      staged: [],
    };

    await this.persistReport(report);
    await this.logAudit(userId, "PUBLISH_VALIDATE", report);
    return report;
  }

  // Validates, generates, groups by collection (the file a letter belongs
  // to — distinct from language, see letters.generator.ts), then writes
  // the whole output directory atomically (see atomic-stage-writer.ts) —
  // never touches public/data/, and a failed write leaves any previous
  // staged output exactly as it was rather than half-overwritten.
  async run(type: string, userId: string): Promise<PublishReport> {
    this.assertSupported(type);
    const runId = randomUUID();
    const records = await this.loadPublishedLetters();
    const { valid, issues } = this.checkAll(records);

    const byCollection = new Map<string, unknown[]>();
    for (const record of valid) {
      const collection = resolveCollectionKey(record);
      const json = toLetterJson(record);
      const group = byCollection.get(collection) ?? [];
      group.push(json);
      byCollection.set(collection, group);
    }

    const filesToWrite = new Map<string, string>();
    for (const [collection, entries] of byCollection) {
      filesToWrite.set(`${collection}.json`, JSON.stringify(entries, null, 2));
    }

    const outDir = path.join(storageConfig.directories.publishStaging, type);

    let staged: string[] = [];
    let status: "success" | "failed" = "success";
    let error: string | undefined;
    try {
      staged = await writeStagedFilesAtomically(outDir, filesToWrite);
    } catch (err) {
      status = "failed";
      error = (err as Error).message;
    }

    const report: PublishReport = {
      runId,
      type,
      mode: "run",
      status,
      ...(error ? { error } : {}),
      generatedAt: new Date().toISOString(),
      recordsChecked: records.length,
      valid: valid.length,
      invalid: records.length - valid.length,
      issues,
      stats: computeStats(issues),
      staged,
    };

    await this.persistReport(report);
    await this.logAudit(userId, "PUBLISH_RUN", report);

    if (status === "failed") {
      throw new AppError(500, `Publish run failed to write staged output: ${error}`);
    }
    return report;
  }
}
