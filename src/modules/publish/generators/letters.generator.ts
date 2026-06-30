import { RecordLike } from "../publish.types";

// The six real letters/<file>.json collections. Not an enforced enum — the
// conformance validator only warns on an unrecognized value, so a future
// seventh collection doesn't need a code change to publish, just a heads-up.
export const KNOWN_COLLECTIONS = ["german", "italian", "japanese", "polish", "british", "volunteers"] as const;

interface SourceEntry {
  type?: string;
  ref?: string;
  note?: string;
}

interface RelatedRecordEntry {
  id: string;
  title?: string;
  type?: string;
}

export interface LetterJson {
  id: string;
  /** DB primary key — distinct from `id` (the public slug). Used by the
   *  translation system, which keys translations by the stable DB id
   *  rather than the human-editable slug. */
  recordId: string;
  collection: string;
  language?: string;
  translated?: boolean;
  date: string | undefined;
  from: string | undefined;
  from_unit?: string;
  nation?: string;
  to?: string;
  location_written?: string;
  subject?: string;
  excerpt?: string;
  context?: string;
  full_text?: string;
  original_text?: string;
  notes?: string;
  archive_source?: string;
  sources?: SourceEntry[];
  related_records?: RelatedRecordEntry[];
}

function meta(record: RecordLike, key: string): unknown {
  return record.metadata ? record.metadata[key] : undefined;
}

function asString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0 ? value : undefined;
}

// Reads a metadata value trying the canonical field name first, then any
// number of legacy aliases — mirrors Letters/record.js's own `normalise()`
// exactly (from||author, from_unit||unit, to||recipient, location_written||
// location, full_text||body||translation, context||historical_context,
// notes||archival_note), since that's the proven real-data compatibility
// contract this archive already relies on at render time. Only german.json
// uses the canonical names; the other five collections use the legacy ones.
function metaAny(record: RecordLike, ...keys: string[]): string | undefined {
  for (const key of keys) {
    const value = asString(meta(record, key));
    if (value) return value;
  }
  return undefined;
}

function deriveExcerpt(record: RecordLike, fullText: string | undefined): string | undefined {
  const explicit = asString(record.summary) ?? metaAny(record, "excerpt");
  if (explicit) return explicit;
  if (fullText) return fullText.length > 160 ? `${fullText.slice(0, 160)}...` : fullText;
  return undefined;
}

// The grouping key for output files. `collection` (which file a letter
// belongs to, e.g. "british") and `language` (what language it's written
// in, e.g. "English") are two different real-data axes — only german.json
// conflates them by using "german" for both — so `collection` is tried
// first, falling back to `language` and finally a fixed default for older
// records (like the Phase 0 pilot fixture) that predate this field.
export function resolveCollectionKey(record: RecordLike): string {
  return metaAny(record, "collection", "language") ?? "german";
}

export function toLetterJson(record: RecordLike): LetterJson {
  const fullText = asString(record.content) ?? metaAny(record, "full_text", "body", "translation");
  const collection = resolveCollectionKey(record);
  const translatedRaw = meta(record, "translated");

  const relatedRaw = meta(record, "related_records");
  const related = Array.isArray(relatedRaw)
    ? relatedRaw
        .filter((r): r is { id: string; title?: string; type?: string; url?: string } => !!r && typeof r.id === "string")
        .map((r) => ({
          id: r.id,
          title: r.title,
          type: r.type,
        }))
    : undefined;

  const sourcesRaw = meta(record, "sources");
  const sources = Array.isArray(sourcesRaw) ? (sourcesRaw as SourceEntry[]) : undefined;

  return {
    id:           record.slug ?? record.id,
    recordId:     record.id,
    collection,
    language: metaAny(record, "language"),
    translated: typeof translatedRaw === "boolean" ? translatedRaw : undefined,
    date: record.date ? record.date.toISOString().slice(0, 10) : metaAny(record, "date"),
    from: metaAny(record, "from", "author") ?? asString(record.title),
    from_unit: metaAny(record, "from_unit", "unit"),
    nation: asString(record.nationality) ?? metaAny(record, "nation"),
    to: metaAny(record, "to", "recipient"),
    location_written: metaAny(record, "location_written", "location"),
    subject: metaAny(record, "subject"),
    excerpt: deriveExcerpt(record, fullText),
    context: metaAny(record, "context", "historical_context"),
    full_text: fullText,
    original_text: metaAny(record, "original_text", "original"),
    notes: metaAny(record, "notes", "archival_note"),
    archive_source: metaAny(record, "archive_source", "archival_note"),
    sources,
    related_records: related,
  };
}
