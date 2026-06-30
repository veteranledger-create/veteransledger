import { RecordLike } from "../publish.types";
import { WRAPPER_KEY_BY_CATEGORY, SchemaType } from "../import-validation/armament-record-mapper";

export interface ArmamentJson {
  id: string;
  /** DB primary key — distinct from `id` (the public slug). Used by the
   *  translation system, which keys translations by the stable DB id
   *  rather than the human-editable slug. */
  recordId: string;
  name: string;
  nation?: string;
  summary?: string;
  image?: string;
  sources?: unknown;
  related_records?: unknown;
  gallery?: unknown[];
  blueprints?: unknown[];
  videos?: unknown[];
  documents?: unknown[];
  // One-off extension fields (designation, crew, weight_tonnes, armament,
  // armor_mm, engine, speed_kmh, class, commissioned, fate, length_m,
  // wingspan_m, warhead_kg, ...) pass through here, untyped — see
  // armament-record-mapper.ts's extractExtras for where they're collected.
  [key: string]: unknown;
}

const EXPLICIT_FIELDS = new Set(["category", "fileNation", "schemaType", "image", "sources", "related_records", "gallery", "blueprints", "videos", "documents"]);

function rebuildRelatedRecords(raw: unknown): unknown[] | undefined {
  if (!Array.isArray(raw) || raw.length === 0) return undefined;
  return raw
    .filter((r): r is { id: string; title?: string; type?: string } => !!r && typeof r.id === "string")
    .map((r) => ({ id: r.id, title: r.title, type: r.type }));
}

function meta(record: RecordLike, key: string): unknown {
  return record.metadata ? record.metadata[key] : undefined;
}

function asString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0 ? value : undefined;
}

export function toArmamentJson(record: RecordLike): ArmamentJson {
  const extras: Record<string, unknown> = {};
  if (record.metadata) {
    for (const [key, value] of Object.entries(record.metadata)) {
      if (!EXPLICIT_FIELDS.has(key) && key !== "importRunId") extras[key] = value;
    }
  }

  const asArrayOrUndef = (v: unknown) => (Array.isArray(v) && v.length > 0 ? v : undefined);

  return {
    ...extras,
    id:           record.slug ?? record.id,
    recordId:     record.id,
    name: record.title,
    nation: asString(record.nationality),
    summary: asString(record.summary),
    image: asString(meta(record, "image")),
    sources: meta(record, "sources") ?? undefined,
    related_records: rebuildRelatedRecords(meta(record, "related_records")),
    gallery: asArrayOrUndef(meta(record, "gallery")),
    blueprints: asArrayOrUndef(meta(record, "blueprints")),
    videos: asArrayOrUndef(meta(record, "videos")),
    documents: asArrayOrUndef(meta(record, "documents")),
  };
}

// Reconstructs a single source file's full content from however many
// ArmamentJson records belong to it. Full-schema files are a plain array;
// minor-schema files wrap their array under the category-specific key
// confirmed from real data — never a single generic key, which is the
// frontend's own actual bug today.
export function reconstructFile(
  category: string,
  fileNation: string,
  records: ArmamentJson[],
  schemaType: SchemaType,
): unknown {
  if (schemaType === "full") {
    return records;
  }
  const wrapperKey = WRAPPER_KEY_BY_CATEGORY[category];
  return {
    category: `${category[0].toUpperCase()}${category.slice(1)} — ${fileNation[0].toUpperCase()}${fileNation.slice(1)}`,
    [wrapperKey]: records,
  };
}
