/**
 * What an editorial save is allowed to contain.
 *
 * Until now /api/site-content accepted any JSON body and wrote it straight
 * over the file. Two things made that risky once the file also has history:
 * a save could replace a structured manifest with a scalar and the history
 * would faithfully record the damage, and a save could overwrite fields that
 * the promotion pipeline recomputes — which the next promotion would silently
 * revert, making the Admin appear to lose the edit.
 *
 * This module answers "may this body replace that file", and nothing else. It
 * does not merge: field ownership for regeneration is a separate change
 * (D4–D6) and is deliberately not implemented here.
 */

import { INDEX_SCHEMAS } from "../publish/index-schema";

export interface ValidationFailure {
  status: 400 | 409;
  message: string;
}

/** Fields on a section manifest that the promotion pipeline owns. */
export interface GeneratedSpec {
  arrayKey: string;
  entryKey: "id";
  /**
   * Field paths on each entry that regeneration recomputes. A path may be
   * nested ("metadata.slug"), in which case only that leaf is owned and the
   * object containing it stays editable.
   */
  fields: readonly string[];
  /**
   * True when the pipeline owns the entry's identity — and therefore the
   * entry itself, so one cannot be added by hand. Derived from the schema
   * claiming the entry key rather than declared separately.
   */
  ownsEntry: boolean;
}

/**
 * Pipeline ownership, derived from INDEX_SCHEMAS.
 *
 * This was a second hand-written list, and it drifted exactly as a duplicated
 * declaration does: when letters.count became derived in D5, this list still
 * said it was editorial, so the API would have accepted a count that the next
 * regeneration silently discarded. Deriving it means the rule the API enforces
 * and the rule regeneration applies cannot disagree — there is one declaration.
 *
 * Keys absent from this map have no generated fields.
 */
export const GENERATED_FIELDS: Readonly<Record<string, GeneratedSpec>> = Object.freeze(
  Object.fromEntries(
    Object.values(INDEX_SCHEMAS).map((schema) => [
      `${schema.type}/index.json`,
      {
        arrayKey: schema.arrayKey,
        entryKey: "id" as const,
        fields: schema.generated,
        // A schema that recomputes the entry's own id is rebuilding entries
        // from published records, so an entry has no meaning until one exists.
        ownsEntry: schema.generated.includes("id"),
      },
    ]),
  ),
);

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function sameValue(a: unknown, b: unknown): boolean {
  // Order-sensitive on purpose: generated arrays are written in a defined
  // order (sorted directory scans), so a reordering is a real change.
  return JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
}

function topLevelKind(value: unknown): "object" | "array" | "other" {
  if (Array.isArray(value)) return "array";
  if (isPlainObject(value)) return "object";
  return "other";
}

/**
 * Reads a possibly-nested field path, so a schema that owns "metadata.slug"
 * is compared at that leaf instead of treating all of "metadata" as owned.
 */
function valueAtPath(source: unknown, fieldPath: string): unknown {
  let cursor: unknown = source;
  for (const segment of fieldPath.split(".")) {
    if (!isPlainObject(cursor)) return undefined;
    cursor = cursor[segment];
  }
  return cursor;
}

function entryId(entry: unknown): string | null {
  if (!isPlainObject(entry)) return null;
  return typeof entry.id === "string" ? entry.id : null;
}

/**
 * Checks `incoming` against the file it would replace.
 *
 * `current` is the parsed current content, or null when the file does not
 * exist yet — in which case there is nothing to compare against and only the
 * shape of the body itself is checked.
 *
 * Returns null when the write is acceptable.
 */
export function validateContent(
  key: string,
  incoming: unknown,
  current: unknown | null,
  /** Overridden only by tests, to exercise ownership shapes no schema uses yet. */
  specs: Readonly<Record<string, GeneratedSpec>> = GENERATED_FIELDS,
): ValidationFailure | null {
  // ── The body itself ────────────────────────────────────────
  const incomingKind = topLevelKind(incoming);
  if (incomingKind === "other") {
    return {
      status: 400,
      message:
        "Content must be a JSON object or array. A string, number, boolean or null " +
        "would replace the whole file with a scalar.",
    };
  }

  if (current === null) return null; // new file — nothing to compare

  // ── Destructive shape changes ──────────────────────────────
  const currentKind = topLevelKind(current);
  if (currentKind !== "other" && incomingKind !== currentKind) {
    return {
      status: 409,
      message: `Content must stay a JSON ${currentKind}; this save would change it to a ${incomingKind}.`,
    };
  }

  if (isPlainObject(current) && isPlainObject(incoming)) {
    const dropped = Object.keys(current).filter((k) => !(k in incoming));
    if (dropped.length > 0) {
      return {
        status: 409,
        message:
          `This save would remove top-level field(s) ${dropped.map((d) => `"${d}"`).join(", ")}. ` +
          "Removing existing fields is not permitted through this API.",
      };
    }
  }

  // ── Generated fields ───────────────────────────────────────
  const spec = specs[key];
  if (!spec || !isPlainObject(current) || !isPlainObject(incoming)) return null;

  const currentArray = current[spec.arrayKey];
  const incomingArray = incoming[spec.arrayKey];
  if (!Array.isArray(currentArray)) return null; // nothing generated to protect yet

  if (!Array.isArray(incomingArray)) {
    return {
      status: 409,
      message: `"${spec.arrayKey}" must remain an array.`,
    };
  }

  const currentIds = new Set<string>();
  for (const entry of currentArray) {
    const id = entryId(entry);
    if (id !== null) currentIds.add(id);
  }

  const incomingById = new Map<string, unknown>();
  for (const entry of incomingArray) {
    const id = entryId(entry);
    if (id === null) continue;
    incomingById.set(id, entry);

    // An entry whose identity the pipeline owns cannot be created by hand:
    // regeneration builds these from the published record files and would
    // drop anything with no file behind it, so accepting the save would be
    // accepting an edit that silently disappears.
    if (spec.ownsEntry && !currentIds.has(id)) {
      return {
        status: 409,
        message:
          `"${spec.arrayKey}" is built from the published record files, so "${id}" ` +
          `cannot be added here. Publish the record instead.`,
      };
    }
  }

  for (const currentEntry of currentArray) {
    const id = entryId(currentEntry);
    if (id === null) continue;

    const incomingEntry = incomingById.get(id);
    if (incomingEntry === undefined) {
      return {
        status: 409,
        message:
          `This save would remove "${id}" from "${spec.arrayKey}". ` +
          "Removing entries is not permitted through this API.",
      };
    }
    if (!isPlainObject(currentEntry) || !isPlainObject(incomingEntry)) continue;

    for (const field of spec.fields) {
      if (!sameValue(valueAtPath(currentEntry, field), valueAtPath(incomingEntry, field))) {
        return {
          status: 409,
          message:
            `"${spec.arrayKey}[${id}].${field}" is regenerated from the published content ` +
            `and cannot be edited here. Labels, ordering and your own metadata are editable; ` +
            `this field is not.`,
        };
      }
    }
  }

  return null;
}
