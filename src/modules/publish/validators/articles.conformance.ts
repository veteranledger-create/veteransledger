import { RecordLike, ValidationIssue } from "../publish.types";

function meta(record: RecordLike, key: string): unknown {
  return record.metadata ? record.metadata[key] : undefined;
}

function isNonEmptyString(value: unknown): boolean {
  return typeof value === "string" && value.trim().length > 0;
}

const KNOWN_CATEGORIES = ["military", "political", "economy", "legal"];

// Checks a Record carries everything Articles/record.js needs before it's
// allowed to publish. An article with no body content is functionally
// empty (unlike a Letter, which can stand on just an excerpt) — that's
// the one place this validator's error/warning split differs in kind from
// the Letters validator, not just in field names.
export function checkArticleRecord(record: RecordLike): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const pushError = (field: string, message: string) => issues.push({ recordId: record.id, field, message, severity: "error" });
  const pushWarning = (field: string, message: string) => issues.push({ recordId: record.id, field, message, severity: "warning" });

  if (!isNonEmptyString(record.id)) pushError("id", "Record id is missing.");
  if (!isNonEmptyString(record.title)) pushError("title", "Article must have a title.");
  if (!isNonEmptyString(record.summary)) pushError("summary", "Article must have a summary.");

  const body = meta(record, "body");
  if (!Array.isArray(body) || body.length === 0) {
    pushError("body", "Article must have at least one body block — an article with no body content is functionally empty.");
  } else {
    body.forEach((block, i) => {
      if (!block || typeof block !== "object" || !isNonEmptyString((block as { text?: unknown }).text)) {
        pushWarning("body", `body[${i}] has no usable text after normalization — it will render as an empty block.`);
      }
    });
  }

  const category = meta(record, "category");
  if (category !== undefined && !isNonEmptyString(category)) {
    pushWarning("category", "metadata.category must be a non-empty string when present.");
  } else if (isNonEmptyString(category) && !KNOWN_CATEGORIES.includes(category as string)) {
    pushWarning("category", `metadata.category "${category}" is not one of the known categories (${KNOWN_CATEGORIES.join(", ")}) — it will still publish under that name.`);
  }

  const relatedRaw = meta(record, "related_records");
  if (relatedRaw !== undefined) {
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
