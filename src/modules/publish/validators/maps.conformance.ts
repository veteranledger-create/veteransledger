import { RecordLike, ValidationIssue } from "../publish.types";

function isNonEmptyString(v: unknown): boolean {
  return typeof v === "string" && v.trim().length > 0;
}
function meta(record: RecordLike, key: string): unknown {
  return record.metadata ? record.metadata[key] : undefined;
}

export function checkMapRecord(record: RecordLike): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const err = (field: string, message: string) => issues.push({ recordId: record.id, field, message, severity: "error" });
  const warn = (field: string, message: string) => issues.push({ recordId: record.id, field, message, severity: "warning" });

  if (!isNonEmptyString(record.id)) err("id", "Record id is missing.");
  if (!isNonEmptyString(record.title)) err("title", "Map must have a title.");

  const gallery = meta(record, "gallery");
  if (!Array.isArray(gallery) || gallery.length === 0) {
    warn("gallery", "Map has no gallery images — the map image will not display.");
  }

  const theater = meta(record, "theater");
  if (theater !== undefined && !isNonEmptyString(theater)) {
    warn("theater", "metadata.theater must be a non-empty string when present.");
  }

  const year = meta(record, "year");
  if (year !== undefined && typeof year !== "number") {
    warn("year", "metadata.year must be a number when present.");
  }

  const relatedRaw = meta(record, "related_records");
  if (relatedRaw !== undefined && !Array.isArray(relatedRaw)) {
    warn("related_records", "metadata.related_records must be an array when present.");
  }

  return issues;
}
