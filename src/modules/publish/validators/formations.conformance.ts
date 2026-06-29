import { RecordLike, ValidationIssue } from "../publish.types";

function meta(record: RecordLike, key: string): unknown {
  return record.metadata ? record.metadata[key] : undefined;
}

function isNonEmptyString(value: unknown): boolean {
  return typeof value === "string" && value.trim().length > 0;
}

const KNOWN_SECTIONS = [
  "army-groups", "armies", "corps", "divisions", "waffen-ss",
  "volunteers", "brigades", "regiments", "battalions", "companies",
  "luftwaffe", "kriegsmarine", "allies",
];

export function checkFormationRecord(record: RecordLike): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const pushError = (field: string, message: string) =>
    issues.push({ recordId: record.id, field, message, severity: "error" });
  const pushWarning = (field: string, message: string) =>
    issues.push({ recordId: record.id, field, message, severity: "warning" });

  if (!isNonEmptyString(record.slug) && !isNonEmptyString(record.id)) {
    pushError("id", "Formation must have an id (slug).");
  }
  if (!isNonEmptyString(record.title)) {
    pushError("title", "Formation must have a name (title).");
  }
  if (!isNonEmptyString(record.summary)) {
    pushWarning("summary", "Formation has no summary — card and overview will be empty.");
  }

  const section = meta(record, "section");
  if (!isNonEmptyString(section)) {
    pushWarning("section", "Formation has no section — it will not appear in any category tab.");
  } else if (!KNOWN_SECTIONS.includes(section as string)) {
    pushWarning("section", `Section "${section}" is not one of the known sections (${KNOWN_SECTIONS.join(", ")}).`);
  }

  const commanders = meta(record, "commanders");
  if (commanders !== undefined && !Array.isArray(commanders)) {
    pushWarning("commanders", "metadata.commanders must be an array when present.");
  }

  const sources = meta(record, "sources");
  if (sources !== undefined && !Array.isArray(sources)) {
    pushWarning("sources", "metadata.sources must be an array when present.");
  }

  const related = meta(record, "related_records");
  if (related !== undefined && !Array.isArray(related)) {
    pushWarning("related_records", "metadata.related_records must be an array when present.");
  }

  return issues;
}
