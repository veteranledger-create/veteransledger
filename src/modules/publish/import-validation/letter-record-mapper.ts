import { RecordLike } from "../publish.types";
import { pick } from "./text-utils";

export { pick };

// Shared by both the real importer (scripts/import-letters.ts, whose
// main() is never invoked) and the dry-run checker (letters-import-check.ts,
// which is) so the two can never silently drift apart — whatever shape a
// record would actually be imported as is exactly the shape the dry-run
// check validates.
export const COLLECTION_FILES: Record<string, string> = {
  german: "german.json",
  italian: "italian.json",
  japanese: "japanese.json",
  polish: "polish.json",
  british: "british.json",
  volunteers: "volunteers.json",
};

export interface LegacyLetter {
  id: string;
  collection?: string;
  language?: string;
  translated?: boolean;
  date?: string;
  from?: string;
  author?: string;
  from_unit?: string;
  unit?: string;
  to?: string;
  recipient?: string;
  location_written?: string;
  location?: string;
  subject?: string;
  excerpt?: string;
  full_text?: string;
  body?: string;
  translation?: string;
  original_text?: string;
  original?: string;
  context?: string;
  historical_context?: string;
  notes?: string;
  archival_note?: string;
  archive_source?: string;
  nation?: string;
  sources?: unknown;
  related_records?: unknown;
}

// The fields a real `Record` create() would carry — same shape
// import-letters.ts writes, minus the actual database call.
export function toRecordCreateInput(letter: LegacyLetter, collection: string, collectionId: string) {
  const fullText = pick(letter.full_text, letter.body, letter.translation);
  const excerpt = pick(letter.excerpt) ?? (fullText ? fullText.slice(0, 160) : undefined);

  return {
    type: "LETTER",
    slug: letter.id,
    collectionId,
    title: pick(letter.subject, letter.from, letter.author) ?? letter.id,
    summary: excerpt ?? null,
    content: fullText ?? null,
    date: letter.date ? new Date(letter.date) : null,
    nationality: letter.nation ?? null,
    published: true,
    metadata: {
      collection: letter.collection ?? collection,
      language: letter.language,
      translated: letter.translated,
      from: pick(letter.from, letter.author),
      from_unit: pick(letter.from_unit, letter.unit),
      to: pick(letter.to, letter.recipient),
      location_written: pick(letter.location_written, letter.location),
      subject: letter.subject,
      excerpt,
      context: pick(letter.context, letter.historical_context),
      full_text: fullText,
      original_text: pick(letter.original_text, letter.original),
      notes: pick(letter.notes, letter.archival_note),
      archive_source: pick(letter.archive_source, letter.archival_note),
      sources: letter.sources,
      related_records: letter.related_records,
    },
  };
}

// Same mapping, but as a RecordLike — for feeding into checkLetterRecord
// without ever touching Prisma. This is what the dry-run checker uses.
export function toCandidateRecord(letter: LegacyLetter, collection: string): RecordLike {
  const input = toRecordCreateInput(letter, collection, "dry-run-no-collection-id");
  return {
    id: letter.id,
    title: input.title,
    slug: letter.id,
    summary: input.summary,
    content: input.content,
    date: input.date,
    nationality: input.nationality,
    tags: [],
    published: true,
    metadata: input.metadata,
  };
}
