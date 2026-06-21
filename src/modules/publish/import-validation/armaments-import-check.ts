import fs from "fs/promises";
import path from "path";
import { checkArmamentRecord } from "../validators/armaments.conformance";
import { ValidationIssue } from "../publish.types";
import {
  CATEGORIES, NATIONS, LoadedArmament, IdCollision, DuplicateResolutionOutcome,
  applyDuplicateResolutions, assignIds, detectIdCollisions,
  extractItems, toCandidateRecord, DUPLICATE_RESOLUTIONS,
} from "./armament-record-mapper";

const ARMAMENTS_DIR = path.resolve(__dirname, "../../../../public/data/armaments");

export interface ImportIssue extends ValidationIssue {
  category: string;
}

export interface ResolvedDuplicateCheck {
  description: string;
  stillPresentAsIndependentRecord: boolean;
}

// Makes the previously-invisible failure mode observable: a rule that
// previously matched and now silently doesn't (donor renamed/removed,
// canonical renamed) shows up here as a non-zero rulesMissingDonor/
// rulesMissingCanonical count, or — if both are found but the merge still
// didn't apply anything — a blocking error via rulesApplied < rulesMatched.
export interface DuplicateResolutionReport {
  rulesExpected: number;
  rulesMatched: number;
  rulesMissingCanonical: number;
  rulesMissingDonor: number;
  rulesApplied: number;
  outcomes: DuplicateResolutionOutcome[];
}

export interface ArmamentImportSummary {
  generatedAt: string;
  mode: "dry-run";
  totalRecords: number;
  existingIdCount: number;
  synthesizedIdCount: number;
  byCategory: Record<string, number>;
  byFileNation: Record<string, number>;
  collectionsExpected: string[]; // composite category+fileNation slugs that have >=1 record
  idCollisions: IdCollision[];
  resolvedDuplicateChecks: ResolvedDuplicateCheck[];
  duplicateResolutionReport: DuplicateResolutionReport;
  validation: {
    errorCount: number;
    warningCount: number;
    issuesByField: Record<string, number>;
    issues: ImportIssue[];
  };
  readyToImport: number;
  blockedByErrors: number;
}

export async function loadAllArmaments(): Promise<LoadedArmament[]> {
  const out: LoadedArmament[] = [];
  for (const category of CATEGORIES) {
    for (const fileNation of NATIONS) {
      const filePath = path.join(ARMAMENTS_DIR, category, `${fileNation}.json`);
      const raw = JSON.parse(await fs.readFile(filePath, "utf-8"));
      const { items, schemaType } = extractItems(raw, category);
      for (const item of items) out.push({ category, fileNation, schemaType, item });
    }
  }
  return out;
}

export async function runArmamentsImportDryRun(): Promise<ArmamentImportSummary> {
  const loadedRaw = await loadAllArmaments();
  const { resolved, outcomes } = applyDuplicateResolutions(loadedRaw);
  const assigned = assignIds(resolved);

  const existingIdCount = loadedRaw.filter((l) => !!l.item.id).length;
  // Re-derived from the post-resolution set, not the raw pre-resolution
  // count — a donor entry excluded by a resolution rule never gets a
  // synthesized id at all, so this should read 49, not the original 53.
  const synthesizedIdCount = assigned.filter((a) => !a.item.id).length;

  const idCollisions = detectIdCollisions(assigned);

  const byCategory: Record<string, number> = {};
  const byFileNation: Record<string, number> = {};
  const collectionSet = new Set<string>();
  for (const a of assigned) {
    byCategory[a.category] = (byCategory[a.category] ?? 0) + 1;
    byFileNation[a.fileNation] = (byFileNation[a.fileNation] ?? 0) + 1;
    collectionSet.add(`armaments-${a.category}-${a.fileNation}`);
  }

  const allIssues: ImportIssue[] = [];
  for (const a of assigned) {
    const candidate = toCandidateRecord(a);
    for (const issue of checkArmamentRecord(candidate)) {
      allIssues.push({ ...issue, category: a.category });
    }
  }
  for (const collision of idCollisions) {
    for (const occ of collision.occurrences) {
      allIssues.push({
        recordId: collision.id,
        field: "id",
        message: `id "${collision.id}" is shared by ${collision.occurrences.length} records (${collision.occurrences.map((o) => `${o.category}/${o.fileNation}: "${o.name}"`).join("; ")}) — a real id collision, not handled by an approved duplicate resolution. Blocking until resolved.`,
        severity: "error",
        category: occ.category,
      });
    }
  }

  // Explicit, named confirmation that each of the four approved
  // resolutions actually took effect — not just trusting
  // applyDuplicateResolutions ran without error.
  const resolvedDuplicateChecks: ResolvedDuplicateCheck[] = [
    {
      description: "naval/other-axis.json 'Yamato' excluded (canonical: naval/japan.json id=yamato)",
      stillPresentAsIndependentRecord: assigned.some((a) => a.category === "naval" && a.fileNation === "other-axis" && a.item.name === "Yamato"),
    },
    {
      description: "naval/other-axis.json 'Shōkaku' excluded (canonical: naval/japan.json id=shokaku)",
      stillPresentAsIndependentRecord: assigned.some((a) => a.category === "naval" && a.fileNation === "other-axis" && a.item.name === "Shōkaku"),
    },
    {
      description: "missiles/italy.json Maiale donor excluded (canonical: wunderwaffen/italy.json)",
      stillPresentAsIndependentRecord: assigned.some((a) => a.category === "missiles" && a.fileNation === "italy" && a.item.name === "Siluro a Lenta Corsa (SLC) / 'Maiale'"),
    },
    {
      description: "missiles/japan.json Ohka Model 11 donor excluded (canonical: wunderwaffen/japan.json)",
      stillPresentAsIndependentRecord: assigned.some((a) => a.category === "missiles" && a.fileNation === "japan" && a.item.name === "Ohka Model 11"),
    },
  ];

  // Validation behavior: missing canonical/donor is a warning (the
  // resolution simply can't apply anymore — visible, but not blocking on
  // its own, since the underlying duplicate may have already been fixed
  // some other way). A rule that matched both sides but still didn't
  // apply any field is an error — that combination means something is
  // structurally wrong (stale fieldsToMerge, unexpected data shape), not
  // just a resolved-elsewhere case.
  for (const outcome of outcomes) {
    if (!outcome.canonicalFound) {
      allIssues.push({
        recordId: outcome.description,
        field: "duplicateResolution",
        message: `Canonical record not found for rule "${outcome.description}" — this resolution can no longer apply. Investigate whether the canonical record was renamed, removed, or already resolved another way.`,
        severity: "warning",
        category: "duplicate-resolution",
      });
    }
    if (!outcome.donorFound) {
      allIssues.push({
        recordId: outcome.description,
        field: "duplicateResolution",
        message: `Donor record not found for rule "${outcome.description}" — this resolution can no longer apply. Investigate whether the donor was renamed, removed, or already resolved another way.`,
        severity: "warning",
        category: "duplicate-resolution",
      });
    }
    if (outcome.canonicalFound && outcome.donorFound && !outcome.mergeApplied) {
      allIssues.push({
        recordId: outcome.description,
        field: "duplicateResolution",
        message: `Rule "${outcome.description}" matched both canonical and donor records, but the merge did not apply any field — investigate before import; this should never happen for a correctly-matched rule.`,
        severity: "error",
        category: "duplicate-resolution",
      });
    }
  }

  const duplicateResolutionReport: DuplicateResolutionReport = {
    rulesExpected: DUPLICATE_RESOLUTIONS.length,
    rulesMatched: outcomes.filter((o) => o.canonicalFound && o.donorFound).length,
    rulesMissingCanonical: outcomes.filter((o) => !o.canonicalFound).length,
    rulesMissingDonor: outcomes.filter((o) => !o.donorFound).length,
    rulesApplied: outcomes.filter((o) => o.mergeApplied).length,
    outcomes,
  };

  const issuesByField: Record<string, number> = {};
  let errorCount = 0;
  let warningCount = 0;
  for (const issue of allIssues) {
    issuesByField[issue.field] = (issuesByField[issue.field] ?? 0) + 1;
    if (issue.severity === "error") errorCount++;
    else warningCount++;
  }
  const recordsWithErrors = new Set(allIssues.filter((i) => i.severity === "error").map((i) => i.recordId));

  return {
    generatedAt: new Date().toISOString(),
    mode: "dry-run",
    totalRecords: assigned.length,
    existingIdCount,
    synthesizedIdCount,
    byCategory,
    byFileNation,
    collectionsExpected: [...collectionSet].sort(),
    idCollisions,
    resolvedDuplicateChecks,
    duplicateResolutionReport,
    validation: { errorCount, warningCount, issuesByField, issues: allIssues },
    readyToImport: assigned.length - recordsWithErrors.size,
    blockedByErrors: recordsWithErrors.size,
  };
}
