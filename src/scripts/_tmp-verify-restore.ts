import { isDeepStrictEqual } from "node:util";
import prisma from "../database/prisma";
import fs from "node:fs";

const ID = "cmqnusec20019dn0e7kvy5uod";

async function main() {
  const record = await prisma.record.findUnique({ where: { id: ID } });
  if (!record) { console.log("FAIL: record not found after restore"); process.exit(1); }

  console.log("=== Restored record ===");
  console.log(JSON.stringify(record, null, 2));

  console.log("\n=== Duplicate check ===");
  const byTitle = await prisma.record.findMany({ where: { title: "Battle of Britain" } });
  console.log(`Records titled "Battle of Britain": ${byTitle.length}`, byTitle.length === 1 ? "PASS" : "FAIL");
  const byId = await prisma.record.findMany({ where: { id: ID } });
  console.log(`Records with this id: ${byId.length}`, byId.length === 1 ? "PASS" : "FAIL");

  console.log("\n=== Orphan checks ===");
  const citations = await prisma.citation.findMany({ where: { recordId: ID } });
  console.log(`Citations: ${citations.length}`, citations.length === 0 ? "PASS (none expected)" : "check");
  const relationships = await prisma.relationship.findMany({ where: { OR: [{ fromId: ID }, { toId: ID }] } });
  console.log(`Relationships: ${relationships.length}`, relationships.length === 0 ? "PASS (none expected)" : "check");
  const translations = await prisma.translation.findMany({ where: { entityType: "record", entityId: ID } });
  console.log(`Translations: ${translations.length}`, translations.length === 0 ? "PASS (none expected — had none pre-deletion)" : "check");
  const media = await prisma.mediaAsset.findMany({ where: { records: { some: { id: ID } } } });
  console.log(`Media: ${media.length}`, media.length === 0 ? "PASS (none expected)" : "check");

  console.log("\n=== Against archive source ===");
  const archive = JSON.parse(fs.readFileSync("public/data/campaigns/western-front/britain.json", "utf-8"));
  const meta = record.metadata as Record<string, unknown>;
  const checks: [string, boolean][] = [
    ["title", record.title === archive.title],
    ["slug", record.slug === archive.id],
    ["startDate", record.startDate?.toISOString().slice(0, 10) === archive.dates.start],
    ["endDate", record.endDate?.toISOString().slice(0, 10) === archive.dates.end],
    ["summary", record.summary === archive.summary],
    ["metadata.theater", meta.theater === archive.theater],
    ["metadata.context", meta.context === archive.context],
    ["metadata.outcome", meta.outcome === archive.outcome],
    ["metadata.significance", meta.significance === archive.significance],
    ["metadata.background", meta.background === archive.background],
    ["metadata.image", meta.image === archive.image],
    ["metadata.combatants", isDeepStrictEqual(meta.combatants, archive.combatants)],
    ["metadata.phases", isDeepStrictEqual(meta.phases, archive.phases)],
    ["metadata.casualties", isDeepStrictEqual(meta.casualties, archive.casualties)],
    ["metadata.technology", isDeepStrictEqual(meta.technology, archive.technology)],
    ["metadata.sources", isDeepStrictEqual(meta.sources, archive.sources)],
    ["metadata.related_records", isDeepStrictEqual(meta.related_records, archive.related_records)],
  ];
  checks.forEach(([label, pass]) => console.log(`${pass ? "PASS" : "FAIL"} — ${label}`));

  console.log("\n=== Against pre-deletion list-view evidence ===");
  console.log(`title="Battle of Britain": ${record.title === "Battle of Britain" ? "PASS" : "FAIL"}`);
  console.log(`theater badge -> western-front: ${meta.theater === "western-front" ? "PASS" : "FAIL"}`);
  console.log(`startDate 1940-07-10: ${record.startDate?.toISOString().slice(0, 10) === "1940-07-10" ? "PASS" : "FAIL"}`);
  console.log(`published=true: ${record.published === true ? "PASS" : "FAIL"}`);

  console.log("\n=== Collection ===");
  const collection = await prisma.collection.findUnique({ where: { id: record.collectionId ?? "" } });
  console.log(`Collection: ${collection?.title} (${collection?.slug})`, collection?.slug === "campaigns-western-front" ? "PASS" : "FAIL");
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
