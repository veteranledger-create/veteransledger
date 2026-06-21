import { RecordLike, ValidationIssue } from "../publish.types";
import { KNOWN_COLLECTIONS } from "../generators/letters.generator";

function meta(record: RecordLike, key: string): unknown {
  return record.metadata ? record.metadata[key] : undefined;
}

function isNonEmptyString(value: unknown): boolean {
  return typeof value === "string" && value.trim().length > 0;
}

function metaAnyPresent(record: RecordLike, ...keys: string[]): boolean {
  return keys.some((key) => isNonEmptyString(meta(record, key)));
}

// Checks a Record carries everything Letters/record.js and search.js
// actually read before it's allowed to publish — accepting both the
// canonical field names (german.json) and the legacy aliases the other
// five real collections use (author/unit/recipient/body/historical_context/
// archival_note), matching the generator's own fallback chain exactly so a
// record that the generator can render never fails this check, and vice
// versa. Runs at publish time, not save/create time — an admin can still
// save an incomplete draft; it just won't generate until the error-severity
// checks pass. Warning-severity checks are reported but never block.
export function checkLetterRecord(record: RecordLike): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const pushError = (field: string, message: string) => issues.push({ recordId: record.id, field, message, severity: "error" });
  const pushWarning = (field: string, message: string) => issues.push({ recordId: record.id, field, message, severity: "warning" });

  if (!isNonEmptyString(record.id)) pushError("id", "Record id is missing.");

  const hasFrom = metaAnyPresent(record, "from", "author") || isNonEmptyString(record.title);
  if (!hasFrom) pushError("from", "Letter must have a sender ('from'/'author' in metadata, or a title to fall back to).");

  const hasContent =
    isNonEmptyString(record.summary) ||
    metaAnyPresent(record, "excerpt", "full_text", "body", "translation") ||
    isNonEmptyString(record.content);
  if (!hasContent) {
    pushError("excerpt", "Letter must have a summary, excerpt, or full text ('full_text'/'body'/'translation') — search indexing needs at least one.");
  }

  // `collection` (which output file a letter belongs to) replaces
  // `language` as the grouping key — see letters.generator.ts's
  // resolveCollectionKey for the exact fallback order this mirrors.
  const collection = meta(record, "collection");
  const language = meta(record, "language");
  if (collection !== undefined && !isNonEmptyString(collection)) {
    pushWarning("collection", "metadata.collection must be a non-empty string when present.");
  } else if (isNonEmptyString(collection) && !(KNOWN_COLLECTIONS as readonly string[]).includes(collection as string)) {
    pushWarning(
      "collection",
      `metadata.collection "${collection}" is not one of the known collections (${KNOWN_COLLECTIONS.join(", ")}) — it will still publish under that name.`,
    );
  } else if (collection === undefined && language === undefined) {
    pushWarning("collection", "No collection or language set — this record will fall back to the default collection 'german'.");
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
