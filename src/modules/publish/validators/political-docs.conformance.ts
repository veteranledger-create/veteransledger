import { RecordLike, ValidationIssue } from "../publish.types";

function isNonEmptyString(v: unknown): boolean {
  return typeof v === "string" && v.trim().length > 0;
}
function meta(record: RecordLike, key: string): unknown {
  return record.metadata ? record.metadata[key] : undefined;
}

export function checkPoliticalDocRecord(record: RecordLike): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const err = (field: string, message: string) => issues.push({ recordId: record.id, field, message, severity: "error" });
  const warn = (field: string, message: string) => issues.push({ recordId: record.id, field, message, severity: "warning" });

  if (!isNonEmptyString(record.id)) err("id", "Record id is missing.");
  if (!isNonEmptyString(record.title)) err("title", "Political document must have a title.");
  if (!isNonEmptyString(record.summary)) warn("summary", "Political document has no summary — cards will display without description.");

  const signatories = meta(record, "signatories");
  if (signatories !== undefined) {
    if (!Array.isArray(signatories)) {
      warn("signatories", "metadata.signatories must be an array when present.");
    } else {
      (signatories as unknown[]).forEach((s, i) => {
        if (typeof s !== "string" || !s.trim()) {
          warn("signatories", `signatories[${i}] is empty or not a string — that entry will be dropped.`);
        }
      });
    }
  }

  const relatedRaw = meta(record, "related_records");
  if (relatedRaw !== undefined && !Array.isArray(relatedRaw)) {
    warn("related_records", "metadata.related_records must be an array when present.");
  }

  return issues;
}
