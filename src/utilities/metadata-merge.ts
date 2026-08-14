/**
 * Prevents the metadata-loss bug found during the Batch 3 Campaigns
 * migration: a `Json` column update REPLACES the stored value wholesale —
 * there is no partial/deep update for JSON columns in Prisma. Every
 * Record-backed content service builds its `metadata` update from only the
 * fields its own Admin form manages (e.g. Campaigns' form has no UI for
 * `combatants`/`phases`/`casualties`/`background`/`image` — fields that
 * exist in real records from the original import but that the admin form
 * simply never echoes back). Passing that narrower object straight to
 * `prisma.record.update()` silently destroys every field the incoming
 * object doesn't mention, on every single save — not just for fields known
 * about today, but for any metadata field ever written by any other path
 * (import, a future admin field, a future integration) that the current
 * form doesn't happen to represent.
 *
 * The fix is not a longer allowlist — a longer list still drops whatever
 * isn't on it. It's fetching the record's CURRENT metadata immediately
 * before the write and shallow-merging the incoming object on top, so:
 *   - keys the incoming object sets (including explicitly to `null`) win —
 *     an admin editing "theater" and saving is expected to change theater.
 *   - keys the incoming object never mentions survive untouched — a save
 *     that only knows about `theater`/`dates`/`context`/etc. cannot destroy
 *     `combatants`/`phases`/anything else it was never told about, now or
 *     in the future.
 */
export function mergeMetadata(existing: unknown, incoming: unknown): Record<string, unknown> | undefined {
  const existingObj = existing && typeof existing === "object" && !Array.isArray(existing)
    ? (existing as Record<string, unknown>)
    : undefined;

  if (incoming === undefined) return existingObj;

  const incomingObj = incoming && typeof incoming === "object" && !Array.isArray(incoming)
    ? (incoming as Record<string, unknown>)
    : undefined;

  if (!incomingObj) return incomingObj as Record<string, unknown> | undefined;

  return { ...(existingObj ?? {}), ...incomingObj };
}
