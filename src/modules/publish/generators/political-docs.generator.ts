import { RecordLike } from "../publish.types";

interface SourceEntry { type?: string; ref?: string; note?: string; }
interface RelatedEntry { id: string; title?: string; type?: string; }

export interface PoliticalDocJson {
  id: string;
  /** DB primary key — distinct from `id` (the public slug). Used by the
   *  translation system, which keys translations by the stable DB id
   *  rather than the human-editable slug. */
  recordId: string;
  title: string;
  date?: string;
  signatories?: string[];
  summary?: string;
  image?: string;
  gallery?: unknown[];
  documents?: unknown[];
  sources?: SourceEntry[];
  related_records?: RelatedEntry[];
}

function meta(record: RecordLike, key: string): unknown {
  return record.metadata ? record.metadata[key] : undefined;
}
function str(v: unknown): string | undefined {
  return typeof v === "string" && v.trim().length > 0 ? v : undefined;
}
const arr = (v: unknown) => (Array.isArray(v) && v.length > 0 ? v : undefined);

export function toPoliticalDocJson(record: RecordLike): PoliticalDocJson {
  const gallery = arr(meta(record, "gallery")) as unknown[] | undefined;
  const firstImage = gallery ? (gallery[0] as Record<string, unknown>)?.url as string | undefined : undefined;

  const signatoriesRaw = meta(record, "signatories");
  const signatories = Array.isArray(signatoriesRaw)
    ? (signatoriesRaw as unknown[]).filter((s): s is string => typeof s === "string" && s.trim().length > 0)
    : undefined;

  const relatedRaw = meta(record, "related_records");
  const related = Array.isArray(relatedRaw)
    ? relatedRaw
        .filter((r): r is { id: string; title?: string; type?: string } => !!r && typeof r.id === "string")
        .map(({ id, title, type }) => ({ id, ...(title ? { title } : {}), ...(type ? { type } : {}) }))
    : undefined;

  const dateStr = record.date ? record.date.toISOString().slice(0, 10) : undefined;

  return {
    id:           record.slug ?? record.id,
    recordId:     record.id,
    title: record.title,
    ...(dateStr ? { date: dateStr } : {}),
    ...(signatories?.length ? { signatories } : {}),
    ...(str(record.summary) ? { summary: str(record.summary) } : {}),
    ...(firstImage ? { image: firstImage } : {}),
    ...(gallery ? { gallery } : {}),
    ...(arr(meta(record, "documents")) ? { documents: arr(meta(record, "documents")) } : {}),
    ...(arr(meta(record, "sources") as unknown) ? { sources: arr(meta(record, "sources") as unknown) as SourceEntry[] } : {}),
    ...(related?.length ? { related_records: related } : {}),
  };
}
