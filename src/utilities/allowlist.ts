/**
 * Field allowlists for the "thin" content services (Letters/Campaigns/
 * Articles ride directly on Record; Personnel rides directly on Entity)
 * that previously passed req.body straight into prisma.*.create/update with
 * no allowlist — matching the safer pattern armaments.service.ts's
 * buildRecordData() and timeline.service.ts's toDbData() already used.
 *
 * Deliberately excludes id/type/slug/collectionId/createdAt/updatedAt:
 * type is fixed per-service (set by the caller, not the client), slug is
 * server-generated once at create time where it applies, and the rest are
 * either server-managed or immutable identity fields that must never come
 * from request input.
 *
 * Formations is the one Record-backed type where slug genuinely IS a
 * client-supplied field (the Admin form has a required "ID / Slug" input;
 * there is no server-side slug generator for Formations the way
 * armaments.service.ts's resolveUniqueSlug() has for Armaments) — so it
 * gets its own allowlist that adds slug back in, rather than broadening
 * RECORD_CONTENT_FIELDS (and quietly re-opening slug for Letters/Campaigns/
 * Articles, which intentionally never accept it from the client).
 */

const RECORD_CONTENT_FIELDS = [
  "title", "summary", "content", "date", "startDate", "endDate",
  "location", "nationality", "metadata", "tags", "published",
] as const;

const FORMATION_CONTENT_FIELDS = [
  ...RECORD_CONTENT_FIELDS, "slug",
] as const;

const ENTITY_CONTENT_FIELDS = [
  "name", "nationality", "birthDate", "deathDate",
  "summary", "biography", "metadata", "tags", "published",
] as const;

// records.service.ts is the one Record-backed service with no dedicated
// module of its own — it's the generic /api/records endpoint that Awards,
// Maps, and Political Documents all share, dispatching behavior by `type`.
// That makes `type` a legitimate, necessary client input here (unlike every
// other pick*Fields function, where type is fixed server-side) — but it
// must stay restricted to the record types this generic endpoint actually
// manages, not the full Record.type enum (which also includes ARMAMENT,
// LETTER, PERSON, FORMATION, etc.) — otherwise a call to this endpoint
// could relabel a submission as any other content type.
const GENERIC_RECORD_TYPES = ["AWARD", "MAP", "POLITICAL_DOCUMENT"] as const;

function pick(input: Record<string, unknown>, allowed: readonly string[]): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const key of allowed) {
    if (input[key] !== undefined) out[key] = input[key];
  }
  return out;
}

/** Allowlisted fields for Record-backed content types (Letters/Campaigns/Articles). */
export function pickRecordFields(input: object): Record<string, unknown> {
  return pick(input as Record<string, unknown>, RECORD_CONTENT_FIELDS);
}

/** Allowlisted fields for Formations — Record-backed, plus client-supplied slug. */
export function pickFormationFields(input: object): Record<string, unknown> {
  return pick(input as Record<string, unknown>, FORMATION_CONTENT_FIELDS);
}

/** Allowlisted fields for Entity-backed content types (Personnel). */
export function pickEntityFields(input: object): Record<string, unknown> {
  return pick(input as Record<string, unknown>, ENTITY_CONTENT_FIELDS);
}

/**
 * Allowlisted fields for the generic /api/records endpoint (Awards/Maps/
 * Political Documents). `type` is included but constrained to the three
 * types this endpoint legitimately manages — invalid/foreign values are
 * dropped rather than passed through, so a request can't relabel a record
 * as ARMAMENT/LETTER/PERSON/etc. via this endpoint.
 */
export function pickGenericRecordFields(input: object): Record<string, unknown> {
  const picked = pick(input as Record<string, unknown>, RECORD_CONTENT_FIELDS);
  const type = (input as Record<string, unknown>).type;
  if (typeof type === "string" && (GENERIC_RECORD_TYPES as readonly string[]).includes(type)) {
    picked.type = type;
  }
  return picked;
}
