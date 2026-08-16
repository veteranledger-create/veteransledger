/**
 * READ-ONLY post-restore verification.
 *
 * Compares the target (production) database against the approved payload:
 * counts, exact ID sets, FK/reference integrity, translation entityId
 * integrity, duplicates, and published states. Performs ZERO writes.
 *
 * Usage:
 *   railway run sh -c 'DATABASE_URL="$DATABASE_PUBLIC_URL" npx ts-node src/scripts/prod-restore-verify.ts'
 */
import fs from "fs";
import path from "path";
import { PrismaClient } from "@prisma/client";

const PAYLOAD = path.resolve(__dirname, "../../storage/production-incident/prod-restore-payload.json");
const prisma = new PrismaClient();

let pass = 0, fail = 0;
function check(ok: boolean, label: string, detail = "") {
  if (ok) { pass++; console.log(`  [PASS] ${label}`); }
  else { fail++; console.log(`  [FAIL] ${label}${detail ? ` -> ${detail}` : ""}`); }
}

function setDiff(a: string[], b: Set<string>) { return a.filter((x) => !b.has(x)); }

async function main() {
  const p = JSON.parse(fs.readFileSync(PAYLOAD, "utf-8"));
  const host = (() => { try { return new URL(process.env.DATABASE_URL ?? "").host; } catch { return "<unknown>"; } })();
  const dbRow = await prisma.$queryRawUnsafe<{ current_database: string }[]>("SELECT current_database()");
  console.log("TARGET host:", host);
  console.log("TARGET db  :", dbRow[0]?.current_database);
  console.log("PAYLOAD    :", p.meta?.exportedAt);

  // ── 1. Counts vs approved preview ────────────────────────────────────
  console.log("\n=== 1. COUNTS vs APPROVED 455-ROW PREVIEW ===");
  const expected: Record<string, number> = {
    Collection: 42, Record: 184, Entity: 46, EntityAlias: 0, Relationship: 28,
    TimelineEvent: 83, Source: 0, Citation: 0, Translation: 72, PreservationRecord: 0,
  };
  const actual: Record<string, number> = {
    Collection: await prisma.collection.count(),
    Record: await prisma.record.count(),
    Entity: await prisma.entity.count(),
    EntityAlias: await prisma.entityAlias.count(),
    Relationship: await prisma.relationship.count(),
    TimelineEvent: await prisma.timelineEvent.count(),
    Source: await prisma.source.count(),
    Citation: await prisma.citation.count(),
    Translation: await prisma.translation.count(),
    PreservationRecord: await prisma.preservationRecord.count(),
  };
  let total = 0;
  for (const k of Object.keys(expected)) {
    total += actual[k];
    console.log(`  ${k.padEnd(20)} expected=${String(expected[k]).padStart(4)}  actual=${String(actual[k]).padStart(4)}  ${expected[k] === actual[k] ? "OK" : "MISMATCH"}`);
  }
  check(Object.keys(expected).every((k) => expected[k] === actual[k]), "all table counts match approved preview");
  check(total === 455, `total restored rows = 455`, `got ${total}`);

  // ── 2. Exact ID sets ─────────────────────────────────────────────────
  console.log("\n=== 2. EXACT ID PRESERVATION ===");
  const pairs: [string, string[], () => Promise<{ id: string }[]>][] = [
    ["Collection", p.collections.map((r: { id: string }) => r.id), () => prisma.collection.findMany({ select: { id: true } })],
    ["Record", p.records.map((r: { id: string }) => r.id), () => prisma.record.findMany({ select: { id: true } })],
    ["Entity", p.entities.map((r: { id: string }) => r.id), () => prisma.entity.findMany({ select: { id: true } })],
    ["Relationship", p.relationships.map((r: { id: string }) => r.id), () => prisma.relationship.findMany({ select: { id: true } })],
    ["TimelineEvent", p.timelineEvents.map((r: { id: string }) => r.id), () => prisma.timelineEvent.findMany({ select: { id: true } })],
    ["Translation", p.translations.map((r: { id: string }) => r.id), () => prisma.translation.findMany({ select: { id: true } })],
  ];
  for (const [name, payloadIds, q] of pairs) {
    const dbIds = (await q()).map((r) => r.id);
    const dbSet = new Set(dbIds);
    const payloadSet = new Set(payloadIds);
    const missing = setDiff(payloadIds, dbSet);
    const extra = setDiff(dbIds, payloadSet);
    const dupes = dbIds.length !== dbSet.size;
    check(missing.length === 0 && extra.length === 0 && !dupes,
      `${name}: ${payloadIds.length} IDs identical (no missing, no extra, no dupes)`,
      `missing=${missing.length} extra=${extra.length} dupes=${dbIds.length - dbSet.size}`);
  }

  // ── 3. FK / reference integrity ──────────────────────────────────────
  console.log("\n=== 3. FK / REFERENCE INTEGRITY ===");
  const recIds = new Set((await prisma.record.findMany({ select: { id: true } })).map((r) => r.id));
  const entIds = new Set((await prisma.entity.findMany({ select: { id: true } })).map((r) => r.id));
  const evtIds = new Set((await prisma.timelineEvent.findMany({ select: { id: true } })).map((r) => r.id));
  const colIds = new Set((await prisma.collection.findMany({ select: { id: true } })).map((r) => r.id));

  const recs = await prisma.record.findMany({ select: { id: true, collectionId: true } });
  const badCol = recs.filter((r) => r.collectionId && !colIds.has(r.collectionId));
  check(badCol.length === 0, "Record.collectionId all resolve", `${badCol.length} dangling`);

  const rels = await prisma.relationship.findMany({ select: { fromId: true, toId: true } });
  const badRel = rels.filter((r) => !entIds.has(r.fromId) || !entIds.has(r.toId));
  check(badRel.length === 0, "Relationship from/to all resolve", `${badRel.length} dangling`);

  const cits = await prisma.citation.findMany({ select: { recordId: true, entityId: true } });
  const badCit = cits.filter((c) => (c.recordId && !recIds.has(c.recordId)) || (c.entityId && !entIds.has(c.entityId)));
  check(badCit.length === 0, "Citation refs all resolve", `${badCit.length} dangling`);

  // ── 4. Translation entityId integrity ────────────────────────────────
  console.log("\n=== 4. TRANSLATION entityId INTEGRITY ===");
  const trs = await prisma.translation.findMany({ select: { entityType: true, entityId: true, locale: true } });
  const byKind: Record<string, { total: number; ok: number; bad: string[] }> = {};
  for (const t of trs) {
    byKind[t.entityType] ??= { total: 0, ok: 0, bad: [] };
    byKind[t.entityType].total++;
    let ok = false;
    if (t.entityType === "record") ok = recIds.has(t.entityId);
    else if (t.entityType === "entity") ok = entIds.has(t.entityId);
    else if (t.entityType === "timeline_event") ok = evtIds.has(t.entityId);
    else if (t.entityType === "site_content") ok = true;
    ok ? byKind[t.entityType].ok++ : byKind[t.entityType].bad.push(`${t.entityId}/${t.locale}`);
  }
  for (const [k, v] of Object.entries(byKind)) {
    console.log(`    ${k.padEnd(15)} ${v.ok}/${v.total} resolvable`);
    check(v.bad.length === 0, `no orphaned '${k}' translations`, v.bad.join(", "));
  }

  const locales = await prisma.translation.groupBy({ by: ["locale"], _count: { _all: true } });
  console.log("    by locale:", locales.map((l) => `${l.locale}=${l._count._all}`).join(", "));
  check(locales.length === 8 && locales.every((l) => l._count._all === 9), "all 8 locales present with 9 rows each");

  // ── 5. Duplicates ────────────────────────────────────────────────────
  console.log("\n=== 5. DUPLICATE CHECK ===");
  const dupTr = await prisma.$queryRawUnsafe<{ c: bigint }[]>(
    `SELECT COUNT(*)::bigint AS c FROM (SELECT "entityType","entityId","locale" FROM translations GROUP BY 1,2,3 HAVING COUNT(*)>1) x`);
  check(Number(dupTr[0].c) === 0, "no duplicate translation (entityType,entityId,locale)", `${dupTr[0].c} dupes`);
  const dupSlug = await prisma.$queryRawUnsafe<{ c: bigint }[]>(
    `SELECT COUNT(*)::bigint AS c FROM (SELECT slug FROM records WHERE slug IS NOT NULL GROUP BY 1 HAVING COUNT(*)>1) x`);
  check(Number(dupSlug[0].c) === 0, "no duplicate Record.slug", `${dupSlug[0].c} dupes`);

  // ── 6. Published states ──────────────────────────────────────────────
  console.log("\n=== 6. PUBLISHED STATES ===");
  const pr = await prisma.record.count({ where: { published: true } });
  const pe = await prisma.entity.count({ where: { published: true } });
  const pv = await prisma.timelineEvent.count({ where: { published: true } });
  console.log(`    records=${pr}/184  entities=${pe}/46  events=${pv}/83`);
  check(pr === 184 && pe === 46 && pv === 83, "all restored content published (matches source)");

  const byType = await prisma.record.groupBy({ by: ["type"], _count: { _all: true } });
  console.log("    Record.type:", byType.map((r) => `${r.type}=${r._count._all}`).join(", "));

  // ── 7. Preserved tables untouched ────────────────────────────────────
  console.log("\n=== 7. PRE-EXISTING PRODUCTION DATA (must be unchanged) ===");
  const u = await prisma.user.count(), a = await prisma.auditLog.count(), m = await prisma.mediaAsset.count();
  console.log(`    users=${u}  audit_logs=${a}  media_assets=${m}`);
  check(u === 1 && m === 1, "users=1 and media_assets=1 preserved", `users=${u} media=${m}`);

  console.log(`\n=== RESULT: ${pass} passed, ${fail} failed ===`);
  console.log("NO WRITES PERFORMED. This script is read-only.\n");
  if (fail > 0) process.exit(1);
}

main()
  .catch((e) => { console.error("ERROR:", e); process.exit(1); })
  .finally(() => prisma.$disconnect());
