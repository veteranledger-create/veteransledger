/**
 * READ-ONLY production schema + data verification.
 *
 * Lists every table in the public schema with its live row count, and checks
 * them against the set expected from prisma/schema.prisma. Performs ZERO
 * writes — only SELECTs against catalog views and COUNT(*).
 *
 * Usage (production):
 *   railway run sh -c 'DATABASE_URL="$DATABASE_PUBLIC_URL" npx ts-node src/scripts/prod-verify.ts'
 */
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

/** Tables expected after all 5 migrations (from @@map in schema.prisma, plus Prisma-managed ones). */
const EXPECTED = new Set([
  "users", "collections", "records", "entities", "entity_aliases",
  "relationships", "timeline_events", "sources", "citations",
  "media_assets", "audit_logs", "translations", "preservation_records",
  "community_members", "community_posts", "community_comments",
  "community_reactions", "community_reports", "community_moderation_actions",
  "community_notifications",
  // Prisma-managed: migration ledger + implicit m2m join tables
  "_prisma_migrations", "_EntityMedia", "_RecordMedia",
]);

/**
 * Tables the restore targets — these must be EMPTY before it runs.
 * Deliberately excludes users / audit_logs / media_assets: those hold
 * pre-existing production data (confirmed present in the pre-migration
 * dump) and are never written by the restore.
 */
const MUST_BE_EMPTY = [
  "collections", "records", "entities", "entity_aliases", "relationships",
  "timeline_events", "sources", "citations", "translations",
  "preservation_records",
];

/** Pre-existing production data — reported for awareness, never modified. */
const PRESERVE = ["users", "audit_logs", "media_assets"];

async function main() {
  const host = (() => { try { return new URL(process.env.DATABASE_URL ?? "").host; } catch { return "<unknown>"; } })();
  const db = await prisma.$queryRawUnsafe<{ current_database: string }[]>("SELECT current_database()");
  console.log("TARGET host:", host);
  console.log("TARGET db  :", db[0]?.current_database);
  console.log("");

  const tables = await prisma.$queryRawUnsafe<{ tablename: string }[]>(
    `SELECT tablename FROM pg_tables WHERE schemaname = 'public' ORDER BY tablename`,
  );

  console.log(`=== TABLES IN public SCHEMA (${tables.length}) ===`);
  const found = new Set<string>();
  const rows: { table: string; count: number; status: string }[] = [];

  for (const { tablename } of tables) {
    found.add(tablename);
    const r = await prisma.$queryRawUnsafe<{ c: bigint }[]>(`SELECT COUNT(*)::bigint AS c FROM "${tablename}"`);
    const count = Number(r[0]?.c ?? 0);
    const status = EXPECTED.has(tablename) ? "expected" : "!! UNEXPECTED";
    rows.push({ table: tablename, count, status });
  }

  for (const r of rows) {
    console.log(`  ${r.table.padEnd(32)} ${String(r.count).padStart(6)}   ${r.status}`);
  }

  // ── Checks ────────────────────────────────────────────────────────────
  console.log("\n=== CHECKS ===");

  const hasTranslations = found.has("translations");
  console.log(`  [${hasTranslations ? "PASS" : "FAIL"}] 'translations' table exists`);

  const missing = [...EXPECTED].filter((t) => !found.has(t));
  console.log(`  [${missing.length === 0 ? "PASS" : "FAIL"}] no expected table missing${missing.length ? ` -> ${missing.join(", ")}` : ""}`);

  const unexpected = rows.filter((r) => r.status !== "expected").map((r) => r.table);
  console.log(`  [${unexpected.length === 0 ? "PASS" : "FAIL"}] no unexpected tables${unexpected.length ? ` -> ${unexpected.join(", ")}` : ""}`);

  const nonEmpty = rows.filter((r) => MUST_BE_EMPTY.includes(r.table) && r.count > 0);
  console.log(`  [${nonEmpty.length === 0 ? "PASS" : "FAIL"}] all data tables still empty${nonEmpty.length ? ` -> ${nonEmpty.map((r) => `${r.table}=${r.count}`).join(", ")}` : ""}`);

  console.log("\n=== PRE-EXISTING PRODUCTION DATA (preserve — never written by restore) ===");
  for (const t of PRESERVE) {
    console.log(`  ${t.padEnd(16)} = ${rows.find((r) => r.table === t)?.count ?? 0}`);
  }

  const mig = await prisma.$queryRawUnsafe<{ migration_name: string; finished_at: Date | null }[]>(
    `SELECT migration_name, finished_at FROM "_prisma_migrations" ORDER BY started_at`,
  );
  console.log(`\n=== _prisma_migrations LEDGER (${mig.length}) ===`);
  for (const m of mig) {
    console.log(`  ${m.finished_at ? "applied" : "PENDING/FAILED"}  ${m.migration_name}`);
  }

  console.log("\nNO WRITES PERFORMED. This script is read-only.\n");
}

main()
  .catch((e) => { console.error("ERROR:", e); process.exit(1); })
  .finally(() => prisma.$disconnect());
