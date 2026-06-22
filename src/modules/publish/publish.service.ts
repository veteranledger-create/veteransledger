import fs from "fs/promises";
import path from "path";
import { randomUUID } from "crypto";
import prisma from "../../database/prisma";
import { AppError } from "../../middleware/error.middleware";
import { storageConfig } from "../../config/storage";
import { PublishReport, RecordLike, ValidationIssue, ValidationStats } from "./publish.types";
import { checkLetterRecord } from "./validators/letters.conformance";
import { toLetterJson, resolveCollectionKey } from "./generators/letters.generator";
import { checkArmamentRecord } from "./validators/armaments.conformance";
import { toArmamentJson } from "./generators/armaments.generator";
import { writeStagedFilesAtomically } from "./atomic-stage-writer";
import { normalizeArmamentName } from "../armaments/admin-duplicate-check";

// See src/validators/publish.validator.ts for the allow-list that gates
// which `:type` values reach this service at all — keep both in sync.
const SUPPORTED_TYPES = ["letters", "armaments"] as const;
type SupportedType = (typeof SUPPORTED_TYPES)[number];

// Exported — generic across content types, not Letters-specific. Reused
// directly by the Armaments admin preview endpoint so preview renders via
// the exact same conversion path publish itself uses, rather than a
// second implementation that could drift from it.
export function toRecordLike(row: {
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

  private async loadPublishedArmaments(): Promise<RecordLike[]> {
    const rows = await prisma.record.findMany({
      where: { type: "ARMAMENT", published: true },
      orderBy: { title: "asc" },
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

  // Two gates, both required: per-record conformance (checkArmamentRecord,
  // reused unchanged from the migration pipeline), and a cross-record
  // admin-duplicate scan — deliberately NOT the migration's
  // DUPLICATE_RESOLUTIONS table, which is keyed by category/fileNation/name
  // and has no meaning for admin-authored content with no file origin.
  // Scoped by category + normalized name, exactly as approved.
  private checkAllArmaments(records: RecordLike[]): { valid: RecordLike[]; issues: ValidationIssue[] } {
    const issues: ValidationIssue[] = [];
    const errorIds = new Set<string>();

    for (const record of records) {
      const recordIssues = checkArmamentRecord(record);
      issues.push(...recordIssues);
      if (recordIssues.some((i) => i.severity === "error")) errorIds.add(record.id);
    }

    const byCategoryAndName = new Map<string, RecordLike[]>();
    for (const record of records) {
      const category = (record.metadata?.category as string) ?? "unknown";
      const key = `${category}::${normalizeArmamentName(record.title)}`;
      const group = byCategoryAndName.get(key) ?? [];
      group.push(record);
      byCategoryAndName.set(key, group);
    }
    for (const group of byCategoryAndName.values()) {
      if (group.length <= 1) continue;
      for (const record of group) {
        const others = group.filter((r) => r.id !== record.id).map((r) => r.title);
        issues.push({
          recordId: record.id,
          field: "duplicate",
          message: `Possible duplicate: shares a normalized name with ${others.length} other published armament(s) in this category (${others.join(", ")}). Resolve by editing one record's title, unpublishing the duplicate, or merging manually before publish.`,
          severity: "error",
        });
        errorIds.add(record.id);
      }
    }

    return { valid: records.filter((r) => !errorIds.has(r.id)), issues };
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

  private async loadAndCheck(type: SupportedType): Promise<{ records: RecordLike[]; valid: RecordLike[]; issues: ValidationIssue[] }> {
    if (type === "armaments") {
      const records = await this.loadPublishedArmaments();
      const { valid, issues } = this.checkAllArmaments(records);
      return { records, valid, issues };
    }
    const records = await this.loadPublishedLetters();
    const { valid, issues } = this.checkAll(records);
    return { records, valid, issues };
  }

  // Dry run: load + validate only, never writes a staged content file.
  // Still persists its report and logs an audit entry — a validation pass
  // is part of the publish history too.
  async validate(type: string, userId: string): Promise<PublishReport> {
    const supported = this.assertSupported(type);
    const runId = randomUUID();
    const { records, valid, issues } = await this.loadAndCheck(supported);

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

  // Letters group by collection (the file a letter belongs to — distinct
  // from language, see letters.generator.ts). Armaments group by
  // category + a nation slug derived from the real nation value — never
  // the migration's "other-axis" folder grouping, since that was a
  // source-file artifact, not a design goal for fresh admin content.
  private generateFiles(type: SupportedType, valid: RecordLike[]): Map<string, string> {
    const filesToWrite = new Map<string, string>();

    if (type === "armaments") {
      const byGroup = new Map<string, unknown[]>();
      for (const record of valid) {
        const category = (record.metadata?.category as string) ?? "uncategorized";
        const nationSlug = (record.nationality ?? "unknown").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
        const key = `${category}/${nationSlug}`;
        const json = toArmamentJson(record);
        const group = byGroup.get(key) ?? [];
        group.push(json);
        byGroup.set(key, group);
      }
      for (const [key, entries] of byGroup) {
        filesToWrite.set(`${key}.json`, JSON.stringify(entries, null, 2));
      }
      return filesToWrite;
    }

    const byCollection = new Map<string, unknown[]>();
    for (const record of valid) {
      const collection = resolveCollectionKey(record);
      const json = toLetterJson(record);
      const group = byCollection.get(collection) ?? [];
      group.push(json);
      byCollection.set(collection, group);
    }
    for (const [collection, entries] of byCollection) {
      filesToWrite.set(`${collection}.json`, JSON.stringify(entries, null, 2));
    }
    return filesToWrite;
  }

  // Validates, generates, writes the whole output directory atomically
  // (see atomic-stage-writer.ts) — never touches public/data/, and a
  // failed write leaves any previous staged output exactly as it was
  // rather than half-overwritten. Same guarantee for every onboarded type.
  async run(type: string, userId: string): Promise<PublishReport> {
    const supported = this.assertSupported(type);
    const runId = randomUUID();
    const { records, valid, issues } = await this.loadAndCheck(supported);

    const filesToWrite = this.generateFiles(supported, valid);

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
