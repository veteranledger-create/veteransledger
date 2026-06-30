import { EntityLike } from "../publish.types";
import { RelatedRecordEntry } from "../import-validation/personnel-entity-mapper";

export interface PersonnelJson {
  id: string;
  /** DB primary key — distinct from `id` (the public slug). Used by the
   *  translation system, which keys translations by the stable DB id
   *  rather than the human-editable slug. */
  recordId: string;
  name: string;
  rank?: string;
  branch: string;
  portrait?: string;
  born?: string;
  died?: string;
  birthplace?: string;
  biography?: string;
  commands?: string[];
  awards?: string[];
  campaigns?: string[];
  sources?: unknown;
  related_records?: RelatedRecordEntry[];
  nation?: string;
  service?: string;
  // One-off extension fields (kills, tank_kills, ships_sunk/tonnage_sunk,
  // aircraft, vehicles) pass through here, untyped — see
  // personnel-entity-mapper.ts's extractExtras for where they're collected.
  [key: string]: unknown;
}

const EXPLICIT_FIELDS = new Set([
  "branch", "service", "birthplace", "portrait", "rank", "commands",
  "awards", "campaigns", "sources", "related_records",
]);

function meta(entity: EntityLike, key: string): unknown {
  return entity.metadata ? entity.metadata[key] : undefined;
}

function asString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0 ? value : undefined;
}

function asStringArray(value: unknown): string[] | undefined {
  return Array.isArray(value) ? (value as string[]) : undefined;
}

// Necessary deviation from the Letters/Articles/Campaigns generator
// signature: part of a Personnel record's related_records lives in a
// different table entirely (real Relationship rows for Personnel-to-
// Personnel links, per the approved architecture), so this can't be a
// pure function of the entity alone. personnelLinks is the resolved set
// of that entity's outgoing Personnel-type Relationship rows, supplied by
// the caller — kept as an explicit parameter rather than a Prisma query
// inside this function, so it stays a pure, independently-testable
// function like every other generator.
export function toPersonnelJson(entity: EntityLike, personnelLinks: RelatedRecordEntry[]): PersonnelJson {
  const otherLinksRaw = meta(entity, "related_records");
  const otherLinks = Array.isArray(otherLinksRaw) ? (otherLinksRaw as RelatedRecordEntry[]) : [];

  const resolvedPersonnelLinks = personnelLinks.map((link) => ({
    id: link.id,
    title: link.title,
    type: "Personnel",
  }));
  const resolvedOtherLinks = otherLinks.map(({ id, title, type }) => ({ id, title, type }));

  const extras: Record<string, unknown> = {};
  if (entity.metadata) {
    for (const [key, value] of Object.entries(entity.metadata)) {
      if (!EXPLICIT_FIELDS.has(key) && key !== "importRunId") extras[key] = value;
    }
  }

  return {
    ...extras,
    id: entity.slug ?? entity.id,
    recordId: entity.id,
    name: entity.name,
    rank: asString(meta(entity, "rank")),
    branch: asString(meta(entity, "branch")) ?? "unknown",
    portrait: asString(meta(entity, "portrait")),
    born: entity.birthDate ? entity.birthDate.toISOString().slice(0, 10) : undefined,
    died: entity.deathDate ? entity.deathDate.toISOString().slice(0, 10) : undefined,
    birthplace: asString(meta(entity, "birthplace")),
    biography: asString(entity.biography),
    commands: asStringArray(meta(entity, "commands")),
    awards: asStringArray(meta(entity, "awards")),
    campaigns: asStringArray(meta(entity, "campaigns")),
    sources: meta(entity, "sources") ?? undefined,
    related_records: [...resolvedPersonnelLinks, ...resolvedOtherLinks],
    nation: asString(entity.nationality),
    service: asString(meta(entity, "service")),
  };
}
