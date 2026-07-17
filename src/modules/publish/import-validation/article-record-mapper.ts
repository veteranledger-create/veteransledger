import { RecordLike } from "../publish.types";
import { pick } from "./text-utils";

// Shared by both the real importer (articles-importer.ts) and the dry-run
// checker (articles-import-check.ts) so the two can never silently drift
// apart. Unlike Letters (one file holds many records), Articles is one
// file per record — this maps each category to the filenames inside it,
// matching public/data/articles/index.json exactly. "economy" is real
// (listed in index.json) but currently has zero files.
export const ARTICLE_FILES: Record<string, string[]> = {
  military: ["poland-1939.json", "rearmament.json", "berlin-1945.json"],
  political: ["rise-nsdap.json", "july-20.json", "anschluss.json", "occupation.json"],
  economy: [],
  legal: ["nuremberg.json"],
};

export interface BodyBlock {
  type: string;
  text?: string;
  content?: string;
}

export interface NormalizedBodyBlock {
  type: string;
  text: string;
}

export interface LegacyArticle {
  id: string;
  recordId?: string;
  category?: string;
  title?: string;
  subtitle?: string;
  date_published?: string;
  author?: string;
  image?: string;
  tags?: string[];
  summary?: string;
  body?: BodyBlock[];
  archival_note?: string;
  sources?: unknown;
  related_records?: unknown;
  // Real one-off extension fields exist (nuremberg.json's defendants_count
  // etc., poland-1939.json's casualties object) — this index signature is
  // what lets them flow through without the mapper needing to know their
  // names in advance.
  [key: string]: unknown;
}

// Every top-level field this mapper explicitly understands. Anything else
// found on a real article record is preserved as a pass-through "extra"
// rather than silently dropped — see toRecordCreateInput below.
const KNOWN_FIELDS = new Set([
  "id", "recordId", "category", "title", "subtitle", "date_published", "author",
  "image", "tags", "summary", "body", "archival_note", "sources", "related_records",
]);

// Collapses both real body-block shapes — {type, text} and {type, content},
// "heading" and "subheading" — into one canonical {type, text} shape. This
// runs once, at import time, rather than on every generate call (unlike
// Letters' field-rename fallbacks) because it's a real structural
// transform, not a simple per-field substitution, and the database should
// store the canonical shape directly rather than re-deriving it on every
// publish. Articles/record.js already reads `block.text` and treats
// anything else as "heading" or falls through to a paragraph — normalizing
// to {type, text} is what makes the two currently-broken articles
// (berlin-1945, occupation) render correctly for the first time.
export function normalizeBodyBlocks(blocks: BodyBlock[] | undefined): NormalizedBodyBlock[] {
  if (!Array.isArray(blocks)) return [];
  return blocks.map((block) => ({
    type: block.type === "subheading" ? "heading" : block.type,
    text: pick(block.text, block.content) ?? "",
  }));
}

function extractExtras(article: LegacyArticle): Record<string, unknown> {
  return Object.fromEntries(Object.entries(article).filter(([key]) => !KNOWN_FIELDS.has(key)));
}

export function toRecordCreateInput(article: LegacyArticle, category: string, collectionId: string) {
  const normalizedBody = normalizeBodyBlocks(article.body);
  const plainTextContent = normalizedBody.map((b) => b.text).filter(Boolean).join("\n\n");
  const extras = extractExtras(article);
  // Recovery: reuse the original database id (embedded by the publish
  // pipeline's recordId backfill) when present, so restored rows keep
  // their pre-loss identity instead of getting a fresh cuid.
  const recordId = typeof article.recordId === "string" ? article.recordId : undefined;

  return {
    ...(recordId ? { id: recordId } : {}),
    type: "ARTICLE",
    slug: article.id,
    collectionId,
    title: article.title ?? article.id,
    summary: article.summary ?? null,
    content: plainTextContent || null,
    date: article.date_published ? new Date(article.date_published) : null,
    nationality: null,
    published: true,
    metadata: {
      ...extras, // spread first — explicit fields below always win on a name collision
      category: article.category ?? category,
      subtitle: article.subtitle,
      author: article.author,
      image: article.image,
      tags: article.tags,
      body: normalizedBody,
      archival_note: article.archival_note,
      sources: article.sources,
      related_records: article.related_records,
    },
  };
}

export function toCandidateRecord(article: LegacyArticle, category: string): RecordLike {
  const input = toRecordCreateInput(article, category, "dry-run-no-collection-id");
  return {
    id: article.id,
    title: input.title,
    slug: article.id,
    summary: input.summary,
    content: input.content,
    date: input.date,
    nationality: input.nationality,
    tags: article.tags ?? [],
    published: true,
    metadata: input.metadata,
  };
}
