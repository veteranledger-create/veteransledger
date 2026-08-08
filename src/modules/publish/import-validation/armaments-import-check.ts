import { checkArmamentRecord } from "../validators/armaments.conformance";
import { ValidationIssue } from "../publish.types";
import {
  IdCollision, DuplicateResolutionOutcome,
  applyDuplicateResolutions, assignIds, detectIdCollisions,
  toCandidateRecord, DUPLICATE_RESOLUTIONS,
} from "./armament-record-mapper";
import { loadArmamentsArchive, LoadedArmamentsArchive } from "./armaments-archive-loader";

export interface ImportIssue extends ValidationIssue {
  category: string;
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

// Phase 8A: lets Gate 3 (blockedByErrors) and Gate 4 (duplicate-resolution
// integrity) evaluate only the categories/nations actually being executed,
// instead of the entire archive. Duplicate resolution itself is NEVER
// scoped before this point — some rules cross categories (e.g. a missiles
// donor merging into a wunderwaffen canonical), so resolution must always
// see the complete, unscoped dataset. Scoping is applied only afterward,
// to which already-resolved records/rules are allowed to block execution.
export interface ImportScope {
  categories?: string[];
  nations?: string[];
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

// loadAllArmaments() (hardcoded CATEGORIES x NATIONS grid, 18 reachable
// files) has been superseded by armaments-archive-loader.ts's
// loadArmamentsArchive(), which reads the Phase A manifest's declared 28
// files instead. This function accepts an optional preloaded archive so a
// caller driving both this and other stages from one operation (as
// runArmamentsImport() does) reads the archive exactly once, no matter how
// many of these functions run as part of it. Each call that doesn't
// receive a preload loads its own fresh copy, which never caches beyond a
// single call either — deliberately request-scoped, not a new global cache.
export async function runArmamentsImportDryRun(scope?: ImportScope, preloaded?: LoadedArmamentsArchive): Promise<ArmamentImportSummary> {
  const archive = preloaded ?? await loadArmamentsArchive();
  const loadedRawAll = archive.declaredItems;
  // Always run resolution against the FULL, unscoped dataset first — a
  // donor's canonical can live in a different category/fileNation than
  // the donor itself, so resolving against an already-scoped subset could
  // silently miss a canonical that's outside the requested scope.
  const { resolved: resolvedAll, outcomes: outcomesAll } = applyDuplicateResolutions(loadedRawAll);
  const assignedAll = assignIds(resolvedAll);

  const inScope = (categoryOf: { category: string; fileNation: string }) =>
    (!scope?.categories || scope.categories.includes(categoryOf.category)) &&
    (!scope?.nations || scope.nations.includes(categoryOf.fileNation));

  const loadedRaw = loadedRawAll.filter(inScope);
  const assigned = assignedAll.filter(inScope);
  // A rule is in-scope for gating purposes when its donor's category/
  // fileNation falls inside the requested scope — every current rule's
  // canonical shares the donor's category, so this single check covers
  // both sides without needing the canonical's own location.
  const scopedOutcomes = DUPLICATE_RESOLUTIONS
    .map((rule, i) => ({ rule, outcome: outcomesAll[i] }))
    .filter(({ rule }) => inScope({ category: rule.donor.category, fileNation: rule.donor.fileNation }))
    .map(({ outcome }) => outcome);

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
  // Validation behavior: missing canonical/donor is a warning (the
  // resolution simply can't apply anymore — visible, but not blocking on
  // its own, since the underlying duplicate may have already been fixed
  // some other way). A rule that matched both sides but still didn't
  // apply any field is an error — that combination means something is
  // structurally wrong (stale fieldsToMerge, unexpected data shape), not
  // just a resolved-elsewhere case.
  for (const outcome of scopedOutcomes) {
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

  // Scoped to the requested categories/nations — rulesExpected is the
  // count of rules actually relevant to this run, not the full archive's
  // rule table. An out-of-scope rule (e.g. a Naval rule during an
  // Aircraft-only run) is invisible here entirely: neither required nor
  // counted against this run's integrity gate.
  const duplicateResolutionReport: DuplicateResolutionReport = {
    rulesExpected: scopedOutcomes.length,
    rulesMatched: scopedOutcomes.filter((o) => o.canonicalFound && o.donorFound).length,
    rulesMissingCanonical: scopedOutcomes.filter((o) => !o.canonicalFound).length,
    rulesMissingDonor: scopedOutcomes.filter((o) => !o.donorFound).length,
    rulesApplied: scopedOutcomes.filter((o) => o.mergeApplied).length,
    outcomes: scopedOutcomes,
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
    duplicateResolutionReport,
    validation: { errorCount, warningCount, issuesByField, issues: allIssues },
    readyToImport: assigned.length - recordsWithErrors.size,
    blockedByErrors: recordsWithErrors.size,
  };
}
