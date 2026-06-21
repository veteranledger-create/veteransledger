import { RecordLike, ValidationIssue } from "../publish.types";
import { deriveSummary } from "../import-validation/campaign-record-mapper";

function meta(record: RecordLike, key: string): unknown {
  return record.metadata ? record.metadata[key] : undefined;
}

function isNonEmptyString(value: unknown): boolean {
  return typeof value === "string" && value.trim().length > 0;
}

const KNOWN_THEATERS = ["africa", "atlantic", "eastern-front", "italy", "western-front"];

// Checks a Record carries everything Campaigns/record.js needs before it's
// allowed to publish.
export function checkCampaignRecord(record: RecordLike): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const pushError = (field: string, message: string) => issues.push({ recordId: record.id, field, message, severity: "error" });
  const pushWarning = (field: string, message: string) => issues.push({ recordId: record.id, field, message, severity: "warning" });

  if (!isNonEmptyString(record.id)) pushError("id", "Record id is missing.");
  if (!isNonEmptyString(record.title)) pushError("title", "Campaign must have a title.");

  if (!isNonEmptyString(record.summary)) {
    // Same philosophy as Letters: a missing summary isn't necessarily
    // fatal if something derivable exists. Downgraded to a warning only
    // when deriveSummary would actually produce something — a campaign
    // with no summary AND no context/significance/outcome has nothing to
    // show at all, which stays a blocking error.
    const derived = deriveSummary(
      meta(record, "context") as string | undefined,
      meta(record, "significance") as string | undefined,
      meta(record, "outcome") as string | undefined,
    );
    if (derived) {
      pushWarning("summary", "Campaign has no summary — derived from context, significance, or outcome.");
    } else {
      pushError("summary", "Campaign must have a summary, and none could be derived from context, significance, or outcome.");
    }
  }

  // Explicit warning case, not an implicit default — campaign-record-mapper
  // stores combatants as null (not a defaulted empty shape) precisely so
  // this absence is visible here rather than hidden behind a generator
  // default. Confirmed real for atlantic.json and convoy-war.json.
  if (meta(record, "combatants") === null) {
    pushWarning("combatants", "Campaign has no combatants data — axis/allied commanders and strength will be empty.");
  }

  const dates = meta(record, "dates") as { start?: string | null; end?: string | null } | undefined;
  if (!dates?.start) {
    pushWarning("dates", "Campaign has no start date.");
  }

  const theater = meta(record, "theater");
  if (isNonEmptyString(theater) && !KNOWN_THEATERS.includes(theater as string)) {
    pushWarning("theater", `theater "${theater}" is not one of the known theaters (${KNOWN_THEATERS.join(", ")}).`);
  }

  const casualties = meta(record, "casualties");
  if (casualties !== null && casualties !== undefined && (typeof casualties !== "object" || Array.isArray(casualties))) {
    pushWarning("casualties", "metadata.casualties must be an object when present.");
  }

  const phases = meta(record, "phases");
  if (phases !== undefined && !Array.isArray(phases)) {
    pushWarning("phases", "metadata.phases must be an array when present.");
  }

  const relatedRaw = meta(record, "related_records");
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
