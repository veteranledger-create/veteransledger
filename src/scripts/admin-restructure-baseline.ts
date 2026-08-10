/**
 * Admin restructuring — DB count snapshot. Read-only. Used before Phase 1
 * (as the baseline) and after every phase (for before/after verification).
 * Run with: npx ts-node src/scripts/admin-restructure-baseline.ts [label]
 *   label — optional filename suffix, e.g. "phase1-after" (default: a timestamp)
 */
import fs from "fs/promises";
import path from "path";
import prisma from "../database/prisma";

async function main() {
  const label = process.argv[2] || `snapshot-${Date.now()}`;

  const [
    recordByType,
    entityCount,
    entityByType,
    timelineCount,
    translationCount,
    translationByEntityType,
    translationByStatus,
    collectionCount,
    relationshipCount,
    userCount,
    userByRole,
    auditLogCount,
    mediaAssetCount,
  ] = await Promise.all([
    prisma.record.groupBy({ by: ["type"], _count: { _all: true } }),
    prisma.entity.count(),
    prisma.entity.groupBy({ by: ["type"], _count: { _all: true } }),
    prisma.timelineEvent.count(),
    prisma.translation.count(),
    prisma.translation.groupBy({ by: ["entityType"], _count: { _all: true } }),
    prisma.translation.groupBy({ by: ["status"], _count: { _all: true } }),
    prisma.collection.count(),
    prisma.relationship.count(),
    prisma.user.count(),
    prisma.user.groupBy({ by: ["role"], _count: { _all: true } }),
    prisma.auditLog.count(),
    prisma.mediaAsset.count(),
  ]);

  const recordTotal = recordByType.reduce((s, r) => s + r._count._all, 0);

  const snapshot = {
    label,
    capturedAt: new Date().toISOString(),
    record: { total: recordTotal, byType: Object.fromEntries(recordByType.map((r) => [r.type, r._count._all])) },
    entity: { total: entityCount, byType: Object.fromEntries(entityByType.map((r) => [r.type, r._count._all])) },
    timelineEvent: { total: timelineCount },
    translation: {
      total: translationCount,
      byEntityType: Object.fromEntries(translationByEntityType.map((r) => [r.entityType, r._count._all])),
      byStatus: Object.fromEntries(translationByStatus.map((r) => [r.status, r._count._all])),
    },
    collection: { total: collectionCount },
    relationship: { total: relationshipCount },
    user: { total: userCount, byRole: Object.fromEntries(userByRole.map((r) => [r.role, r._count._all])) },
    auditLog: { total: auditLogCount },
    mediaAsset: { total: mediaAssetCount },
  };

  const outPath = path.resolve(process.cwd(), `storage/admin-restructure/${label}.json`);
  await fs.writeFile(outPath, JSON.stringify(snapshot, null, 2));
  console.log(JSON.stringify(snapshot, null, 2));
  console.log(`\nWritten to ${outPath}`);
  await prisma.$disconnect();
}

main().catch((err) => { console.error(err); process.exit(1); });
