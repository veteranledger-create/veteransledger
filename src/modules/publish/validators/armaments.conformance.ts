import { RecordLike, ValidationIssue } from "../publish.types";

function isNonEmptyString(value: unknown): boolean {
  return typeof value === "string" && value.trim().length > 0;
}

// Checks a Record carries everything Armaments/record.js needs before it's
// allowed to publish. Deliberately has NO nation enum — real data includes
// compound multi-nation values ("Hungary / Romania / Bulgaria") that a
// strict isIn([...]) check (the existing armament.validator.ts's actual
// bug) would always reject. Cross-record collision detection (duplicate
// canonical ids, synthesized-id collisions) needs the full dataset and
// lives in armaments-import-check.ts instead, not as a permanent
// per-record exception baked in here — same separation Personnel used.
export function checkArmamentRecord(record: RecordLike): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const pushError = (field: string, message: string) => issues.push({ recordId: record.id, field, message, severity: "error" });
  const pushWarning = (field: string, message: string) => issues.push({ recordId: record.id, field, message, severity: "warning" });

  if (!isNonEmptyString(record.slug)) pushError("id", "Record id is missing.");
  if (!isNonEmptyString(record.title)) pushError("title", "Armament must have a name.");
  if (!isNonEmptyString(record.summary)) {
    pushError("summary", "Armament must have a summary, and none could be derived from summary, notes, or description.");
  }

  if (!isNonEmptyString(record.nationality)) {
    pushWarning("nationality", "Armament has no nation value, including no folder-derived fallback — unexpected, investigate the source record.");
  }

  const relatedRaw = record.metadata ? record.metadata["related_records"] : undefined;
  if (relatedRaw !== null && relatedRaw !== undefined) {
    if (!Array.isArray(relatedRaw)) {
      pushWarning("related_records", "metadata.related_records must be an array when present — ignored otherwise.");
    } else {
      relatedRaw.forEach((entry, i) => {
        if (!entry || typeof entry !== "object" || typeof (entry as { id?: unknown }).id !== "string") {
          pushWarning("related_records", `related_records[${i}] is missing a string id — that entry will be dropped.`);
        }
      });
    }
  }

  return issues;
}
