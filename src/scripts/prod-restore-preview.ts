/**
 * READ-ONLY production restoration preview.
 *
 * Reads the LOCAL database only. Performs ZERO writes to any database.
 * Produces the exact row counts that a production restore would create,
 * plus the ID-integrity checks that restore must preserve.
 *
 * Usage:  npx ts-node src/scripts/prod-restore-preview.ts
 */
import prisma from "../database/prisma";

type Row = { table: string; local: number; restore: number; note: string };

async function main() {
  const [
    users, collections, records, entities, entityAliases, relationships,
    timelineEvents, sources, citations, mediaAssets, auditLogs,
    translations, preservationRecords,
  ] = await Promise.all([
    prisma.user.count(),
    prisma.collection.count(),
    prisma.record.count(),
    prisma.entity.count(),
    prisma.entityAlias.count(),
    prisma.relationship.count(),
    prisma.timelineEvent.count(),
    prisma.source.count(),
    prisma.citation.count(),
    prisma.mediaAsset.count(),
    prisma.auditLog.count(),
    prisma.translation.count(),
    prisma.preservationRecord.count(),
  ]);

  const rows: Row[] = [
    { table: "Collection",         local: collections,        restore: collections,        note: "no FK deps — insert 1st" },
    { table: "Record",             local: records,            restore: records,            note: "-> Collection" },
    { table: "Entity",             local: entities,           restore: entities,           note: "no FK deps" },
    { table: "EntityAlias",        local: entityAliases,      restore: entityAliases,      note: "-> Entity (cascade)" },
    { table: "Relationship",       local: relationships,      restore: relationships,      note: "-> Entity x2 (cascade)" },
    { table: "TimelineEvent",      local: timelineEvents,     restore: timelineEvents,     note: "no FK deps" },
    { table: "Source",             local: sources,            restore: sources,            note: "no FK deps" },
    { table: "Citation",           local: citations,          restore: citations,          note: "-> Source, Record?, Entity?" },
    { table: "Translation",        local: translations,       restore: translations,       note: "loose refs by entityType+entityId" },
    { table: "PreservationRecord", local: preservationRecords, restore: preservationRecords, note: "no FK deps" },
    { table: "MediaAsset",         local: mediaAssets,        restore: 0,                  note: "EXCLUDED — FK to User; files are gitignored anyway" },
    { table: "AuditLog",           local: auditLogs,          restore: 0,                  note: "EXCLUDED — local history, FK to User" },
    { table: "User",               local: users,              restore: 0,                  note: "EXCLUDED — never copy credentials across environments" },
  ];

  console.log("\n=== EXPECTED PRODUCTION COUNTS AFTER RESTORE ===");
  console.log("table                 local   ->  prod(before)  prod(after)   note");
  for (const r of rows) {
    console.log(
      `${r.table.padEnd(20)} ${String(r.local).padStart(5)}   ->  ${"0".padStart(11)}  ${String(r.restore).padStart(10)}   ${r.note}`,
    );
  }

  // ── Breakdown detail ──────────────────────────────────────────────────
  const recByType = await prisma.record.groupBy({ by: ["type"], _count: { _all: true } });
  const entByType = await prisma.entity.groupBy({ by: ["type"], _count: { _all: true } });
  const trByLocale = await prisma.translation.groupBy({ by: ["locale"], _count: { _all: true } });
  const trByType = await prisma.translation.groupBy({ by: ["entityType"], _count: { _all: true } });
  const pubRecords = await prisma.record.count({ where: { published: true } });
  const pubEntities = await prisma.entity.count({ where: { published: true } });
  const pubEvents = await prisma.timelineEvent.count({ where: { published: true } });

  console.log("\n=== BREAKDOWN ===");
  console.log("Record.type    :", recByType.map((r) => `${r.type}=${r._count._all}`).join(", "));
  console.log("Entity.type    :", entByType.map((r) => `${r.type}=${r._count._all}`).join(", "));
  console.log("Translation.locale    :", trByLocale.map((r) => `${r.locale}=${r._count._all}`).join(", "));
  console.log("Translation.entityType:", trByType.map((r) => `${r.entityType}=${r._count._all}`).join(", "));
  console.log(`published: records=${pubRecords}/${records} entities=${pubEntities}/${entities} events=${pubEvents}/${timelineEvents}`);

  // ── ID-integrity checks (requirement 7) ───────────────────────────────
  console.log("\n=== ID INTEGRITY (must be preserved by restore) ===");

  const trs = await prisma.translation.findMany({ select: { entityType: true, entityId: true, locale: true } });
  const recIds = new Set((await prisma.record.findMany({ select: { id: true } })).map((r) => r.id));
  const entIds = new Set((await prisma.entity.findMany({ select: { id: true } })).map((r) => r.id));
  const evtIds = new Set((await prisma.timelineEvent.findMany({ select: { id: true } })).map((r) => r.id));

  const byKind: Record<string, { total: number; resolvable: number; dangling: string[] }> = {};
  for (const t of trs) {
    const k = t.entityType;
    byKind[k] ??= { total: 0, resolvable: 0, dangling: [] };
    byKind[k].total++;
    let ok = false;
    if (k === "record") ok = recIds.has(t.entityId);
    else if (k === "entity") ok = entIds.has(t.entityId);
    else if (k === "timeline_event") ok = evtIds.has(t.entityId);
    else if (k === "site_content") ok = true; // entityId is a filename, not a row id
    if (ok) byKind[k].resolvable++;
    else byKind[k].dangling.push(`${t.entityId}/${t.locale}`);
  }
  for (const [k, v] of Object.entries(byKind)) {
    console.log(`  ${k.padEnd(15)} ${v.resolvable}/${v.total} resolvable${v.dangling.length ? `  DANGLING: ${v.dangling.join(", ")}` : ""}`);
  }

  const orphanRecords = await prisma.record.count({ where: { collectionId: { not: null }, collection: { is: null } } });
  console.log(`  Record.collectionId orphans: ${orphanRecords}`);

  const cits = await prisma.citation.findMany({ select: { recordId: true, entityId: true } });
  const citOrphan = cits.filter((c) => (c.recordId && !recIds.has(c.recordId)) || (c.entityId && !entIds.has(c.entityId))).length;
  console.log(`  Citation dangling refs     : ${citOrphan}`);

  const rels = await prisma.relationship.findMany({ select: { fromId: true, toId: true } });
  const relOrphan = rels.filter((r) => !entIds.has(r.fromId) || !entIds.has(r.toId)).length;
  console.log(`  Relationship dangling refs : ${relOrphan}`);

  // ── Test-fixture residue check ────────────────────────────────────────
  const zz = await prisma.record.count({ where: { title: { contains: "ZZ-TEST" } } });
  const zzE = await prisma.entity.count({ where: { name: { contains: "ZZ-TEST" } } });
  console.log(`\n=== FIXTURE RESIDUE (must be 0 before restore) ===`);
  console.log(`  ZZ-TEST records=${zz} entities=${zzE}`);

  console.log("\nNO WRITES PERFORMED. This script is read-only.\n");
}

main()
  .catch((e) => { console.error("ERROR:", e); process.exit(1); })
  .finally(() => prisma.$disconnect());
