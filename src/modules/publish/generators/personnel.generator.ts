import { EntityLike } from "../publish.types";
import { RelatedRecordEntry } from "../import-validation/personnel-entity-mapper";
import { resolveRelatedUrl } from "../related-url-resolver";

export interface PersonnelJson {
  id: string;
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
    url: link.url ?? resolveRelatedUrl("Personnel", link.id),
  }));
  // Always resolved fresh, never the source's own url — Personnel's
  // source data carries the same stale theater-prefixed Campaign urls
  // (e.g. /campaigns/africa/gazala) that the Campaigns migration itself
  // stopped trusting, since they 404 against the real flat route. Trusting
  // link.url here would silently reintroduce that bug into Personnel's
  // output even though Campaigns' own output is already fixed.
  const resolvedOtherLinks = otherLinks.map((link) => ({
    ...link,
    url: resolveRelatedUrl(link.type, link.id),
  }));

  const extras: Record<string, unknown> = {};
  if (entity.metadata) {
    for (const [key, value] of Object.entries(entity.metadata)) {
      if (!EXPLICIT_FIELDS.has(key) && key !== "importRunId") extras[key] = value;
    }
  }

  return {
    ...extras,
    id: entity.slug ?? entity.id,
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
