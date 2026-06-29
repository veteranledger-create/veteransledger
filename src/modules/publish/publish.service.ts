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
import { checkPersonnelRecord } from "./validators/personnel.conformance";
import { toPersonnelJson } from "./generators/personnel.generator";
import { checkCampaignRecord } from "./validators/campaigns.conformance";
import { toCampaignJson } from "./generators/campaigns.generator";
import { checkArticleRecord } from "./validators/articles.conformance";
import { toArticleJson } from "./generators/articles.generator";
import { checkTimelineEvent, toTimelineJson, TimelineEventRow } from "./validators/timeline.conformance";
import { checkAwardRecord } from "./validators/awards.conformance";
import { toAwardJson } from "./generators/awards.generator";
import { checkMapRecord } from "./validators/maps.conformance";
import { toMapJson } from "./generators/maps.generator";
import { checkPoliticalDocRecord } from "./validators/political-docs.conformance";
import { toPoliticalDocJson } from "./generators/political-docs.generator";
import { checkFormationRecord } from "./validators/formations.conformance";
import { toFormationJson, SECTION_TO_FILE } from "./generators/formations.generator";
import { checkNsdapFiles } from "./validators/nsdap.conformance";
import { PERSONNEL_FILES, RelatedRecordEntry } from "./import-validation/personnel-entity-mapper";
import { writeStagedFilesAtomically } from "./atomic-stage-writer";
import { normalizeArmamentName } from "../armaments/admin-duplicate-check";

// See src/validators/publish.validator.ts for the allow-list that gates
// which `:type` values reach this service at all — keep both in sync.
const SUPPORTED_TYPES = ["letters", "armaments", "personnel", "campaigns", "articles", "timeline", "awards", "maps", "political-docs", "formations", "nsdap"] as const;
type SupportedType = (typeof SUPPORTED_TYPES)[number];

// Narrow row shape returned by the personnel Prisma query — includes the
// relation rows needed by toPersonnelJson to resolve Personnel-to-Personnel links.
// The Relationship model uses `to` (not `toEntity`) — see prisma/schema.prisma.
type PersonnelRow = {
  id: string; name: string; slug: string | null; nationality: string | null;
  birthDate: Date | null; deathDate: Date | null; biography: string | null;
  summary: string | null; tags: string[]; metadata: unknown; published: boolean;
  relationsFrom: Array<{ to: { id: string; slug: string | null; name: string } }>;
};

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

  private async loadPublishedCampaigns(): Promise<RecordLike[]> {
    const rows = await prisma.record.findMany({
      where: { type: "CAMPAIGN", published: true },
      orderBy: { startDate: "asc" },
    });
    return rows.map(toRecordLike);
  }

  private async loadPublishedArticles(): Promise<RecordLike[]> {
    const rows = await prisma.record.findMany({
      where: { type: "ARTICLE", published: true },
      orderBy: { createdAt: "desc" },
    });
    return rows.map(toRecordLike);
  }

  private checkAllRecords(
    records: RecordLike[],
    checkFn: (r: RecordLike) => ValidationIssue[],
  ): { valid: RecordLike[]; issues: ValidationIssue[] } {
    const issues: ValidationIssue[] = [];
    const valid: RecordLike[] = [];
    for (const record of records) {
      const recordIssues = checkFn(record);
      issues.push(...recordIssues);
      if (!recordIssues.some((i) => i.severity === "error")) valid.push(record);
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

  private async loadPublishedPersonnel(): Promise<PersonnelRow[]> {
    return prisma.entity.findMany({
      where: { type: "PERSON", published: true },
      orderBy: { name: "asc" },
      include: { relationsFrom: { include: { to: true } } },
    }) as unknown as Promise<PersonnelRow[]>;
  }

  private checkAllPersonnel(entities: PersonnelRow[]): { valid: PersonnelRow[]; issues: ValidationIssue[] } {
    const issues: ValidationIssue[] = [];
    const valid: PersonnelRow[] = [];
    for (const entity of entities) {
      const entityLike = {
        id: entity.id, slug: entity.slug, name: entity.name,
        nationality: entity.nationality, birthDate: entity.birthDate,
        deathDate: entity.deathDate, biography: entity.biography,
        summary: entity.summary, tags: entity.tags,
        metadata: (entity.metadata as Record<string, unknown>) ?? null,
        published: entity.published,
      };
      const recordIssues = checkPersonnelRecord(entityLike);
      issues.push(...recordIssues);
      if (!recordIssues.some((i) => i.severity === "error")) valid.push(entity);
    }
    return { valid, issues };
  }

  private generatePersonnelFiles(entities: PersonnelRow[]): Map<string, string> {
    const byBranch = new Map<string, unknown[]>();
    for (const entity of entities) {
      const branch = ((entity.metadata as Record<string, unknown>)?.branch as string) ?? "foreign";
      const fileName = PERSONNEL_FILES[branch] ?? PERSONNEL_FILES.foreign;
      const branchKey = fileName.replace(".json", "");
      const entityLike = {
        id: entity.id, slug: entity.slug, name: entity.name,
        nationality: entity.nationality, birthDate: entity.birthDate,
        deathDate: entity.deathDate, biography: entity.biography,
        summary: entity.summary, tags: entity.tags,
        metadata: (entity.metadata as Record<string, unknown>) ?? null,
        published: entity.published,
      };
      const links: RelatedRecordEntry[] = entity.relationsFrom
        .map((r) => ({ id: r.to.slug ?? r.to.id, title: r.to.name, type: "Personnel" as const, url: undefined }));
      const group = byBranch.get(branchKey) ?? [];
      group.push(toPersonnelJson(entityLike, links));
      byBranch.set(branchKey, group);
    }
    const filesToWrite = new Map<string, string>();
    for (const [key, entries] of byBranch) {
      filesToWrite.set(`${key}.json`, JSON.stringify(entries, null, 2));
    }
    return filesToWrite;
  }

  private async loadPublishedAwards(): Promise<RecordLike[]> {
    const rows = await prisma.record.findMany({ where: { type: "AWARD", published: true }, orderBy: { title: "asc" } });
    return rows.map(toRecordLike);
  }

  private async loadPublishedMaps(): Promise<RecordLike[]> {
    const rows = await prisma.record.findMany({ where: { type: "MAP", published: true }, orderBy: { title: "asc" } });
    return rows.map(toRecordLike);
  }

  private async loadPublishedPoliticalDocs(): Promise<RecordLike[]> {
    const rows = await prisma.record.findMany({ where: { type: "POLITICAL_DOCUMENT", published: true }, orderBy: { date: "asc" } });
    return rows.map(toRecordLike);
  }

  private async loadPublishedFormations(): Promise<RecordLike[]> {
    const rows = await prisma.record.findMany({ where: { type: "FORMATION", published: true }, orderBy: { title: "asc" } });
    return rows.map(toRecordLike);
  }

  // Reads all NSDAP JSON files from public/data/nsdap/ for pipeline validation.
  // Returns a Map of relPath → raw JSON string.
  private async loadNsdapFiles(): Promise<Map<string, string>> {
    const resolvedDir = path.resolve(process.cwd(), "public", "data", "nsdap");
    const result = new Map<string, string>();
    const readDir = async (dir: string, base: string) => {
      let entries: import("fs").Dirent[];
      try { entries = await fs.readdir(dir, { withFileTypes: true }); } catch { return; }
      for (const e of entries) {
        const fullPath = path.join(dir, e.name);
        if (e.isDirectory()) { await readDir(fullPath, base); continue; }
        if (!e.name.endsWith(".json")) continue;
        const rel = path.relative(base, fullPath).replace(/\\/g, "/");
        try { result.set(rel, await fs.readFile(fullPath, "utf-8")); } catch { /* skip */ }
      }
    };
    await readDir(resolvedDir, resolvedDir);
    return result;
  }

  private async loadPublishedTimeline(): Promise<TimelineEventRow[]> {
    return prisma.timelineEvent.findMany({
      where: { published: true },
      orderBy: [{ year: "asc" }, { date: "asc" }, { title: "asc" }],
    }) as unknown as Promise<TimelineEventRow[]>;
  }

  private checkAllTimeline(events: TimelineEventRow[]): { valid: TimelineEventRow[]; issues: ValidationIssue[] } {
    const issues: ValidationIssue[] = [];
    const valid: TimelineEventRow[] = [];
    for (const ev of events) {
      const evIssues = checkTimelineEvent(ev);
      issues.push(...evIssues);
      if (!evIssues.some((i) => i.severity === "error")) valid.push(ev);
    }
    return { valid, issues };
  }

  private generateTimelineFiles(events: TimelineEventRow[]): Map<string, string> {
    const output = events.map((ev) => toTimelineJson(ev));
    const content = JSON.stringify({ events: output, generatedAt: new Date().toISOString() }, null, 2);
    return new Map([["events.json", content]]);
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
    if (type === "campaigns") {
      const records = await this.loadPublishedCampaigns();
      const { valid, issues } = this.checkAllRecords(records, checkCampaignRecord);
      return { records, valid, issues };
    }
    if (type === "articles") {
      const records = await this.loadPublishedArticles();
      const { valid, issues } = this.checkAllRecords(records, checkArticleRecord);
      return { records, valid, issues };
    }
    if (type === "awards") {
      const records = await this.loadPublishedAwards();
      const { valid, issues } = this.checkAllRecords(records, checkAwardRecord);
      return { records, valid, issues };
    }
    if (type === "maps") {
      const records = await this.loadPublishedMaps();
      const { valid, issues } = this.checkAllRecords(records, checkMapRecord);
      return { records, valid, issues };
    }
    if (type === "political-docs") {
      const records = await this.loadPublishedPoliticalDocs();
      const { valid, issues } = this.checkAllRecords(records, checkPoliticalDocRecord);
      return { records, valid, issues };
    }
    if (type === "formations") {
      const records = await this.loadPublishedFormations();
      const { valid, issues } = this.checkAllRecords(records, checkFormationRecord);
      return { records, valid, issues };
    }
    const records = await this.loadPublishedLetters();
    const { valid, issues } = this.checkAllRecords(records, checkLetterRecord);
    return { records, valid, issues };
  }

  // Dry run: load + validate only, never writes a staged content file.
  // Still persists its report and logs an audit entry — a validation pass
  // is part of the publish history too.
  async validate(type: string, userId: string): Promise<PublishReport> {
    this.assertSupported(type);
    const runId = randomUUID();

    let recordsChecked: number;
    let validCount: number;
    let issues: ValidationIssue[];

    if (type === "personnel") {
      const entities = await this.loadPublishedPersonnel();
      const result = this.checkAllPersonnel(entities);
      recordsChecked = entities.length;
      validCount = result.valid.length;
      issues = result.issues;
    } else if (type === "timeline") {
      const events = await this.loadPublishedTimeline();
      const result = this.checkAllTimeline(events);
      recordsChecked = events.length;
      validCount = result.valid.length;
      issues = result.issues;
    } else if (type === "nsdap") {
      const nsdapFiles = await this.loadNsdapFiles();
      issues = checkNsdapFiles(nsdapFiles);
      recordsChecked = nsdapFiles.size;
      const errorFiles = new Set(issues.filter((i) => i.severity === "error").map((i) => i.recordId));
      validCount = [...nsdapFiles.keys()].filter((f) => !errorFiles.has(f)).length;
    } else {
      const res = await this.loadAndCheck(type as SupportedType);
      recordsChecked = res.records.length;
      validCount = res.valid.length;
      issues = res.issues;
    }

    const report: PublishReport = {
      runId, type, mode: "validate", status: "success",
      generatedAt: new Date().toISOString(),
      recordsChecked, valid: validCount, invalid: recordsChecked - validCount,
      issues, stats: computeStats(issues), staged: [],
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

    if (type === "campaigns") {
      // One file per campaign at {theater}/{slug}.json — matches the
      // existing public/data/campaigns/ directory structure and the
      // file-per-record pattern the frontend's FILE_MAP already uses.
      for (const record of valid) {
        const theater = (record.metadata?.theater as string) ?? "uncategorized";
        const slug = record.slug ?? record.id;
        const json = toCampaignJson(record);
        filesToWrite.set(`${theater}/${slug}.json`, JSON.stringify(json, null, 2));
      }
      return filesToWrite;
    }

    if (type === "articles") {
      // One file per article at {category}/{slug}.json — matches the
      // file-per-record pattern the frontend's CATEGORIES.files array uses.
      for (const record of valid) {
        const category = (record.metadata?.category as string) ?? "uncategorized";
        const slug = record.slug ?? record.id;
        const json = toArticleJson(record);
        filesToWrite.set(`${category}/${slug}.json`, JSON.stringify(json, null, 2));
      }
      return filesToWrite;
    }

    if (type === "awards") {
      for (const record of valid) {
        const slug = record.slug ?? record.id;
        filesToWrite.set(`${slug}.json`, JSON.stringify(toAwardJson(record), null, 2));
      }
      return filesToWrite;
    }

    if (type === "maps") {
      for (const record of valid) {
        const slug = record.slug ?? record.id;
        filesToWrite.set(`${slug}.json`, JSON.stringify(toMapJson(record), null, 2));
      }
      return filesToWrite;
    }

    if (type === "political-docs") {
      for (const record of valid) {
        const slug = record.slug ?? record.id;
        filesToWrite.set(`${slug}.json`, JSON.stringify(toPoliticalDocJson(record), null, 2));
      }
      return filesToWrite;
    }

    if (type === "formations") {
      // Group by section → category file (e.g. germany/army-groups.json).
      // Categories with no valid records produce empty arrays — this ensures
      // previously-populated files get cleared if all their records are removed.
      const byFile = new Map<string, unknown[]>();
      for (const record of valid) {
        const section = (record.metadata?.section as string) ?? "unknown";
        const file = SECTION_TO_FILE[section] ?? `germany/${section}.json`;
        const group = byFile.get(file) ?? [];
        group.push(toFormationJson(record));
        byFile.set(file, group);
      }
      for (const [file, entries] of byFile) {
        filesToWrite.set(file, JSON.stringify(entries, null, 2));
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
    this.assertSupported(type);
    const runId = randomUUID();

    let recordsChecked: number;
    let validCount: number;
    let issues: ValidationIssue[];
    let filesToWrite: Map<string, string>;

    if (type === "personnel") {
      const entities = await this.loadPublishedPersonnel();
      const result = this.checkAllPersonnel(entities);
      recordsChecked = entities.length;
      validCount = result.valid.length;
      issues = result.issues;
      filesToWrite = this.generatePersonnelFiles(result.valid);
    } else if (type === "timeline") {
      const events = await this.loadPublishedTimeline();
      const result = this.checkAllTimeline(events);
      recordsChecked = events.length;
      validCount = result.valid.length;
      issues = result.issues;
      filesToWrite = this.generateTimelineFiles(result.valid);
    } else if (type === "nsdap") {
      // File-based type: read live NSDAP files, validate, then stage byte-for-byte
      // copies (snapshot). Promote copies staged → live (no-op if unchanged).
      // Primary value is the snapshot which enables rollback.
      const nsdapFiles = await this.loadNsdapFiles();
      issues = checkNsdapFiles(nsdapFiles);
      recordsChecked = nsdapFiles.size;
      const errorFiles = new Set(issues.filter((i) => i.severity === "error").map((i) => i.recordId));
      validCount = [...nsdapFiles.keys()].filter((f) => !errorFiles.has(f)).length;
      filesToWrite = new Map(nsdapFiles);
    } else {
      const res = await this.loadAndCheck(type as SupportedType);
      recordsChecked = res.records.length;
      validCount = res.valid.length;
      issues = res.issues;
      filesToWrite = this.generateFiles(type as SupportedType, res.valid);
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
      runId, type, mode: "run", status,
      ...(error ? { error } : {}),
      generatedAt: new Date().toISOString(),
      recordsChecked, valid: validCount, invalid: recordsChecked - validCount,
      issues, stats: computeStats(issues), staged,
    };

    await this.persistReport(report);
    await this.logAudit(userId, "PUBLISH_RUN", report);

    if (status === "failed") {
      throw new AppError(500, `Publish run failed to write staged output: ${error}`);
    }
    return report;
  }
}
