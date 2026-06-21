import { RecordLike } from "../publish.types";
import { resolveRelatedUrl } from "../related-url-resolver";
import { NormalizedCombatants, NormalizedPhase, deriveSummary } from "../import-validation/campaign-record-mapper";

interface SourceEntry {
  type?: string;
  ref?: string;
  note?: string;
}

interface RelatedRecordEntry {
  id: string;
  title?: string;
  type?: string;
  url?: string;
}

export interface CampaignJson {
  id: string;
  theater: string;
  region_label?: string;
  title: string;
  subtitle?: string;
  dates: { start?: string; end?: string };
  combatants: NormalizedCombatants;
  phases: NormalizedPhase[];
  casualties?: Record<string, string>;
  background?: string;
  context?: string;
  outcome?: string;
  significance?: string;
  summary?: string;
  image?: string;
  sources?: SourceEntry[];
  related_records?: RelatedRecordEntry[];
  // One-off extension fields (sonnenblume's events, convoy-war's
  // wolfpack_tactics/turning_point, etc.) pass through here, untyped — see
  // campaign-record-mapper.ts's extractExtras for where they're collected.
  [key: string]: unknown;
}

// The safe default shown when a campaign genuinely has no combatants data
// (atlantic, convoy-war) — supplied here at publish time, not by the
// mapper at import time, so the validator can still see the true absence
// (metadata.combatants === null) rather than have it erased by a default.
const EMPTY_COMBATANTS: NormalizedCombatants = {
  axis: { commanders: [], strength: null, nations: [] },
  allied: { commanders: [], strength: null, nations: [] },
};

const EXPLICIT_FIELDS = new Set([
  "theater", "region_label", "subtitle", "dates", "combatants", "phases",
  "casualties", "background", "context", "outcome", "significance",
  "image", "sources", "related_records",
]);

function meta(record: RecordLike, key: string): unknown {
  return record.metadata ? record.metadata[key] : undefined;
}

function asString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0 ? value : undefined;
}

export function toCampaignJson(record: RecordLike): CampaignJson {
  const combatantsRaw = meta(record, "combatants") as NormalizedCombatants | null;
  const datesRaw = meta(record, "dates") as { start?: string | null; end?: string | null } | null;
  const sourcesRaw = meta(record, "sources");
  const sources = Array.isArray(sourcesRaw) ? (sourcesRaw as SourceEntry[]) : undefined;
  const casualtiesRaw = meta(record, "casualties");
  const phasesRaw = meta(record, "phases");

  const relatedRaw = meta(record, "related_records");
  const related = Array.isArray(relatedRaw)
    ? relatedRaw
        .filter((r): r is { id: string; title?: string; type?: string } => !!r && typeof r.id === "string")
        // Always regenerated, never the source's own url — real campaign
        // data's related_records urls are theater-prefixed
        // (/campaigns/<theater>/<id>) and 404 against the actual
        // registered route (/campaigns/:id). Unlike Letters/Articles,
        // which only fill in a url when the source omitted one, Campaigns
        // must never pass a source url through unchanged — see the Phase 3
        // decision to treat the theater-prefixed form as a pre-existing
        // data bug, not the target format.
        .map((r) => ({ id: r.id, title: r.title, type: r.type, url: resolveRelatedUrl(r.type, r.id) }))
    : undefined;

  const extras: Record<string, unknown> = {};
  if (record.metadata) {
    for (const [key, value] of Object.entries(record.metadata)) {
      if (!EXPLICIT_FIELDS.has(key) && key !== "importRunId") extras[key] = value;
    }
  }

  return {
    ...extras,
    id: record.slug ?? record.id,
    theater: asString(meta(record, "theater")) ?? "unknown",
    region_label: asString(meta(record, "region_label")),
    title: record.title,
    subtitle: asString(meta(record, "subtitle")),
    dates: { start: datesRaw?.start ?? undefined, end: datesRaw?.end ?? undefined },
    combatants: combatantsRaw ?? EMPTY_COMBATANTS,
    phases: Array.isArray(phasesRaw) ? (phasesRaw as NormalizedPhase[]) : [],
    casualties: casualtiesRaw && typeof casualtiesRaw === "object" ? (casualtiesRaw as Record<string, string>) : undefined,
    background: asString(meta(record, "background")),
    context: asString(meta(record, "context")),
    outcome: asString(meta(record, "outcome")),
    significance: asString(meta(record, "significance")),
    // Same philosophy as Letters' deriveExcerpt — falls back to the next
    // best prose field rather than publishing with nothing, in the same
    // priority order the conformance validator uses to decide whether a
    // missing summary is a warning or a blocking error.
    summary: asString(record.summary) ?? deriveSummary(
      asString(meta(record, "context")),
      asString(meta(record, "significance")),
      asString(meta(record, "outcome")),
    ),
    image: asString(meta(record, "image")),
    sources,
    related_records: related,
  };
}
