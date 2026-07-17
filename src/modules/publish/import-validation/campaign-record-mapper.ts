import { RecordLike } from "../publish.types";
import { pick } from "./text-utils";

// The 5 real theater folders under public/data/campaigns/, mapped to their
// filenames — confirmed against disk. Unlike Letters (one file holds many
// records), Campaigns is one file per record, same layout as Articles.
export const CAMPAIGN_FILES: Record<string, string[]> = {
  africa: ["alamein-1.json", "alamein-2.json", "gazala.json", "sonnenblume.json", "tobruk.json"],
  atlantic: ["altmark.json", "atlantic.json", "convoy-war.json", "rheinubung.json", "river-plate.json", "uboat-campaing.json"],
  "eastern-front": ["barbarossa.json", "blue.json", "caucasus.json", "kharkov.json", "kiev.json", "leningrad.json", "moscow.json", "stalingrad.json"],
  italy: ["cassino.json", "crete.json", "gothic-line.json", "sicily.json", "taranto.json"],
  "western-front": ["britain.json", "bulge.json", "bzura.json", "dieppe.json", "dunkirk.json", "france.json", "market-garden.json", "normandy.json", "norway.json", "poland.json", "warsaw.json"],
};

interface CombatantsSideObject {
  commanders?: string[];
  strength?: string;
  nations?: string[];
}
type CombatantsSideRaw = CombatantsSideObject | string;
interface CombatantsRaw {
  axis?: CombatantsSideRaw;
  allied?: CombatantsSideRaw;
}
interface PhaseRaw {
  name?: string;
  dates?: string;
  description?: string;
  objective?: string;
  result?: string;
  period?: string;
}

export interface LegacyCampaign {
  id: string;
  recordId?: string;
  title?: string;
  subtitle?: string;
  theater?: string;
  theatre?: string;
  dates?: { start?: string; end?: string };
  date_start?: string;
  date_end?: string;
  combatants?: CombatantsRaw;
  commanders?: { axis?: string; allied?: string };
  phases?: PhaseRaw[];
  casualties?: Record<string, string>;
  background?: string;
  context?: string;
  outcome?: string;
  significance?: string;
  summary?: string;
  image?: string;
  sources?: unknown;
  related_records?: unknown;
  // One-off extension fields exist (e.g. sonnenblume's events, convoy-war's
  // wolfpack_tactics/turning_point, dunkirk's key_events) — this index
  // signature is what lets them flow through without the mapper needing to
  // know their names in advance, same mechanism as Articles.
  [key: string]: unknown;
}

export interface NormalizedCombatantsSide {
  commanders: string[];
  strength: string | null;
  nations: string[];
}
export interface NormalizedCombatants {
  axis: NormalizedCombatantsSide;
  allied: NormalizedCombatantsSide;
}
export interface NormalizedPhase {
  name: string;
  dates: string | null;
  description: string | null;
  objective: string | null;
  result: string | null;
  period: string | null;
}

// Every top-level field this mapper explicitly understands. Anything else
// found on a real campaign record — including the dead Schema-B leftovers
// (theatre, date_start, date_end) carried by the 4 hybrid files alongside
// their real Schema-A fields — is preserved as a pass-through "extra"
// rather than silently dropped, same mechanism as Articles.
const KNOWN_FIELDS = new Set([
  "id", "recordId", "title", "subtitle", "theater", "theatre", "dates", "date_start", "date_end",
  "combatants", "commanders", "phases", "casualties", "background", "context",
  "outcome", "significance", "summary", "image", "sources", "related_records",
]);

function normalizeCombatantsSide(side: CombatantsSideRaw | undefined, commanderName: string | undefined): NormalizedCombatantsSide {
  if (side && typeof side === "object") {
    return {
      commanders: Array.isArray(side.commanders) ? side.commanders : [],
      strength: pick(side.strength) ?? null,
      nations: Array.isArray(side.nations) ? side.nations : [],
    };
  }
  if (typeof side === "string") {
    // Schema B: combatants.<side> is a flat force-description string, and
    // the actual commander's name lives in a separate top-level commanders
    // object — confirmed in river-plate.json/altmark.json/uboat-campaing.json.
    return { commanders: commanderName ? [commanderName] : [], strength: side, nations: [] };
  }
  return { commanders: [], strength: null, nations: [] };
}

// Returns null — not a defaulted empty shape — when the source has no
// combatants field at all (atlantic.json, convoy-war.json), so the
// conformance validator can distinguish "genuinely missing" from "present
// but sparse" instead of having that distinction silently erased by a
// default applied here. The generator supplies the safe empty-shape
// default at publish time instead — see campaigns.generator.ts.
export function normalizeCombatants(combatants: CombatantsRaw | undefined, commanders: { axis?: string; allied?: string } | undefined): NormalizedCombatants | null {
  if (!combatants) return null;
  return {
    axis: normalizeCombatantsSide(combatants.axis, commanders?.axis),
    allied: normalizeCombatantsSide(combatants.allied, commanders?.allied),
  };
}

// Three real shapes collapse into one wide, mostly-null shape rather than
// forcing genuinely different fields into each other — barbarossa's
// objective/result and uboat-campaing's period are real, distinct content,
// not renames of "description".
export function normalizePhases(phases: PhaseRaw[] | undefined): NormalizedPhase[] {
  if (!Array.isArray(phases)) return [];
  return phases.map((p) => ({
    name: p.name ?? "",
    dates: pick(p.dates) ?? null,
    description: pick(p.description) ?? null,
    objective: pick(p.objective) ?? null,
    result: pick(p.result) ?? null,
    period: pick(p.period) ?? null,
  }));
}

function extractExtras(campaign: LegacyCampaign): Record<string, unknown> {
  return Object.fromEntries(Object.entries(campaign).filter(([key]) => !KNOWN_FIELDS.has(key)));
}

// Same philosophy as Letters' deriveExcerpt: when there's no explicit
// summary, fall back to the next-best prose field rather than publishing
// with nothing. Priority is context, then significance, then outcome —
// context is the fullest narrative field when present, significance and
// outcome are shorter but still real prose, never fabricated. 160 chars is
// the same truncation length letters.generator.ts uses for excerpt, kept
// consistent as "the standard summary length" rather than inventing a new
// one. Shared by both campaigns.conformance.ts (to decide error vs.
// warning) and campaigns.generator.ts (to produce the actual value) so the
// two can never silently drift apart on what counts as derivable.
export function deriveSummary(context: string | undefined, significance: string | undefined, outcome: string | undefined): string | undefined {
  const text = pick(context, significance, outcome);
  if (!text) return undefined;
  return text.length > 160 ? `${text.slice(0, 160)}...` : text;
}

export function toRecordCreateInput(campaign: LegacyCampaign, theater: string, collectionId: string) {
  const normalizedCombatants = normalizeCombatants(campaign.combatants, campaign.commanders);
  const normalizedPhases = normalizePhases(campaign.phases);
  const extras = extractExtras(campaign);
  const startDate = pick(campaign.dates?.start, campaign.date_start);
  const endDate = pick(campaign.dates?.end, campaign.date_end);
  // Recovery: reuse the original database id (embedded by the publish
  // pipeline's recordId backfill) when present, so restored rows keep
  // their pre-loss identity instead of getting a fresh cuid.
  const recordId = typeof campaign.recordId === "string" ? campaign.recordId : undefined;

  return {
    ...(recordId ? { id: recordId } : {}),
    type: "CAMPAIGN",
    slug: campaign.id,
    collectionId,
    title: campaign.title ?? campaign.id,
    summary: campaign.summary ?? null,
    content: null,
    date: startDate ? new Date(startDate) : null,
    nationality: null,
    published: true,
    metadata: {
      ...extras, // spread first — explicit fields below always win on a name collision
      // theater is always the folder it was read from, never the in-file
      // theater/theatre field — theatre is a free-text label ("South
      // Atlantic"), not a slug, and the in-file theater field (when
      // present) has been confirmed to always agree with the folder
      // anyway, so the folder is the trustworthy source either way.
      theater,
      region_label: pick(campaign.theatre) ?? null,
      dates: { start: startDate ?? null, end: endDate ?? null },
      combatants: normalizedCombatants,
      phases: normalizedPhases,
      casualties: campaign.casualties ?? null,
      background: campaign.background ?? null,
      context: campaign.context ?? null,
      outcome: campaign.outcome ?? null,
      significance: campaign.significance ?? null,
      image: campaign.image ?? null,
      sources: campaign.sources ?? null,
      related_records: campaign.related_records ?? null,
    },
  };
}

export function toCandidateRecord(campaign: LegacyCampaign, theater: string): RecordLike {
  const input = toRecordCreateInput(campaign, theater, "dry-run-no-collection-id");
  return {
    id: campaign.id,
    title: input.title,
    slug: campaign.id,
    summary: input.summary,
    content: input.content,
    date: input.date,
    nationality: input.nationality,
    tags: [],
    published: true,
    metadata: input.metadata,
  };
}
