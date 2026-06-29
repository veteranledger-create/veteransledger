import { RecordLike, ValidationIssue } from "../publish.types";

function isNonEmptyString(v: unknown): boolean {
  return typeof v === "string" && v.trim().length > 0;
}
function meta(record: RecordLike, key: string): unknown {
  return record.metadata ? record.metadata[key] : undefined;
}

export function checkAwardRecord(record: RecordLike): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const err = (field: string, message: string) => issues.push({ recordId: record.id, field, message, severity: "error" });
  const warn = (field: string, message: string) => issues.push({ recordId: record.id, field, message, severity: "warning" });

  if (!isNonEmptyString(record.id)) err("id", "Record id is missing.");
  if (!isNonEmptyString(record.title)) err("title", "Award must have a title.");
  if (!isNonEmptyString(record.summary)) warn("summary", "Award has no summary — cards will display without description.");

  const nation = meta(record, "nation");
  if (nation !== undefined && !isNonEmptyString(nation)) {
    warn("nation", "metadata.nation must be a non-empty string when present.");
  }

  const relatedRaw = meta(record, "related_records");
  if (relatedRaw !== undefined && !Array.isArray(relatedRaw)) {
    warn("related_records", "metadata.related_records must be an array when present.");
  }

  return issues;
}
