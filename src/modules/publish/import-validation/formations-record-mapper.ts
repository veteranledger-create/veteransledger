import { RecordLike } from "../publish.types";
import { pick } from "./text-utils";

// Mirrors SECTION_TO_FILE in generators/formations.generator.ts — the
// recovery source of truth is the same file list src/scripts/import-formations.ts
// already used, kept here so the importer and its dry-run preview can never
// silently drift apart.
export const FORMATION_FILES: Record<string, string> = {
  "army-groups":  "germany/army-groups.json",
  "armies":       "germany/armies.json",
  "corps":        "germany/corps.json",
  "divisions":    "germany/divisions.json",
  "waffen-ss":    "germany/ss.json",
  "brigades":     "germany/brigades.json",
  "regiments":    "germany/regiments.json",
  "battalions":   "germany/battalions.json",
  "companies":    "germany/companies.json",
  "luftwaffe":    "germany/luftflotte.json",
  "kriegsmarine": "germany/naval.json",
  "allies":       "allies/allies.json",
  "volunteers":   "volunteer-formations.json",
};

export interface LegacyFormation {
  id: string;
  recordId?: string;
  name: string;
  nation?: string;
  service?: string;
  type?: string;
  theater?: string;
  active?: unknown;
  commanders?: unknown;
  peak_strength?: string;
  summary?: string;
  context?: string;
  sources?: unknown;
  related_records?: unknown;
  overview_blocks?: unknown;
  context_blocks?: unknown;
  dossier?: unknown;
  shield?: string;
  flag?: string;
  region?: string;
  volunteer_origin?: string;
  parent_formation?: unknown;
  constituent_divisions?: unknown;
  predecessor?: string;
  fate?: string;
  subordinate_units?: unknown;
  campaign_participation?: unknown;
  // A handful of one-off fields exist per section — this index signature
  // is what lets them flow through without the mapper needing to know
  // their names in advance, same mechanism as Armaments/Articles/Campaigns.
  [key: string]: unknown;
}

const KNOWN_FIELDS = new Set([
  "id", "recordId", "name", "nation", "service", "type", "theater", "active",
  "commanders", "peak_strength", "summary", "context", "sources", "related_records",
  "overview_blocks", "context_blocks", "dossier", "shield", "flag", "region",
  "volunteer_origin", "parent_formation", "constituent_divisions", "predecessor",
  "fate", "subordinate_units", "campaign_participation",
]);

function extractExtras(formation: LegacyFormation): Record<string, unknown> {
  return Object.fromEntries(Object.entries(formation).filter(([key]) => !KNOWN_FIELDS.has(key)));
}

export function toRecordCreateInput(formation: LegacyFormation, section: string) {
  const extras = extractExtras(formation);
  // Recovery: reuse the original database id (embedded by the publish
  // pipeline's recordId backfill) when present, so restored rows keep
  // their pre-loss identity instead of getting a fresh cuid.
  const recordId = typeof formation.recordId === "string" ? formation.recordId : undefined;

  return {
    ...(recordId ? { id: recordId } : {}),
    type: "FORMATION",
    slug: formation.id,
    // Formations have never had a collectionId in this codebase (confirmed:
    // src/scripts/import-formations.ts never sets one) — preserved as-is.
    title: formation.name,
    summary: pick(formation.summary, formation.context) ?? null,
    content: null,
    date: null,
    nationality: pick(formation.nation) ?? "Germany",
    tags: [section],
    published: true,
    metadata: {
      ...extras,
      section,
      formation_type: formation.type ?? null,
      service: formation.service ?? null,
      theater: formation.theater ?? null,
      active: formation.active ?? null,
      commanders: Array.isArray(formation.commanders) ? formation.commanders : [],
      peak_strength: formation.peak_strength ?? null,
      context: formation.context ?? null,
      overview_blocks: Array.isArray(formation.overview_blocks) ? formation.overview_blocks : [],
      context_blocks: Array.isArray(formation.context_blocks) ? formation.context_blocks : [],
      sources: formation.sources ?? null,
      related_records: formation.related_records ?? null,
      dossier: formation.dossier ?? null,
      shield: formation.shield ?? null,
      flag: formation.flag ?? null,
      region: formation.region ?? null,
      volunteer_origin: formation.volunteer_origin ?? null,
      parent_formation: formation.parent_formation ?? null,
      constituent_divisions: formation.constituent_divisions ?? null,
      predecessor: formation.predecessor ?? null,
      fate: formation.fate ?? null,
      subordinate_units: formation.subordinate_units ?? null,
      campaign_participation: formation.campaign_participation ?? null,
    },
  };
}

export function toCandidateRecord(formation: LegacyFormation, section: string): RecordLike {
  const input = toRecordCreateInput(formation, section);
  return {
    id: formation.id,
    title: input.title,
    slug: formation.id,
    summary: input.summary,
    content: input.content,
    date: input.date,
    nationality: input.nationality,
    tags: input.tags,
    published: true,
    metadata: input.metadata as Record<string, unknown>,
  };
}
