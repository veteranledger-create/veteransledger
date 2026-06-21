/**
 * Phase 1A/1B — Letters importer DESIGN.
 *
 * Reads the six real public/data/letters/*.json files and shows exactly
 * what Prisma `Record` (type LETTER) rows would be created, using the
 * shared normalization logic in src/modules/publish/import-validation/
 * letter-record-mapper.ts — the exact same mapping the dry-run checker
 * (scripts/check-letters-import.ts) validates, so the two can never
 * silently drift apart.
 *
 * THIS SCRIPT DOES NOT RUN AS PART OF PHASE 1A/1B. `main()` is deliberately
 * never invoked below — running real content migration requires separate,
 * explicit authorization. Uncomment the final line only once that's given.
 */
import fs from "fs/promises";
import path from "path";
import prisma from "../src/database/prisma";
import { COLLECTION_FILES, LegacyLetter, toRecordCreateInput } from "../src/modules/publish/import-validation/letter-record-mapper";

const LETTERS_DIR = path.resolve(__dirname, "../public/data/letters");

// Dry-run by design: builds and prints what each `Record` would look like,
// upserting the supporting `Collection` rows (one per file, harmless and
// idempotent — these are organizational containers, not archive content)
// but never writing a single `Record`. Flip DRY_RUN to false only once
// real content migration is separately authorized — and note that doing
// so still requires main() below to actually be invoked, which it isn't.
const DRY_RUN = true;

async function importCollection(collection: string, filename: string) {
  const filePath = path.join(LETTERS_DIR, filename);
  const letters: LegacyLetter[] = JSON.parse(await fs.readFile(filePath, "utf-8"));

  const collectionRow = await prisma.collection.upsert({
    where: { slug: `letters-${collection}` },
    update: {},
    create: {
      slug: `letters-${collection}`,
      title: `${collection[0].toUpperCase()}${collection.slice(1)} Letters`,
      category: "letters",
    },
  });

  for (const letter of letters) {
    const input = toRecordCreateInput(letter, collection, collectionRow.id);
    if (DRY_RUN) {
      console.log(`[DRY RUN] would upsert Record slug=${input.slug} title="${input.title}"`);
      continue;
    }
    await prisma.record.upsert({
      where: { slug: letter.id },
      update: {},
      create: input as Parameters<typeof prisma.record.create>[0]["data"],
    });
  }

  console.log(`${collection}: ${letters.length} letter(s) processed (collectionId=${collectionRow.id}, dryRun=${DRY_RUN})`);
}

async function main() {
  for (const [collection, filename] of Object.entries(COLLECTION_FILES)) {
    await importCollection(collection, filename);
  }
}

// Deliberately not invoked — see header comment. Running this file as-is
// does nothing at all, even with DRY_RUN above flipped, since main() is
// never called.
// main().catch((e) => { console.error(e); process.exit(1); }).finally(() => prisma.$disconnect());
