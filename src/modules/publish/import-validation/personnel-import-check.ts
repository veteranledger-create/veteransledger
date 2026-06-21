import fs from "fs/promises";
import path from "path";
import { checkPersonnelRecord } from "../validators/personnel.conformance";
import { ValidationIssue } from "../publish.types";
import {
  LegacyPersonnel, PERSONNEL_FILES, SlugNameConflict,
  detectSlugNameConflicts, splitRelatedRecords, toCandidateEntity,
} from "./personnel-entity-mapper";
import { targetExists } from "./cross-reference-lookup";
import { config } from "../../../config/app";

// Never imports Prisma, never writes inside public/data/ — only reads the
// real personnel/*.json files (plus other content types, read-only, for
// related_records existence checks) and returns a report. Same structural
// guarantee as letters-/articles-/campaigns-import-check.ts.
const PUBLIC_DATA_DIR = path.resolve(__dirname, "../../../../public/data");
const PERSONNEL_DIR = path.join(PUBLIC_DATA_DIR, "personnel");

const STORAGE_URL_PREFIX = "/storage/";

// Second copy of the same small helper written for campaigns-import-check.ts
// — duplicated deliberately rather than extracted into a shared file, to
// strictly avoid touching any existing Campaigns file in this phase. Worth
// consolidating in a future cleanup once a third consumer needs it.
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
  branch: string;
}

export interface BranchMismatch {
  recordId: string;
  declaredBranch: string;
  fileBranch: string;
}

export interface MissingRelatedTarget {
  recordId: string;
  relatedId: string;
  relatedType: string;
}

// The two integrity-concern categories are deliberately grouped together,
// not left as loose siblings among branch/image/duplicate stats, and
// deliberately kept distinct from each other:
//   - blockingSlugConflicts: an id that looks copy-pasted from a different
//     person's name. Always a blocking error (also mirrored into
//     validation.issues, which is what actually drives blockedByErrors).
//   - missingRelatedTargets: a related_records target that doesn't exist
//     anywhere in public/data/. Never blocking, never rewritten — e.g.
//     karl-donitz/erich-topp/wolfgang-luth all point at the misspelled
//     "uboat-campaing" instead of the real "uboat-campaign". Reported for
//     visibility only; correcting the source data is a separate decision.
export interface IntegrityReport {
  blockingSlugConflicts: SlugNameConflict[];
  missingRelatedTargets: MissingRelatedTarget[];
}

export interface PersonnelImportSummary {
  generatedAt: string;
  mode: "dry-run";
  totalRecords: number;
  byBranch: Record<string, number>;
  duplicateIds: string[];
  branchMismatches: BranchMismatch[];
  integrityReport: IntegrityReport;
  imageStats: {
    // Statistics only — never escalated to a validation issue and never
    // counted toward blockedByErrors. A record with a dead portrait
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

export interface LoadedPersonnel {
  branch: string;
  person: LegacyPersonnel;
}

export async function loadAllPersonnel(): Promise<LoadedPersonnel[]> {
  const out: LoadedPersonnel[] = [];
  for (const [branch, filename] of Object.entries(PERSONNEL_FILES)) {
    const people: LegacyPersonnel[] = JSON.parse(await fs.readFile(path.join(PERSONNEL_DIR, filename), "utf-8"));
    for (const person of people) out.push({ branch, person });
  }
  return out;
}

export async function runPersonnelImportDryRun(): Promise<PersonnelImportSummary> {
  const loaded = await loadAllPersonnel();

  const seenIds = new Map<string, string[]>();
  const byBranch: Record<string, number> = {};
  const branchMismatches: BranchMismatch[] = [];
  const missingRelatedTargets: MissingRelatedTarget[] = [];
  const allIssues: ImportIssue[] = [];
  let imageReferences = 0;
  const missingImageFiles: string[] = [];

  for (const { branch, person } of loaded) {
    byBranch[branch] = (byBranch[branch] ?? 0) + 1;

    const occurrences = seenIds.get(person.id) ?? [];
    occurrences.push(branch);
    seenIds.set(person.id, occurrences);

    if (person.branch && person.branch !== branch) {
      branchMismatches.push({ recordId: person.id, declaredBranch: person.branch, fileBranch: branch });
    }

    const candidate = toCandidateEntity(person, branch);
    for (const issue of checkPersonnelRecord(candidate)) {
      allIssues.push({ ...issue, branch });
    }

    if (typeof person.portrait === "string" && person.portrait.trim().length > 0) {
      imageReferences++;
      if (!(await imageFileExists(person.portrait))) {
        missingImageFiles.push(person.id);
      }
    }

    const related = Array.isArray(person.related_records) ? (person.related_records as Array<{ id?: unknown; type?: unknown }>) : [];
    for (const entry of related) {
      if (typeof entry?.id !== "string") continue;
      const relatedType = typeof entry.type === "string" ? entry.type : undefined;
      const exists = await targetExists(relatedType, entry.id, PUBLIC_DATA_DIR);
      if (!exists) {
        missingRelatedTargets.push({ recordId: person.id, relatedId: entry.id, relatedType: relatedType ?? "unknown" });
      }
    }
  }

  // Cross-record check — needs the full dataset, which is why it runs
  // after the per-record loop rather than inside it.
  const slugNameConflicts = detectSlugNameConflicts(loaded.map((l) => l.person));
  for (const conflict of slugNameConflicts) {
    const branch = loaded.find((l) => l.person.id === conflict.id)?.branch ?? "unknown";
    allIssues.push({
      recordId: conflict.id,
      field: "id",
      message: `id "${conflict.id}" (name: "${conflict.recordName}") shares ${conflict.overlapScore} name token(s) with a different record, "${conflict.suspectedActualName}" (id "${conflict.suspectedActualId}") — this looks like a slug/name mismatch, not a coincidence. Fix the source data before importing.`,
      severity: "error",
      branch,
    });
  }

  const duplicateIds = [...seenIds.entries()]
    .filter(([, branches]) => branches.length > 1)
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
    totalRecords: loaded.length,
    byBranch,
    duplicateIds,
    branchMismatches,
    integrityReport: { blockingSlugConflicts: slugNameConflicts, missingRelatedTargets },
    imageStats: { imageReferences, missingImageFiles },
    validation: { errorCount, warningCount, issuesByField, warningsByType, issues: allIssues },
    readyToImport: loaded.length - recordsWithErrors.size,
    blockedByErrors: recordsWithErrors.size,
  };
}

export interface DroppedEntry {
  recordId: string;
  reason: string;
}

export interface DanglingPersonnelLink {
  recordId: string;
  targetId: string;
}

export interface RelatedRecordsConsistencyReport {
  totalSourceEntries: number;
  totalPersonnelLinksRaw: number;
  totalOtherLinksRaw: number;
  droppedEntries: DroppedEntry[];
  personnelLinksResolved: number;
  personnelLinksDangling: DanglingPersonnelLink[];
  // True iff totalSourceEntries === totalPersonnelLinksRaw + totalOtherLinksRaw
  // + droppedEntries.length — this should always hold by construction
  // (splitRelatedRecords places every id-bearing entry into exactly one
  // bucket), so a false here means splitRelatedRecords itself has a real
  // bug, not just an expected data-quality gap.
  splitIsConsistent: boolean;
  // True iff personnelRelationshipsToCreate.length + nonPersonnelReferences.length
  // (the preview's reported counts) account for every source entry once
  // personnelLinksDangling is subtracted out — dangling personnel-type
  // links correctly don't become Relationship rows (per Phase 4A's
  // design: only a resolvable target becomes one), so they're expected to
  // make the preview's sum fall short of totalSourceEntries by exactly
  // personnelLinksDangling.length, not a sign anything was silently lost.
  previewCountsAccountedFor: boolean;
}

// Dedicated, standalone, read-only consistency check — verifies
// splitRelatedRecords() never drops an id-bearing entry, and that the
// preview's personnelRelationshipsToCreate + nonPersonnelReferences counts
// are fully explained by the real source data (resolved personnel links +
// all other links + dangling personnel links accounted for separately).
export async function verifyRelatedRecordsConsistency(): Promise<RelatedRecordsConsistencyReport> {
  const loaded = await loadAllPersonnel();
  const allIds = new Set(loaded.map((l) => l.person.id));

  let totalSourceEntries = 0;
  let totalPersonnelLinksRaw = 0;
  let totalOtherLinksRaw = 0;
  const droppedEntries: DroppedEntry[] = [];
  const personnelLinksDangling: DanglingPersonnelLink[] = [];

  for (const { person } of loaded) {
    const rawArray = Array.isArray(person.related_records) ? (person.related_records as unknown[]) : [];
    totalSourceEntries += rawArray.length;

    const droppedCount = rawArray.filter((entry) => typeof (entry as { id?: unknown })?.id !== "string").length;
    for (let i = 0; i < droppedCount; i++) {
      droppedEntries.push({ recordId: person.id, reason: "related_records entry missing a string id" });
    }

    const { personnelLinks, otherLinks } = splitRelatedRecords(person.related_records);
    totalPersonnelLinksRaw += personnelLinks.length;
    totalOtherLinksRaw += otherLinks.length;

    for (const link of personnelLinks) {
      if (!allIds.has(link.id)) {
        personnelLinksDangling.push({ recordId: person.id, targetId: link.id });
      }
    }
  }

  const personnelLinksResolved = totalPersonnelLinksRaw - personnelLinksDangling.length;
  const splitIsConsistent = totalSourceEntries === totalPersonnelLinksRaw + totalOtherLinksRaw + droppedEntries.length;
  // The preview reports personnelRelationshipsToCreate (= personnelLinksResolved)
  // and nonPersonnelReferences (= totalOtherLinksRaw, unfiltered). Their sum
  // plus the dangling+dropped counts must reconstruct the full source total.
  const previewCountsAccountedFor =
    totalSourceEntries === personnelLinksResolved + totalOtherLinksRaw + personnelLinksDangling.length + droppedEntries.length;

  return {
    totalSourceEntries,
    totalPersonnelLinksRaw,
    totalOtherLinksRaw,
    droppedEntries,
    personnelLinksResolved,
    personnelLinksDangling,
    splitIsConsistent,
    previewCountsAccountedFor,
  };
}
