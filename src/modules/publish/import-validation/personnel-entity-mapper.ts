import { EntityLike } from "../publish.types";
import { pick } from "./text-utils";

// One array-of-records file per branch — closer to Letters' shape (one
// file holds many records) than Articles'/Campaigns' one-file-per-record
// layout. "foreign" is the 5th bucket, not a nationality sub-split.
export const PERSONNEL_FILES: Record<string, string> = {
  army: "army.json",
  kriegsmarine: "kriegsmarine.json",
  luftwaffe: "luftwaffe.json",
  "waffen-ss": "waffen-ss.json",
  foreign: "foreign.json",
};

export interface RelatedRecordEntry {
  id: string;
  title?: string;
  type?: string;
}

export interface LegacyPersonnel {
  id: string;
  recordId?: string;
  name: string;
  rank?: string;
  branch?: string;
  portrait?: string;
  born?: string;
  died?: string;
  birthplace?: string;
  biography?: string;
  commands?: string[];
  awards?: string[];
  campaigns?: string[];
  sources?: unknown;
  related_records?: unknown;
  nation?: string;
  service?: string;
  // The three real, incompatible "kills" vocabularies (kills, tank_kills,
  // ships_sunk+tonnage_sunk) plus aircraft/vehicles arrays — this index
  // signature is what lets them flow through without the mapper needing
  // to know their names in advance, same mechanism as Articles/Campaigns.
  [key: string]: unknown;
}

const KNOWN_FIELDS = new Set([
  "id", "recordId", "name", "rank", "branch", "portrait", "born", "died", "birthplace",
  "biography", "commands", "awards", "campaigns", "sources", "related_records",
  "nation", "service",
]);

export interface SplitRelatedRecords {
  // Real Relationship rows can only connect Entity-to-Entity — these are
  // the only related_records entries that schema feature actually fits.
  personnelLinks: { id: string; title?: string }[];
  // Everything else (Campaign/Letter/Article/Armament targets) stays in
  // metadata JSON, the same mechanism Letters/Articles/Campaigns already
  // use for their own related_records — never duplicated into both places.
  otherLinks: RelatedRecordEntry[];
}

export function splitRelatedRecords(related: unknown): SplitRelatedRecords {
  const arr = Array.isArray(related) ? (related as Array<Record<string, unknown>>) : [];
  const personnelLinks: SplitRelatedRecords["personnelLinks"] = [];
  const otherLinks: RelatedRecordEntry[] = [];
  for (const entry of arr) {
    if (typeof entry?.id !== "string") continue;
    const type = typeof entry.type === "string" ? entry.type : undefined;
    const title = typeof entry.title === "string" ? entry.title : undefined;
    if (type === "Personnel") {
      personnelLinks.push({ id: entry.id, title });
    } else {
      otherLinks.push({ id: entry.id, title, type });
    }
  }
  return { personnelLinks, otherLinks };
}

function extractExtras(person: LegacyPersonnel): Record<string, unknown> {
  return Object.fromEntries(Object.entries(person).filter(([key]) => !KNOWN_FIELDS.has(key)));
}

export function toEntityCreateInput(person: LegacyPersonnel, branch: string) {
  const extras = extractExtras(person);
  const { otherLinks } = splitRelatedRecords(person.related_records);
  // Recovery: reuse the original database id (embedded by the publish
  // pipeline's recordId backfill) when present, so restored rows keep
  // their pre-loss identity instead of getting a fresh cuid.
  const recordId = typeof person.recordId === "string" ? person.recordId : undefined;

  return {
    ...(recordId ? { id: recordId } : {}),
    type: "PERSON",
    slug: person.id,
    name: person.name ?? person.id,
    nationality: pick(person.nation) ?? null,
    birthDate: person.born ? new Date(person.born) : null,
    deathDate: person.died ? new Date(person.died) : null,
    summary: null,
    biography: person.biography ?? null,
    tags: [],
    published: true,
    metadata: {
      ...extras, // spread first — explicit fields below always win on a name collision
      branch,
      service: person.service ?? null,
      birthplace: person.birthplace ?? null,
      // Verbatim, dead or not — never fabricated, never "fixed". See
      // personnel-import-check.ts's imageStats for the dead-link count.
      portrait: person.portrait ?? null,
      rank: person.rank ?? null,
      commands: person.commands ?? [],
      awards: person.awards ?? [],
      campaigns: person.campaigns ?? [],
      sources: person.sources ?? null,
      related_records: otherLinks,
    },
  };
}

export function toCandidateEntity(person: LegacyPersonnel, branch: string): EntityLike {
  const input = toEntityCreateInput(person, branch);
  return {
    id: person.id,
    name: input.name,
    slug: person.id,
    nationality: input.nationality,
    birthDate: input.birthDate,
    deathDate: input.deathDate,
    summary: input.summary,
    biography: input.biography,
    tags: input.tags,
    published: true,
    metadata: input.metadata,
  };
}

// ── General slug/name conflict detection ────────────────────────────────
// Replaces what would otherwise be a hardcoded single-id denylist (the
// erwin-rommel-afk / Ettore Muti case found in the Phase 4 audit) with a
// general cross-record check: does this record's id look like it was
// derived from a DIFFERENT record's name, more than its own? This is
// deliberately narrower than a generic "id doesn't match name" check
// (which would false-positive on legitimate short ids, nicknames, and
// disambiguation suffixes) — it only fires when another real record's name
// overlaps the id's tokens MORE than the record's own name does, which is
// the actual signature of "this id belongs to someone else in this exact
// dataset," not just "this id isn't a literal slugification of the name."
function tokenize(text: string): Set<string> {
  return new Set(
    text.toLowerCase().replace(/[^a-z0-9\s-]/g, "").split(/[\s-]+/).filter(Boolean),
  );
}

function tokenOverlap(a: Set<string>, b: Set<string>): number {
  let count = 0;
  for (const t of a) if (b.has(t)) count++;
  return count;
}

export interface SlugNameConflict {
  id: string;
  recordName: string;
  suspectedActualId: string;
  suspectedActualName: string;
  overlapScore: number;
}

export function detectSlugNameConflicts(all: LegacyPersonnel[]): SlugNameConflict[] {
  const conflicts: SlugNameConflict[] = [];
  for (const person of all) {
    if (typeof person.id !== "string" || typeof person.name !== "string") continue;
    const idTokens = tokenize(person.id);
    const ownOverlap = tokenOverlap(idTokens, tokenize(person.name));

    let best: { other: LegacyPersonnel; overlap: number } | undefined;
    for (const other of all) {
      if (other === person || typeof other.name !== "string") continue;
      const overlap = tokenOverlap(idTokens, tokenize(other.name));
      // Require at least 2 shared tokens (e.g. first + last name) so a
      // single common word can't trigger a false positive, and require
      // strictly more overlap than the record has with its own name.
      if (overlap >= 2 && overlap > ownOverlap && (!best || overlap > best.overlap)) {
        best = { other, overlap };
      }
    }

    if (best) {
      conflicts.push({
        id: person.id,
        recordName: person.name,
        suspectedActualId: best.other.id,
        suspectedActualName: best.other.name,
        overlapScore: best.overlap,
      });
    }
  }
  return conflicts;
}
