import { RecordLike } from "../publish.types";
import { pick } from "./text-utils";

export const CATEGORIES = ["panzer", "aircraft", "naval", "missiles", "wunderwaffen", "equipment"] as const;
export const NATIONS = ["germany", "italy", "japan", "other-axis"] as const;

// Confirmed directly against every real file — minor-schema files wrap
// their array under a category-specific key, never a single generic one
// (the live frontend's `data?.armaments || data?.items || []` always
// resolves to [] for these, which is why most minor-schema content is
// currently invisible on the site regardless of migration).
export const WRAPPER_KEY_BY_CATEGORY: Record<string, string> = {
  panzer: "vehicles",
  aircraft: "aircraft",
  naval: "vessels",
  missiles: "weapons",
  wunderwaffen: "weapons",
  equipment: "equipment",
};

export interface LegacyArmament {
  id?: string;
  name: string;
  type?: string;
  nation?: string;
  summary?: string;
  notes?: string;
  description?: string;
  image?: string;
  sources?: unknown;
  related_records?: unknown;
  // Dozens of category-specific spec fields exist (designation, crew,
  // weight_tonnes, armament, armor_mm, engine, speed_kmh/speed_knots,
  // range_km, units_produced, class, commissioned, fate, length_m,
  // wingspan_m, warhead_kg, displacement_tonnes/tons, aircraft_capacity,
  // max_speed_kmh, operational_use, calibre, rate_of_fire, ...) — this
  // index signature is what lets all of them flow through as pass-through
  // extras without the mapper needing to know their names in advance.
  [key: string]: unknown;
}

export type SchemaType = "full" | "minor";

export interface LoadedArmament {
  category: string;
  fileNation: string;
  schemaType: SchemaType;
  item: LegacyArmament;
}

// Pure — takes already-parsed JSON, never touches the filesystem itself
// (the actual fs.readFile loop lives in armaments-import-check.ts, same
// separation of concerns as every prior mapper).
export function extractItems(raw: unknown, category: string): { items: LegacyArmament[]; schemaType: SchemaType } {
  if (Array.isArray(raw)) {
    return { items: raw as LegacyArmament[], schemaType: "full" };
  }
  const obj = raw as Record<string, unknown>;
  const wrapperKey = WRAPPER_KEY_BY_CATEGORY[category];
  const arr = Array.isArray(obj[wrapperKey]) ? (obj[wrapperKey] as LegacyArmament[]) : [];
  return { items: arr, schemaType: "minor" };
}

// ── Authoritative duplicate resolutions ──────────────────────────────────
// Exactly the four cases approved in the Pre-Phase-5A Data Normalization
// Report — not a general heuristic, a named, documented, closed list.
// Each rule excludes a donor entry from ever becoming its own standalone
// record, optionally merging specific fields onto the canonical entry it
// duplicates. canonicalId identifies an existing-id canonical record
// (Yamato/Shōkaku); canonical (by category/fileNation/name) identifies an
// id-less canonical entry that itself needs synthesis (Maiale/Ohka).
interface DuplicateResolutionRule {
  donor: { category: string; fileNation: string; name: string };
  canonicalId?: string;
  canonical?: { category: string; fileNation: string; name: string };
  fieldsToMerge: string[];
  // Per the Normalization Report: Yamato/Shōkaku's canonical record
  // already HAS a (terser) fate value, so a fill-if-missing merge would
  // never apply — these two need the donor's more detailed value to win
  // outright. Maiale/Ohka's merged fields are genuinely absent from their
  // canonical entry, so fill-if-missing (the default) is correct there.
  overwriteFields?: boolean;
}

export const DUPLICATE_RESOLUTIONS: DuplicateResolutionRule[] = [
  {
    donor: { category: "naval", fileNation: "other-axis", name: "Yamato" },
    canonicalId: "yamato",
    fieldsToMerge: ["fate"],
    overwriteFields: true,
  },
  {
    donor: { category: "naval", fileNation: "other-axis", name: "Shōkaku" },
    canonicalId: "shokaku",
    fieldsToMerge: ["fate"],
    overwriteFields: true,
  },
  {
    donor: { category: "missiles", fileNation: "italy", name: "Siluro a Lenta Corsa (SLC) / 'Maiale'" },
    canonical: { category: "wunderwaffen", fileNation: "italy", name: "Siluro a Lenta Corsa (SLC) 'Maiale'" },
    fieldsToMerge: ["length_m", "warhead_kg"],
  },
  {
    donor: { category: "missiles", fileNation: "japan", name: "Ohka Model 11" },
    canonical: { category: "wunderwaffen", fileNation: "japan", name: "Ohka Model 11" },
    fieldsToMerge: ["length_m", "wingspan_m", "max_speed_kmh"],
  },
  // Phase 8A — aircraft/other-axis.json carries six minor-schema entries;
  // three are donors duplicating an existing full-schema canonical record
  // (Italy/Japan), three (Fiat CR.42 Falco, Kawasaki Ki-61 Hien, IAR 80)
  // are genuinely unique to other-axis and are NOT donors. Only "engine"
  // is merged — every canonical lacks it entirely, so fill-if-missing
  // applies cleanly. range_km and every other field are deliberately
  // excluded: Ki-43's donor range_km (3200) conflicts with its canonical's
  // (1760) — a known discrepancy to leave visible, never merged or
  // overwritten.
  {
    donor: { category: "aircraft", fileNation: "other-axis", name: "Macchi C.202 Folgore" },
    canonicalId: "mc-202-folgore",
    fieldsToMerge: ["engine"],
  },
  {
    donor: { category: "aircraft", fileNation: "other-axis", name: "Mitsubishi A6M Zero" },
    canonicalId: "a6m-zero",
    fieldsToMerge: ["engine"],
  },
  {
    donor: { category: "aircraft", fileNation: "other-axis", name: "Nakajima Ki-43 Hayabusa" },
    canonicalId: "ki-43-hayabusa",
    fieldsToMerge: ["engine"],
  },
  // Phase 9A — panzer/other-axis.json carries four minor-schema entries;
  // two (Carro Armato M13/40, Carro Armato P26/40) duplicate an existing
  // full-schema Italy canonical record; two (R-2/LT vz. 35 Romania, Toldi
  // II Hungary) are genuinely unique to other-axis and are NOT donors.
  // Only "year" is merged — both canonicals lack it entirely (they only
  // carry a years_of_service range), so fill-if-missing applies cleanly.
  // Every other donor field is a differently-schemaed duplicate of data
  // the canonical already has under a different key (weight_tons vs
  // weight_tonnes, armour_mm vs armor_mm, max_speed_kmh vs speed_kmh,
  // main_gun vs armament.primary) and sometimes conflicts in value
  // (e.g. P26/40's armour_mm 60 vs canonical armor_mm.hull_front 50) —
  // deliberately excluded, left as a known discrepancy, never merged.
  {
    donor: { category: "panzer", fileNation: "other-axis", name: "Carro Armato M13/40" },
    canonicalId: "m13-40",
    fieldsToMerge: ["year"],
  },
  {
    donor: { category: "panzer", fileNation: "other-axis", name: "Carro Armato P26/40" },
    canonicalId: "p40-heavy-tank",
    fieldsToMerge: ["year"],
  },
];

export interface DuplicateResolutionOutcome {
  description: string;
  canonicalFound: boolean;
  donorFound: boolean;
  mergeApplied: boolean;
  donorExcluded: boolean;
}

function describeRule(rule: DuplicateResolutionRule): string {
  const canonicalLabel = rule.canonicalId ?? rule.canonical?.name ?? "(unknown canonical)";
  return `${rule.donor.name} -> ${canonicalLabel}`;
}

// Tracks an explicit, per-rule outcome instead of silently skipping when a
// donor or canonical can't be found. A rule that previously matched and now
// doesn't (a donor renamed, removed, or a canonical renamed) is exactly the
// failure mode the Phase 5C verification flagged as currently invisible —
// this makes it observable in the dry-run report rather than failing silent.
export function applyDuplicateResolutions(all: LoadedArmament[]): { resolved: LoadedArmament[]; outcomes: DuplicateResolutionOutcome[] } {
  const result = [...all];
  const outcomes: DuplicateResolutionOutcome[] = [];

  for (const rule of DUPLICATE_RESOLUTIONS) {
    const donorIndex = result.findIndex(
      (l) => l.category === rule.donor.category && l.fileNation === rule.donor.fileNation && l.item.name === rule.donor.name,
    );
    const donorFound = donorIndex !== -1;

    let canonicalIndex = -1;
    if (rule.canonicalId) {
      canonicalIndex = result.findIndex((l) => l.item.id === rule.canonicalId);
    } else if (rule.canonical) {
      canonicalIndex = result.findIndex(
        (l) => l.category === rule.canonical!.category && l.fileNation === rule.canonical!.fileNation && l.item.name === rule.canonical!.name,
      );
    }
    const canonicalFound = canonicalIndex !== -1;

    let mergeApplied = false;
    let donorExcluded = false;

    if (donorFound && canonicalFound) {
      const donor = result[donorIndex];
      const canonical = result[canonicalIndex];
      let anyFieldApplied = false;
      for (const field of rule.fieldsToMerge) {
        const shouldApply = rule.overwriteFields
          ? donor.item[field] !== undefined
          : canonical.item[field] === undefined && donor.item[field] !== undefined;
        if (shouldApply) {
          canonical.item[field] = donor.item[field];
          anyFieldApplied = true;
        }
      }
      // A rule with no fields to merge (none currently exist) is trivially
      // "applied" by exclusion alone; otherwise at least one field must
      // have actually been set, or this counts as matched-but-not-applied.
      mergeApplied = rule.fieldsToMerge.length === 0 || anyFieldApplied;
      result.splice(donorIndex, 1);
      donorExcluded = true;
    }

    outcomes.push({ description: describeRule(rule), canonicalFound, donorFound, mergeApplied, donorExcluded });
  }

  return { resolved: result, outcomes };
}

// ── Stable id synthesis ──────────────────────────────────────────────────
export function slugify(name: string): string {
  return name
    .toLowerCase()
    .normalize("NFD").replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

export interface AssignedArmament extends LoadedArmament {
  id: string;
}

export function assignIds(all: LoadedArmament[]): AssignedArmament[] {
  return all.map((l) => ({ ...l, id: l.item.id ?? slugify(l.item.name) }));
}

// ── General collision detector — not a hardcoded denylist ───────────────
// Same philosophy as Personnel's detectSlugNameConflicts: a real,
// re-runnable check over the final id set, not a one-time assumption that
// the four approved resolutions are the only ones that will ever exist.
export interface IdCollision {
  id: string;
  occurrences: { category: string; fileNation: string; name: string }[];
}

export function detectIdCollisions(assigned: AssignedArmament[]): IdCollision[] {
  const byId = new Map<string, AssignedArmament[]>();
  for (const a of assigned) {
    const list = byId.get(a.id) ?? [];
    list.push(a);
    byId.set(a.id, list);
  }
  return [...byId.entries()]
    .filter(([, list]) => list.length > 1)
    .map(([id, list]) => ({ id, occurrences: list.map((l) => ({ category: l.category, fileNation: l.fileNation, name: l.item.name })) }));
}

// ── Record mapping ────────────────────────────────────────────────────────
const KNOWN_FIELDS = new Set(["id", "name", "nation", "summary", "notes", "description", "sources", "related_records", "image"]);

function extractExtras(item: LegacyArmament): Record<string, unknown> {
  return Object.fromEntries(Object.entries(item).filter(([key]) => !KNOWN_FIELDS.has(key)));
}

// Minor-schema files use either `notes` or `description` for their prose
// field (confirmed both appear, in different files) — fall back through
// both, never inventing text neither field provides.
function deriveSummary(item: LegacyArmament): string | null {
  return pick(item.summary, item.notes, item.description) ?? null;
}

function capitalizeFileNation(fileNation: string): string {
  return fileNation.split("-").map((w) => w[0].toUpperCase() + w.slice(1)).join(" ");
}

export function toRecordCreateInput(loaded: AssignedArmament, collectionId: string) {
  const { category, fileNation, schemaType, item, id } = loaded;
  const extras = extractExtras(item);
  // Nation fallback applies ONLY when the record has no real nation field
  // at all — never overwrites a real value (e.g. "Romania") with the
  // folder label ("Other Axis"), per the approved mapper rule.
  const nationality = pick(item.nation) ?? capitalizeFileNation(fileNation);

  return {
    type: "ARMAMENT",
    slug: id,
    collectionId,
    title: item.name,
    summary: deriveSummary(item),
    content: null,
    date: null,
    nationality,
    tags: [category],
    published: true,
    metadata: {
      ...extras, // spread first — explicit fields below always win on a name collision
      category,
      fileNation,
      schemaType,
      image: item.image ?? null,
      sources: item.sources ?? null,
      related_records: item.related_records ?? null,
    },
  };
}

export function toCandidateRecord(loaded: AssignedArmament): RecordLike {
  const input = toRecordCreateInput(loaded, "dry-run-no-collection-id");
  return {
    id: loaded.id,
    title: input.title,
    slug: loaded.id,
    summary: input.summary,
    content: input.content,
    date: input.date,
    nationality: input.nationality,
    tags: input.tags,
    published: true,
    metadata: input.metadata,
  };
}
