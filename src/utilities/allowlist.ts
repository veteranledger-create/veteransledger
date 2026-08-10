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
 */

const RECORD_CONTENT_FIELDS = [
  "title", "summary", "content", "date", "startDate", "endDate",
  "location", "nationality", "metadata", "tags", "published",
] as const;

const ENTITY_CONTENT_FIELDS = [
  "name", "nationality", "birthDate", "deathDate",
  "summary", "biography", "metadata", "tags", "published",
] as const;

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

/** Allowlisted fields for Entity-backed content types (Personnel). */
export function pickEntityFields(input: object): Record<string, unknown> {
  return pick(input as Record<string, unknown>, ENTITY_CONTENT_FIELDS);
}
