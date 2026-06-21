import fs from "fs/promises";
import path from "path";
import { checkLetterRecord } from "../validators/letters.conformance";
import { ValidationIssue } from "../publish.types";
import { COLLECTION_FILES, LegacyLetter, toCandidateRecord } from "./letter-record-mapper";
import { targetExists } from "./cross-reference-lookup";
import { writeStagedFilesAtomically } from "../atomic-stage-writer";
import { storageConfig } from "../../../config/storage";

// This module never imports Prisma and never writes inside public/data/ —
// it only reads the real letters/*.json files (plus other content types,
// read-only, for related_records existence checks) and returns a report.
// That's a structural guarantee, not just a runtime flag: there's no
// database client reference anywhere in this file for a future edit to
// accidentally wire up.
const PUBLIC_DATA_DIR = path.resolve(__dirname, "../../../../public/data");
const LETTERS_DIR = path.join(PUBLIC_DATA_DIR, "letters");

export interface ImportIssue extends ValidationIssue {
  collection: string;
}

export interface CollectionMismatch {
  recordId: string;
  declaredCollection: string;
  fileCollection: string;
}

export interface MissingRelatedTarget {
  recordId: string;
  relatedId: string;
  relatedType: string;
}

export interface ImportSummary {
  generatedAt: string;
  mode: "dry-run";
  totalRecords: number;
  byCollection: Record<string, number>;
  duplicateIds: string[];
  collectionMismatches: CollectionMismatch[];
  missingRelatedTargets: MissingRelatedTarget[];
  validation: {
    errorCount: number;
    warningCount: number;
    issuesByField: Record<string, number>;
    issues: ImportIssue[];
  };
  readyToImport: number;
  blockedByErrors: number;
}

export async function runLettersImportDryRun(): Promise<ImportSummary> {
  const seenIds = new Map<string, string[]>();
  const byCollection: Record<string, number> = {};
  const collectionMismatches: CollectionMismatch[] = [];
  const missingRelatedTargets: MissingRelatedTarget[] = [];
  const allIssues: ImportIssue[] = [];
  let total = 0;

  for (const [collection, filename] of Object.entries(COLLECTION_FILES)) {
    const filePath = path.join(LETTERS_DIR, filename);
    const letters: LegacyLetter[] = JSON.parse(await fs.readFile(filePath, "utf-8"));
    byCollection[collection] = letters.length;
    total += letters.length;

    for (const letter of letters) {
      const occurrences = seenIds.get(letter.id) ?? [];
      occurrences.push(collection);
      seenIds.set(letter.id, occurrences);

      if (letter.collection && letter.collection !== collection) {
        collectionMismatches.push({ recordId: letter.id, declaredCollection: letter.collection, fileCollection: collection });
      }

      const candidate = toCandidateRecord(letter, collection);
      for (const issue of checkLetterRecord(candidate)) {
        allIssues.push({ ...issue, collection });
      }

      const related = Array.isArray(letter.related_records) ? (letter.related_records as Array<{ id?: unknown; type?: unknown }>) : [];
      for (const entry of related) {
        if (typeof entry?.id !== "string") continue;
        const relatedType = typeof entry.type === "string" ? entry.type : undefined;
        const exists = await targetExists(relatedType, entry.id, PUBLIC_DATA_DIR);
        if (!exists) {
          missingRelatedTargets.push({ recordId: letter.id, relatedId: entry.id, relatedType: relatedType ?? "unknown" });
        }
      }
    }
  }

  const duplicateIds = [...seenIds.entries()]
    .filter(([, collections]) => collections.length > 1)
    .map(([id]) => id);

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
    totalRecords: total,
    byCollection,
    duplicateIds,
    collectionMismatches,
    missingRelatedTargets,
    validation: { errorCount, warningCount, issuesByField, issues: allIssues },
    readyToImport: total - recordsWithErrors.size,
    blockedByErrors: recordsWithErrors.size,
  };
}

// Reuses the same all-or-nothing temp-dir-then-rename writer the publish
// pipeline already relies on (Phase 0.5) — a failed write here can't leave
// a half-written or corrupted import-summary.json behind, and re-running
// this always produces a clean, complete replacement rather than a patch.
export async function writeImportSummary(summary: ImportSummary): Promise<string> {
  const outDir = path.join(storageConfig.directories.importReports, "letters");
  const files = new Map([["import-summary.json", JSON.stringify(summary, null, 2)]]);
  const [written] = await writeStagedFilesAtomically(outDir, files);
  return written;
}
