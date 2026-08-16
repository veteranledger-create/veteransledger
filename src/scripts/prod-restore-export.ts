/**
 * PHASE B — step 1 of 2: EXPORT (read-only).
 *
 * Reads the LOCAL database and writes a single JSON artifact containing every
 * row to be restored, with EXPLICIT ids so the import preserves them exactly.
 *
 * Performs ZERO writes to any database. Does not modify local source data.
 *
 * Deliberately excludes User / AuditLog / MediaAsset (see recovery plan §2).
 *
 * Usage: npx ts-node src/scripts/prod-restore-export.ts
 */
import fs from "fs";
import path from "path";
import prisma from "../database/prisma";

const OUT_DIR = path.resolve(__dirname, "../../storage/production-incident");
const OUT_FILE = path.join(OUT_DIR, "prod-restore-payload.json");

async function main() {
  // FK-safe order is enforced at import time; here we just capture everything.
  const [
    collections, records, entities, entityAliases, relationships,
    timelineEvents, sources, citations, translations, preservationRecords,
  ] = await Promise.all([
    prisma.collection.findMany(),
    prisma.record.findMany(),
    prisma.entity.findMany(),
    prisma.entityAlias.findMany(),
    prisma.relationship.findMany(),
    prisma.timelineEvent.findMany(),
    prisma.source.findMany(),
    prisma.citation.findMany(),
    prisma.translation.findMany(),
    prisma.preservationRecord.findMany(),
  ]);

  const payload = {
    meta: {
      exportedAt: new Date().toISOString(),
      sourceNote: "local development database",
      excluded: ["User", "AuditLog", "MediaAsset"],
      idPolicy: "explicit — every row carries its original id",
    },
    // Key order here is the FK-safe insert order used by the importer.
    collections, records, entities, entityAliases, relationships,
    timelineEvents, sources, citations, translations, preservationRecords,
  };

  const counts = {
    collections: collections.length,
    records: records.length,
    entities: entities.length,
    entityAliases: entityAliases.length,
    relationships: relationships.length,
    timelineEvents: timelineEvents.length,
    sources: sources.length,
    citations: citations.length,
    translations: translations.length,
    preservationRecords: preservationRecords.length,
  };
  const total = Object.values(counts).reduce((a, b) => a + b, 0);

  // Fail loudly rather than export a payload that would break translations.
  const recIds = new Set(records.map((r) => r.id));
  const entIds = new Set(entities.map((r) => r.id));
  const evtIds = new Set(timelineEvents.map((r) => r.id));
  const dangling = translations.filter((t) => {
    if (t.entityType === "record") return !recIds.has(t.entityId);
    if (t.entityType === "entity") return !entIds.has(t.entityId);
    if (t.entityType === "timeline_event") return !evtIds.has(t.entityId);
    return false; // site_content entityId is a filename
  });
  if (dangling.length) {
    console.error(`ABORT: ${dangling.length} translation(s) reference missing ids:`);
    for (const d of dangling) console.error(`  ${d.entityType}/${d.entityId}/${d.locale}`);
    process.exit(1);
  }

  fs.mkdirSync(OUT_DIR, { recursive: true });
  fs.writeFileSync(OUT_FILE, JSON.stringify(payload, null, 2), "utf-8");

  console.log("EXPORT COMPLETE (read-only — no database was written)");
  console.log("  file :", OUT_FILE);
  console.log("  size :", (fs.statSync(OUT_FILE).size / 1024).toFixed(1), "KB");
  console.log("  rows :", total);
  for (const [k, v] of Object.entries(counts)) console.log(`    ${k.padEnd(20)} ${v}`);
  console.log("  translation ref integrity: OK (0 dangling)");
}

main()
  .catch((e) => { console.error("ERROR:", e); process.exit(1); })
  .finally(() => prisma.$disconnect());
