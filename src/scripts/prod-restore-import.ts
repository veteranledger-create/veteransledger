/**
 * PHASE B — step 2 of 2: IMPORT into the TARGET (production) database.
 *
 * Writes ONLY when --execute is passed. Default is a dry run that reports
 * exactly what would happen and touches nothing.
 *
 * Safety guards (mapped to recovery-plan risks):
 *   R5  target confirmation  — prints the target host and requires --confirm-host=<host>
 *   R7  overwrite protection — ABORTS if any target table already has rows,
 *                              unless --allow-nonempty is explicitly passed
 *   R3  idempotency          — createMany({ skipDuplicates: true })
 *   R4  FK ordering          — fixed insert order, one transaction per table
 *
 * Preserves every id verbatim. Never touches User / AuditLog / MediaAsset.
 *
 * Dry run : npx ts-node src/scripts/prod-restore-import.ts
 * Execute : npx ts-node src/scripts/prod-restore-import.ts --execute --confirm-host=<db-host>
 */
import fs from "fs";
import path from "path";
import { PrismaClient } from "@prisma/client";

const PAYLOAD = path.resolve(__dirname, "../../storage/production-incident/prod-restore-payload.json");

const argv = process.argv.slice(2);
const EXECUTE = argv.includes("--execute");
const ALLOW_NONEMPTY = argv.includes("--allow-nonempty");
const CONFIRM_HOST = argv.find((a) => a.startsWith("--confirm-host="))?.split("=")[1];

const prisma = new PrismaClient();

function targetHost(): string {
  const url = process.env.DATABASE_URL ?? "";
  try { return new URL(url).host; } catch { return "<unparseable DATABASE_URL>"; }
}

async function main() {
  if (!fs.existsSync(PAYLOAD)) {
    console.error(`ABORT: payload not found at ${PAYLOAD}\nRun prod-restore-export.ts first.`);
    process.exit(1);
  }
  const p = JSON.parse(fs.readFileSync(PAYLOAD, "utf-8"));
  const host = targetHost();

  console.log("=".repeat(64));
  console.log(EXECUTE ? "MODE   : EXECUTE (will write)" : "MODE   : DRY RUN (no writes)");
  console.log("TARGET :", host);
  console.log("PAYLOAD:", p.meta?.exportedAt, "| excluded:", (p.meta?.excluded ?? []).join(", "));
  console.log("=".repeat(64));

  // ── R5: target confirmation ──────────────────────────────────────────
  if (EXECUTE && CONFIRM_HOST !== host) {
    console.error(`ABORT (R5): --confirm-host must equal the actual target host.\n  expected: --confirm-host=${host}\n  received: ${CONFIRM_HOST ?? "(none)"}`);
    process.exit(1);
  }

  // FK-safe insert order.
  const steps: { name: string; rows: unknown[]; run: (rows: never[]) => Promise<{ count: number }>; count: () => Promise<number> }[] = [
    { name: "Collection",         rows: p.collections,        run: (r) => prisma.collection.createMany({ data: r, skipDuplicates: true }),        count: () => prisma.collection.count() },
    { name: "Record",             rows: p.records,            run: (r) => prisma.record.createMany({ data: r, skipDuplicates: true }),            count: () => prisma.record.count() },
    { name: "Entity",             rows: p.entities,           run: (r) => prisma.entity.createMany({ data: r, skipDuplicates: true }),            count: () => prisma.entity.count() },
    { name: "EntityAlias",        rows: p.entityAliases,      run: (r) => prisma.entityAlias.createMany({ data: r, skipDuplicates: true }),       count: () => prisma.entityAlias.count() },
    { name: "Relationship",       rows: p.relationships,      run: (r) => prisma.relationship.createMany({ data: r, skipDuplicates: true }),      count: () => prisma.relationship.count() },
    { name: "TimelineEvent",      rows: p.timelineEvents,     run: (r) => prisma.timelineEvent.createMany({ data: r, skipDuplicates: true }),     count: () => prisma.timelineEvent.count() },
    { name: "Source",             rows: p.sources,            run: (r) => prisma.source.createMany({ data: r, skipDuplicates: true }),            count: () => prisma.source.count() },
    { name: "Citation",           rows: p.citations,          run: (r) => prisma.citation.createMany({ data: r, skipDuplicates: true }),          count: () => prisma.citation.count() },
    { name: "Translation",        rows: p.translations,       run: (r) => prisma.translation.createMany({ data: r, skipDuplicates: true }),       count: () => prisma.translation.count() },
    { name: "PreservationRecord", rows: p.preservationRecords, run: (r) => prisma.preservationRecord.createMany({ data: r, skipDuplicates: true }), count: () => prisma.preservationRecord.count() },
  ];

  // ── R7: overwrite protection ─────────────────────────────────────────
  console.log("\nPRE-FLIGHT — target row counts:");
  let nonEmpty = 0;
  for (const s of steps) {
    const before = await s.count();
    if (before > 0) nonEmpty++;
    console.log(`  ${s.name.padEnd(20)} target=${String(before).padStart(5)}  payload=${String(s.rows.length).padStart(5)}`);
  }
  if (nonEmpty > 0 && !ALLOW_NONEMPTY) {
    console.error(`\nABORT (R7): ${nonEmpty} target table(s) already contain rows.`);
    console.error("The approved plan expects an empty target. Re-verify before proceeding.");
    console.error("If this is genuinely intended, re-run with --allow-nonempty.");
    process.exit(1);
  }

  if (!EXECUTE) {
    const total = steps.reduce((a, s) => a + s.rows.length, 0);
    console.log(`\nDRY RUN COMPLETE — would insert ${total} rows. Nothing was written.`);
    console.log(`To execute: --execute --confirm-host=${host}`);
    return;
  }

  console.log("\nEXECUTING…");
  const results: Record<string, number> = {};
  for (const s of steps) {
    if (!s.rows.length) { results[s.name] = 0; console.log(`  ${s.name.padEnd(20)} skipped (0 rows)`); continue; }
    const res = await s.run(s.rows as never[]);
    results[s.name] = res.count;
    console.log(`  ${s.name.padEnd(20)} inserted ${res.count}`);
  }

  console.log("\nPOST-RESTORE — target row counts:");
  for (const s of steps) console.log(`  ${s.name.padEnd(20)} ${await s.count()}`);
  console.log("\nRESTORE COMPLETE. Run prod-restore-preview.ts against production to verify.");
}

main()
  .catch((e) => { console.error("ERROR:", e); process.exit(1); })
  .finally(() => prisma.$disconnect());
