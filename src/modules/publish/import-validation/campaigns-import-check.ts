import fs from "fs/promises";
import path from "path";
import { checkCampaignRecord } from "../validators/campaigns.conformance";
import { ValidationIssue } from "../publish.types";
import { CAMPAIGN_FILES, LegacyCampaign, toCandidateRecord } from "./campaign-record-mapper";
import { targetExists } from "./cross-reference-lookup";
import { config } from "../../../config/app";

// Never imports Prisma, never writes inside public/data/ — only reads the
// real campaigns/**/*.json files (plus other content types, read-only, for
// related_records existence checks) and returns a report. Same structural
// guarantee as letters-import-check.ts / articles-import-check.ts.
const PUBLIC_DATA_DIR = path.resolve(__dirname, "../../../../public/data");
const CAMPAIGNS_DIR = path.join(PUBLIC_DATA_DIR, "campaigns");

const STORAGE_URL_PREFIX = "/storage/";

// Checks for a real file on disk, never modifies a path — confirming
// whether a referenced image actually exists is the full extent of what
// this does. Paths that don't even look like a /storage/... URL can't be
// resolved to a filesystem location at all, so they're reported missing
// without attempting a guess.
async function imageFileExists(imagePath: string): Promise<boolean> {
  if (!imagePath.startsWith(STORAGE_URL_PREFIX)) return false;
  const relative = imagePath.slice(STORAGE_URL_PREFIX.length);
  try {
    await fs.access(path.join(config.paths.storage, relative));
    return true;
  } catch {
    return false;
  }
}

export interface ImportIssue extends ValidationIssue {
  theater: string;
}

export interface TheaterMismatch {
  recordId: string;
  declaredTheater: string;
  folderTheater: string;
}

export interface MissingRelatedTarget {
  recordId: string;
  relatedId: string;
  relatedType: string;
}

export interface CampaignImportSummary {
  generatedAt: string;
  mode: "dry-run";
  totalRecords: number;
  byTheater: Record<string, number>;
  duplicateIds: string[];
  theaterMismatches: TheaterMismatch[];
  missingRelatedTargets: MissingRelatedTarget[];
  imageStats: {
    // Statistics only — never escalated to a validation issue and never
    // counted toward blockedByErrors. A campaign with a dead image
    // reference still imports; the path itself is reported exactly as
    // found, never rewritten.
    imageReferences: number;
    missingImageFiles: string[];
  };
  validation: {
    errorCount: number;
    warningCount: number;
    issuesByField: Record<string, number>;
    warningsByType: Record<string, number>;
    issues: ImportIssue[];
  };
  readyToImport: number;
  blockedByErrors: number;
}

export async function runCampaignsImportDryRun(): Promise<CampaignImportSummary> {
  const seenIds = new Map<string, string[]>();
  const byTheater: Record<string, number> = {};
  const theaterMismatches: TheaterMismatch[] = [];
  const missingRelatedTargets: MissingRelatedTarget[] = [];
  const allIssues: ImportIssue[] = [];
  let imageReferences = 0;
  const missingImageFiles: string[] = [];
  let total = 0;

  for (const [theater, filenames] of Object.entries(CAMPAIGN_FILES)) {
    byTheater[theater] = 0;
    for (const filename of filenames) {
      const filePath = path.join(CAMPAIGNS_DIR, theater, filename);
      const campaign: LegacyCampaign = JSON.parse(await fs.readFile(filePath, "utf-8"));
      byTheater[theater]++;
      total++;

      const occurrences = seenIds.get(campaign.id) ?? [];
      occurrences.push(theater);
      seenIds.set(campaign.id, occurrences);

      if (campaign.theater && campaign.theater !== theater) {
        theaterMismatches.push({ recordId: campaign.id, declaredTheater: campaign.theater, folderTheater: theater });
      }

      const candidate = toCandidateRecord(campaign, theater);
      for (const issue of checkCampaignRecord(candidate)) {
        allIssues.push({ ...issue, theater });
      }

      if (typeof campaign.image === "string" && campaign.image.trim().length > 0) {
        imageReferences++;
        if (!(await imageFileExists(campaign.image))) {
          missingImageFiles.push(campaign.id);
        }
      }

      const related = Array.isArray(campaign.related_records) ? (campaign.related_records as Array<{ id?: unknown; type?: unknown }>) : [];
      for (const entry of related) {
        if (typeof entry?.id !== "string") continue;
        const relatedType = typeof entry.type === "string" ? entry.type : undefined;
        const exists = await targetExists(relatedType, entry.id, PUBLIC_DATA_DIR);
        if (!exists) {
          missingRelatedTargets.push({ recordId: campaign.id, relatedId: entry.id, relatedType: relatedType ?? "unknown" });
        }
      }
    }
  }

  const duplicateIds = [...seenIds.entries()]
    .filter(([, theaters]) => theaters.length > 1)
    .map(([id]) => id);

  const issuesByField: Record<string, number> = {};
  const warningsByType: Record<string, number> = {};
  let errorCount = 0;
  let warningCount = 0;
  for (const issue of allIssues) {
    issuesByField[issue.field] = (issuesByField[issue.field] ?? 0) + 1;
    if (issue.severity === "error") {
      errorCount++;
    } else {
      warningCount++;
      warningsByType[issue.field] = (warningsByType[issue.field] ?? 0) + 1;
    }
  }

  const recordsWithErrors = new Set(allIssues.filter((i) => i.severity === "error").map((i) => i.recordId));

  return {
    generatedAt: new Date().toISOString(),
    mode: "dry-run",
    totalRecords: total,
    byTheater,
    duplicateIds,
    theaterMismatches,
    missingRelatedTargets,
    imageStats: { imageReferences, missingImageFiles },
    validation: { errorCount, warningCount, issuesByField, warningsByType, issues: allIssues },
    readyToImport: total - recordsWithErrors.size,
    blockedByErrors: recordsWithErrors.size,
  };
}
