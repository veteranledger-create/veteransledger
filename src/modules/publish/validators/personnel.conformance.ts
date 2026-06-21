import { EntityLike, ValidationIssue } from "../publish.types";

function meta(entity: EntityLike, key: string): unknown {
  return entity.metadata ? entity.metadata[key] : undefined;
}

function isNonEmptyString(value: unknown): boolean {
  return typeof value === "string" && value.trim().length > 0;
}

const KNOWN_BRANCHES = ["army", "kriegsmarine", "luftwaffe", "waffen-ss", "foreign"];

// Checks an Entity carries everything Personnel/record.js needs before
// it's allowed to publish. Deliberately has no cross-record logic (e.g.
// the slug/name conflict detector) — that requires the full dataset and
// lives in personnel-import-check.ts instead, not as a permanent
// code-level exception baked into a per-record check.
export function checkPersonnelRecord(entity: EntityLike): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const pushError = (field: string, message: string) => issues.push({ recordId: entity.id, field, message, severity: "error" });
  const pushWarning = (field: string, message: string) => issues.push({ recordId: entity.id, field, message, severity: "warning" });

  if (!isNonEmptyString(entity.slug)) pushError("id", "Record id is missing.");
  if (!isNonEmptyString(entity.name)) pushError("name", "Personnel record must have a name.");
  if (!isNonEmptyString(entity.biography)) pushError("biography", "Personnel record must have a biography.");

  const branch = meta(entity, "branch");
  if (isNonEmptyString(branch) && !KNOWN_BRANCHES.includes(branch as string)) {
    pushWarning("branch", `branch "${branch}" is not one of the known branches (${KNOWN_BRANCHES.join(", ")}).`);
  }

  // Portrait dead-link status is never checked here — it's a dry-run
  // statistic (imageStats), not a validation failure, by design.

  const relatedRaw = meta(entity, "related_records");
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
