/**
 * Fixes the bare-date save-failure defect (Task #50): `<input type="date">`
 * (and Personnel's manually-typed "YYYY-MM-DD" field) send a date-only
 * string like "1940-07-10". `express-validator`'s `isISO8601()` accepts
 * that — ISO-8601 permits date-only representations — but Prisma Client's
 * own stricter string parser requires a full datetime and throws
 * `PrismaClientValidationError` on a bare date, surfacing as a raw 500 on
 * any create/update that includes one.
 *
 * The fix is to convert through the native `Date` constructor before the
 * value ever reaches Prisma. Per the ECMAScript Date Time String Format
 * spec, a date-ONLY string with no time component is always interpreted
 * as UTC midnight (unlike a datetime-without-timezone string, which is
 * parsed as local time) — so "1940-07-10" always becomes exactly
 * 1940-07-10T00:00:00.000Z, never a neighboring calendar day, regardless
 * of the server's local timezone. This is the same technique
 * timeline.service.ts already used correctly; this utility generalizes it
 * so every date-bearing module shares one implementation instead of each
 * reinventing (or omitting) the conversion.
 */

/**
 * Normalizes one date-like value for a Prisma `DateTime?` field.
 * - `undefined` (key absent) stays `undefined` — Prisma treats `undefined`
 *   as "field not provided", so on an update this leaves the column
 *   untouched rather than overwriting it.
 * - `null` or an empty/whitespace string means "clear this field" — both
 *   normalize to `null`.
 * - A `Date` instance passes through unchanged (already resolved).
 * - Any other string is parsed via `new Date(...)`; malformed input
 *   normalizes to `undefined` (dropped, not crashed) as a defense-in-depth
 *   fallback — the callers below all sit behind an `isISO8601()` validator
 *   that should already reject genuinely malformed input before it gets
 *   this far.
 */
export function normalizeDateInput(value: unknown): Date | null | undefined {
  if (value === undefined) return undefined;
  if (value === null) return null;
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? undefined : value;
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  if (!trimmed) return null;
  const parsed = new Date(trimmed);
  return Number.isNaN(parsed.getTime()) ? undefined : parsed;
}

/**
 * Normalizes every listed date key on an already-allowlisted `fields`
 * object, in place, for services that build their Prisma `data` via
 * `pick*Fields()` (Campaigns/Letters/Records/Personnel). Only touches
 * keys actually present, so omitted fields keep meaning "don't touch this
 * column" on an update.
 */
export function normalizeDateFields<T extends Record<string, unknown>>(fields: T, keys: readonly string[]): T {
  for (const key of keys) {
    if (key in fields) {
      fields[key as keyof T] = normalizeDateInput(fields[key]) as T[keyof T];
    }
  }
  return fields;
}
