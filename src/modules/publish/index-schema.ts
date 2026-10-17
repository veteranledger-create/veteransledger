import fs from "fs/promises";
import path from "path";
import { paths } from "../../config/paths";
import { protectedRootFiles } from "./import-validation/importer-inputs";

/**
 * Declarative field ownership for the section indexes, and one merge engine
 * that applies it.
 *
 * Eight hand-written regenerators used to decide ownership implicitly, by
 * whichever object spread each happened to use. That produced three different
 * answers to the same question. Armaments, personnel and letters iterated the
 * current index and so kept its order; articles and campaigns iterated the
 * published directories and so imposed alphabetical order on it — latent
 * today only because their editorial order happens to match. And the flat
 * types returned `{ records }`, discarding every top-level and per-entry
 * editorial field there was.
 *
 * Here ownership is declared once per type and the merge is uniform:
 *
 *   - a field named in `generated` is recomputed from the published directory
 *   - every other field, including ones this code has never heard of, is
 *     carried through from the current index untouched
 *   - entries keep the order the index already has; entries newly discovered
 *     in published output are appended in sorted id order
 *
 * Generated values come exclusively from the published directory. Nothing
 * here reads the database, so an unpublished record cannot appear in an index.
 */

export type OrphanPolicy = "retain" | "drop";

/** Generated fields keyed by entry id, for the ids published output contains. */
export type GeneratedById = Map<string, Record<string, unknown>>;

export interface IndexSchema {
  type: string;
  /** The array the entries live in: "categories", "theaters", … */
  arrayKey: string;
  /** The only fields the merge is allowed to overwrite. */
  generated: readonly string[];
  /**
   * What happens to an entry the published output no longer contains.
   *
   * "retain" for container indexes — a category, theatre, branch or
   * collection is a thing an administrator creates, possibly before any
   * content exists, so removing it would delete editorial intent.
   * "drop" for flat record indexes, where an entry is one record file and an
   * entry without a file is genuinely stale.
   */
  orphanPolicy: OrphanPolicy;
  /** Used only when index.json is absent — never to replace a corrupt one. */
  defaultSkeleton(): Record<string, unknown>;
  /** Reads published output. Must not touch the database. */
  scan(targetDir: string): Promise<GeneratedById>;
  /** Generated fields for a retained entry with no published content. */
  absentGenerated(id: string): Record<string, unknown>;
  /** Non-generated fields for an entry discovered in published output. */
  newEntryDefaults(id: string): Record<string, unknown>;
}

export interface IndexRegeneration {
  relPath: string;
  content: string;
  /** Facts worth surfacing about how this index was produced. */
  notes: string[];
}

/**
 * A current index that exists but cannot be understood. Regeneration aborts
 * rather than replacing it from a skeleton, because a skeleton would silently
 * destroy every label and ordering decision the file contained.
 */
export class CorruptIndexError extends Error {
  constructor(public readonly type: string, public readonly indexPath: string, reason: string) {
    super(`Cannot regenerate ${type}/index.json — it exists but ${reason}. Fix or remove the file and promote again.`);
    this.name = "CorruptIndexError";
  }
}

/**
 * A published record file that exists but cannot be counted or projected.
 *
 * Treated the same way as a corrupt index: regeneration aborts and says so,
 * rather than writing a number derived from a file it could not understand.
 * A silently wrong count is worse than a failed promotion, because nothing
 * downstream can tell it is wrong.
 */
export class CorruptRecordError extends Error {
  constructor(public readonly type: string, public readonly recordPath: string, reason: string) {
    super(`Cannot regenerate ${type}/index.json — the published record ${recordPath} ${reason}. Fix or remove the file and promote again.`);
    this.name = "CorruptRecordError";
  }
}

// ── scanning helpers ──────────────────────────────────────────

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Root-level .json files that are published records for this type. */
async function rootRecordFiles(targetDir: string, type: string): Promise<string[]> {
  const excluded = protectedRootFiles(type);
  let entries: import("fs").Dirent[];
  try {
    entries = await fs.readdir(targetDir, { withFileTypes: true });
  } catch {
    return [];
  }
  return entries
    .filter((e) => e.isFile() && e.name.endsWith(".json") && !excluded.includes(e.name))
    .map((e) => e.name)
    .sort();
}

async function subdirectories(targetDir: string): Promise<string[]> {
  try {
    return (await fs.readdir(targetDir, { withFileTypes: true }))
      .filter((e) => e.isDirectory())
      .map((e) => e.name)
      .sort();
  } catch {
    return [];
  }
}

async function jsonFilesIn(dir: string): Promise<string[]> {
  try {
    return (await fs.readdir(dir, { withFileTypes: true }))
      .filter((e) => e.isFile() && e.name.endsWith(".json"))
      .map((e) => e.name)
      .sort();
  } catch {
    return [];
  }
}

/** One generated field per subdirectory, computed from the files inside it. */
function scanBySubdirectory(
  field: string,
  valueOf: (dirName: string, fileNames: string[]) => unknown,
): (targetDir: string) => Promise<GeneratedById> {
  return async (targetDir) => {
    const out: GeneratedById = new Map();
    for (const dirName of await subdirectories(targetDir)) {
      const files = await jsonFilesIn(path.join(targetDir, dirName));
      out.set(dirName, { [field]: valueOf(dirName, files) });
    }
    return out;
  };
}

/** One entry per root-level record file, id taken from the filename. */
function scanByRootFilename(
  type: string,
  field: string,
  valueOf: (fileName: string) => unknown,
): (targetDir: string) => Promise<GeneratedById> {
  return async (targetDir) => {
    const out: GeneratedById = new Map();
    for (const fileName of await rootRecordFiles(targetDir, type)) {
      out.set(fileName.slice(0, -".json".length), { [field]: valueOf(fileName) });
    }
    return out;
  };
}

/**
 * One entry per root-level record file, with the entry's fields projected
 * from the record's own contents.
 */
function scanRootRecords(
  type: string,
  project: (raw: Record<string, unknown>) => Record<string, unknown>,
): (targetDir: string) => Promise<GeneratedById> {
  return async (targetDir) => {
    const out: GeneratedById = new Map();
    for (const fileName of await rootRecordFiles(targetDir, type)) {
      let raw: unknown;
      try {
        raw = JSON.parse(await fs.readFile(path.join(targetDir, fileName), "utf-8"));
      } catch {
        continue; // unreadable or invalid record — not indexable, and not fatal
      }
      if (!isPlainObject(raw) || typeof raw.id !== "string" || raw.id === "") continue;
      out.set(raw.id, project(raw));
    }
    return out;
  };
}

/**
 * The letters a collection file contains.
 *
 * Verified against the published data rather than assumed: all six
 * collections are a top-level JSON array whose elements are one letter each
 * — 24 elements across the six files, each with its own id and recordId, and
 * none containing a nested list. That is also exactly what the pipeline
 * stages: generateFiles writes JSON.stringify(entries) for an array of
 * per-record letter objects.
 *
 * The { letters: [...] } wrapper is accepted too, because both public readers
 * (Letters/letters.js and Letters/record.js) accept it, so a hand-authored
 * file may legitimately use it.
 *
 * Returns null for any other shape. An object whose values happen to be
 * arrays, or a scalar, is not a collection of letters, and guessing a count
 * from it would produce a confidently wrong number.
 */
function lettersIn(parsed: unknown): unknown[] | null {
  if (Array.isArray(parsed)) return parsed;
  if (isPlainObject(parsed) && Array.isArray(parsed.letters)) return parsed.letters;
  return null;
}

/**
 * One entry per published collection file, carrying its URL and the real
 * number of letters in it.
 *
 * count was previously editorial: preserved verbatim from the index and never
 * recomputed, so it drifted. In the live archive japanese and volunteers both
 * claimed 2 while holding 4.
 */
async function scanLetterCollections(targetDir: string): Promise<GeneratedById> {
  const out: GeneratedById = new Map();
  for (const fileName of await rootRecordFiles(targetDir, "letters")) {
    const full = path.join(targetDir, fileName);

    let parsed: unknown;
    try {
      parsed = JSON.parse(await fs.readFile(full, "utf-8"));
    } catch (err) {
      throw new CorruptRecordError("letters", fileName, `is not valid JSON (${(err as Error).message})`);
    }

    const letters = lettersIn(parsed);
    if (letters === null) {
      throw new CorruptRecordError(
        "letters",
        fileName,
        "is neither a JSON array of letters nor an object with a letters array",
      );
    }

    out.set(fileName.slice(0, -".json".length), {
      file: paths.published.url("letters", fileName),
      count: letters.length,
    });
  }
  return out;
}

const capitalise = (id: string): string => id.charAt(0).toUpperCase() + id.slice(1);

// ── the eight schemas ─────────────────────────────────────────

/** Fallback category list, used only when armaments/index.json is absent. */
const DEFAULT_ARMAMENTS_CATEGORIES: ReadonlyArray<{ id: string; label: string }> = [
  { id: "panzer", label: "Panzers & Armour" },
  { id: "aircraft", label: "Aircraft" },
  { id: "naval", label: "Naval Vessels" },
  { id: "missiles", label: "Missiles & Rockets" },
  { id: "wunderwaffen", label: "Wunderwaffen" },
  { id: "equipment", label: "Infantry Equipment" },
];

const DEFAULT_PERSONNEL_BRANCHES: ReadonlyArray<{ id: string; label: string }> = [
  { id: "army", label: "Heer (Army)" },
  { id: "luftwaffe", label: "Luftwaffe" },
  { id: "kriegsmarine", label: "Kriegsmarine" },
  { id: "waffen-ss", label: "Waffen-SS" },
  { id: "foreign", label: "Foreign Volunteers" },
];

/**
 * The projection rule for pipeline-owned fields.
 *
 * Every field a schema declares as generated is owned by the publishing
 * pipeline, so its value comes from the published record and nowhere else.
 * A field the record does not supply is projected as `undefined`, which the
 * merge treats as "remove" — so a value typed in by hand cannot survive in a
 * field the pipeline owns, and a stale value left over from a record that
 * used to carry it is cleared rather than carried forward.
 *
 * "Does not supply" means undefined, null or the empty string. A 0 or a false
 * is a real value and is kept; the previous implementation used plain
 * truthiness and would have dropped both.
 */
function projectDeclared(
  raw: Record<string, unknown>,
  declared: readonly string[],
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const field of declared) {
    const value = raw[field];
    out[field] = value === undefined || value === null || value === "" ? undefined : value;
  }
  return out;
}

// Declared once and reused by both `generated` and `scan`, so the list of
// pipeline-owned fields and the projection that fills them cannot drift apart.
const AWARDS_GENERATED = ["id", "recordId", "title", "nation", "summary", "image"] as const;
const MAPS_GENERATED = ["id", "recordId", "title", "theater", "year", "image"] as const;
const POLITICAL_DOCS_GENERATED = ["id", "recordId", "title", "date", "summary", "image"] as const;

export const INDEX_SCHEMAS: Readonly<Record<string, IndexSchema>> = {
  armaments: {
    type: "armaments",
    arrayKey: "categories",
    generated: ["nations"],
    orphanPolicy: "retain",
    defaultSkeleton: () => ({
      categories: DEFAULT_ARMAMENTS_CATEGORIES.map((c) => ({ ...c, nations: [] })),
    }),
    // nations are the per-nation filenames inside the category directory.
    scan: scanBySubdirectory("nations", (_dir, files) =>
      files.map((f) => f.slice(0, -".json".length)),
    ),
    absentGenerated: () => ({ nations: [] }),
    newEntryDefaults: (id) => ({ label: id }),
  },

  articles: {
    type: "articles",
    arrayKey: "categories",
    generated: ["files"],
    orphanPolicy: "retain",
    defaultSkeleton: () => ({ categories: [] }),
    scan: scanBySubdirectory("files", (dir, files) =>
      files.map((f) => paths.published.url("articles", `${dir}/${f}`)),
    ),
    absentGenerated: () => ({ files: [] }),
    newEntryDefaults: (id) => ({ label: capitalise(id) }),
  },

  campaigns: {
    type: "campaigns",
    arrayKey: "theaters",
    generated: ["campaigns"],
    orphanPolicy: "retain",
    defaultSkeleton: () => ({ theaters: [] }),
    scan: scanBySubdirectory("campaigns", (_dir, files) =>
      files.map((f) => f.slice(0, -".json".length)),
    ),
    absentGenerated: () => ({ campaigns: [] }),
    newEntryDefaults: (id) => ({ label: id }),
  },

  personnel: {
    type: "personnel",
    arrayKey: "branches",
    generated: ["file"],
    orphanPolicy: "retain",
    defaultSkeleton: () => ({
      branches: DEFAULT_PERSONNEL_BRANCHES.map((b) => ({
        ...b,
        file: paths.published.url("personnel", `${b.id}.json`),
      })),
    }),
    scan: scanByRootFilename("personnel", "file", (name) => paths.published.url("personnel", name)),
    // The URL is derived from the id, so it stays correct for a branch whose
    // file has not been published yet — matching the previous behaviour.
    absentGenerated: (id) => ({ file: paths.published.url("personnel", `${id}.json`) }),
    newEntryDefaults: (id) => ({ label: id }),
  },

  letters: {
    type: "letters",
    arrayKey: "collections",
    // count is derived from the published collection file, so it belongs to
    // the pipeline. label, language and any other field stay editorial.
    generated: ["file", "count"],
    orphanPolicy: "retain",
    defaultSkeleton: () => ({ collections: [] }),
    scan: scanLetterCollections,
    // A collection whose file is not published has an unknown count, not a
    // count of zero — so the field is removed rather than asserted as 0.
    // The URL stays derived from the id, as it was before.
    absentGenerated: (id) => ({ file: paths.published.url("letters", `${id}.json`), count: undefined }),
    newEntryDefaults: (id) => ({ label: capitalise(id) }),
  },

  awards: {
    type: "awards",
    arrayKey: "records",
    generated: AWARDS_GENERATED,
    orphanPolicy: "drop",
    defaultSkeleton: () => ({ records: [] }),
    scan: scanRootRecords("awards", (raw) => projectDeclared(raw, AWARDS_GENERATED)),
    absentGenerated: () => ({}),
    newEntryDefaults: () => ({}),
  },

  maps: {
    type: "maps",
    arrayKey: "records",
    generated: MAPS_GENERATED,
    orphanPolicy: "drop",
    defaultSkeleton: () => ({ records: [] }),
    scan: scanRootRecords("maps", (raw) => projectDeclared(raw, MAPS_GENERATED)),
    absentGenerated: () => ({}),
    newEntryDefaults: () => ({}),
  },

  "political-docs": {
    type: "political-docs",
    arrayKey: "records",
    generated: POLITICAL_DOCS_GENERATED,
    orphanPolicy: "drop",
    defaultSkeleton: () => ({ records: [] }),
    scan: scanRootRecords("political-docs", (raw) => projectDeclared(raw, POLITICAL_DOCS_GENERATED)),
    absentGenerated: () => ({}),
    newEntryDefaults: () => ({}),
  },
};

export function schemaFor(type: string): IndexSchema | null {
  return INDEX_SCHEMAS[type] ?? null;
}

// ── reading the current index ─────────────────────────────────

type CurrentIndex =
  | { state: "missing" }
  | { state: "present"; value: Record<string, unknown>; raw: string };

/**
 * Distinguishes "no index yet" from "index I cannot understand".
 *
 * The previous helper swallowed both into null, which is how a corrupt index
 * came to be silently replaced by a skeleton — losing every label in it.
 */
async function readCurrentIndex(indexPath: string, schema: IndexSchema): Promise<CurrentIndex> {
  let raw: string;
  try {
    raw = await fs.readFile(indexPath, "utf-8");
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return { state: "missing" };
    throw new CorruptIndexError(schema.type, indexPath, `could not be read (${(err as Error).message})`);
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    throw new CorruptIndexError(schema.type, indexPath, `is not valid JSON (${(err as Error).message})`);
  }

  if (!isPlainObject(parsed)) {
    throw new CorruptIndexError(schema.type, indexPath, "is not a JSON object");
  }
  const arrayValue = parsed[schema.arrayKey];
  if (arrayValue !== undefined && !Array.isArray(arrayValue)) {
    throw new CorruptIndexError(schema.type, indexPath, `has a "${schema.arrayKey}" field that is not an array`);
  }

  return { state: "present", value: parsed, raw };
}

/**
 * Writes the pipeline's answer for every field it owns, and leaves every
 * other field on the entry exactly as it was.
 *
 * A declared field the projection did not supply is deleted rather than left
 * alone, which is what makes ownership real: a stale generated value, or one
 * entered by hand, cannot outlive the published record it describes. Fields
 * the schema does not declare — including ones this code has never heard of —
 * are never touched here.
 */
function applyGenerated(
  entry: Record<string, unknown>,
  schema: IndexSchema,
  fields: Record<string, unknown>,
): Record<string, unknown> {
  const out = { ...entry };
  for (const field of schema.generated) {
    const value = fields[field];
    if (value === undefined) delete out[field];
    else out[field] = value;
  }
  return out;
}

function entryId(entry: unknown): string | null {
  if (!isPlainObject(entry)) return null;
  return typeof entry.id === "string" && entry.id !== "" ? entry.id : null;
}

// ── the merge engine ──────────────────────────────────────────

/**
 * Rebuilds one section index from the published directory, preserving
 * everything the schema does not claim.
 *
 * Returns null when the result is identical to what is already on disk, so a
 * promotion that changes nothing does not add a no-op entry to the rollback
 * history. Throws CorruptIndexError when the current index exists but cannot
 * be understood.
 */
export async function regenerateIndex(
  type: string,
  targetDir: string,
): Promise<IndexRegeneration | null> {
  const schema = schemaFor(type);
  if (!schema) return null;

  const indexPath = path.join(targetDir, "index.json");
  const notes: string[] = [];

  const current = await readCurrentIndex(indexPath, schema);
  let base: Record<string, unknown>;
  if (current.state === "missing") {
    base = schema.defaultSkeleton();
    notes.push(
      `${type}/index.json was absent; generated from the declared default skeleton ` +
        `(${(base[schema.arrayKey] as unknown[] | undefined)?.length ?? 0} default entries).`,
    );
  } else {
    base = current.value;
  }

  const generated = await schema.scan(targetDir);
  const currentEntries = Array.isArray(base[schema.arrayKey])
    ? (base[schema.arrayKey] as unknown[])
    : [];

  const merged: Record<string, unknown>[] = [];
  const seen = new Set<string>();
  const dropped: string[] = [];
  const emptied: string[] = [];

  // Existing entries first, in the order the index already has them.
  for (const entry of currentEntries) {
    const id = entryId(entry);
    if (id === null) {
      // No id to merge on. Carried through untouched rather than discarded —
      // it is editorial content this code does not understand.
      if (isPlainObject(entry)) merged.push({ ...entry });
      continue;
    }
    seen.add(id);

    const fields = generated.get(id);
    if (fields) {
      merged.push(applyGenerated(entry as Record<string, unknown>, schema, fields));
      continue;
    }

    if (schema.orphanPolicy === "drop") {
      dropped.push(id);
      continue;
    }
    // Retained. Its generated fields must still reflect the published
    // directory, which no longer holds anything for it.
    merged.push(applyGenerated(entry as Record<string, unknown>, schema, schema.absentGenerated(id)));
    emptied.push(id);
  }

  // Then anything the published directory has that the index did not,
  // appended in sorted id order so the result is deterministic.
  const discovered = [...generated.keys()].filter((id) => !seen.has(id)).sort();
  for (const id of discovered) {
    merged.push(applyGenerated({ id, ...schema.newEntryDefaults(id) }, schema, generated.get(id) ?? {}));
  }

  if (discovered.length > 0) notes.push(`appended ${discovered.length} new entry/entries: ${discovered.join(", ")}.`);
  if (dropped.length > 0) notes.push(`dropped ${dropped.length} orphaned record(s): ${dropped.join(", ")}.`);
  if (emptied.length > 0) notes.push(`retained ${emptied.length} container(s) with no published content: ${emptied.join(", ")}.`);

  // Spread the base, so every top-level field the index had survives.
  const newIndex = { ...base, [schema.arrayKey]: merged };
  const content = JSON.stringify(newIndex, null, 2);

  if (current.state === "present" && JSON.stringify(current.value) === JSON.stringify(newIndex)) {
    return null;
  }
  return { relPath: "index.json", content, notes };
}
