import { RecordLike } from "../publish.types";
import { NormalizedBodyBlock } from "../import-validation/article-record-mapper";

interface SourceEntry {
  type?: string;
  ref?: string;
  note?: string;
}

interface RelatedRecordEntry {
  id: string;
  title?: string;
  type?: string;
  url?: string;
}

export interface ArticleJson {
  id: string;
  category: string;
  title: string;
  subtitle?: string;
  date_published?: string;
  author?: string;
  summary?: string;
  body: NormalizedBodyBlock[];
  image?: string;
  images?: string[];
  tags?: string[];
  archival_note?: string;
  sources?: SourceEntry[];
  related_records?: RelatedRecordEntry[];
  // One-off extension fields (nuremberg.json's defendants_count etc.,
  // poland-1939.json's casualties) pass through here, untyped — see
  // article-record-mapper.ts's extractExtras for where they're collected.
  [key: string]: unknown;
}

const EXPLICIT_FIELDS = new Set([
  "category", "subtitle", "author", "image", "tags", "body",
  "archival_note", "sources", "related_records",
]);

function meta(record: RecordLike, key: string): unknown {
  return record.metadata ? record.metadata[key] : undefined;
}

function asString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0 ? value : undefined;
}

// Body is already normalized at import time (article-record-mapper.ts) —
// the generator just reads it back, unlike the Letters generator which
// re-derives its canonical shape fresh on every call.
function readBody(record: RecordLike): NormalizedBodyBlock[] {
  const raw = meta(record, "body");
  return Array.isArray(raw) ? (raw as NormalizedBodyBlock[]) : [];
}

export function toArticleJson(record: RecordLike): ArticleJson {
  const image = asString(meta(record, "image"));
  const sourcesRaw = meta(record, "sources");
  const sources = Array.isArray(sourcesRaw) ? (sourcesRaw as SourceEntry[]) : undefined;

  const relatedRaw = meta(record, "related_records");
  const related = Array.isArray(relatedRaw)
    ? relatedRaw
        .filter((r): r is { id: string; title?: string; type?: string; url?: string } => !!r && typeof r.id === "string")
        .map((r) => ({ id: r.id, title: r.title, type: r.type, url: r.url }))
    : undefined;

  // Every extension field not in EXPLICIT_FIELDS gets spread in verbatim —
  // this is what keeps nuremberg.json's defendants_count/death_sentences/
  // etc. and poland-1939.json's casualties object alive across a
  // regenerate, without the generator needing to know their names.
  const extras: Record<string, unknown> = {};
  if (record.metadata) {
    for (const [key, value] of Object.entries(record.metadata)) {
      if (!EXPLICIT_FIELDS.has(key) && key !== "importRunId") extras[key] = value;
    }
  }

  return {
    ...extras,
    id: record.slug ?? record.id,
    category: asString(meta(record, "category")) ?? "military",
    title: record.title,
    subtitle: asString(meta(record, "subtitle")),
    date_published: record.date ? record.date.toISOString().slice(0, 10) : undefined,
    author: asString(meta(record, "author")),
    summary: asString(record.summary),
    body: readBody(record),
    image,
    images: image ? [image] : undefined, // deliberate fix for articles.js's images-only card lookup
    tags: Array.isArray(meta(record, "tags")) ? (meta(record, "tags") as string[]) : undefined,
    archival_note: asString(meta(record, "archival_note")),
    sources,
    related_records: related,
  };
}
