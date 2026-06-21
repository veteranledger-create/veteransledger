import prisma from "../../../database/prisma";

// Shared by every onboarded content type's importer, parameterized by
// Record.type — first built for Letters alone, generalized here when
// Articles became the second type, per the Phase 2 audit's own
// recommendation not to copy-paste this a second time.
//
// Every record created by a given run carries metadata.importRunId, so a
// later decision to undo a successful (not failed — failures already roll
// back automatically via the transaction) import can target exactly that
// run's rows. The `type` filter is a deliberate second safeguard beyond
// the runId match alone — even though runIds are UUIDs and won't collide
// across types in practice, a rollback call should never be able to touch
// a different content type's rows even in theory.
export async function rollbackImportRun(type: string, runId: string): Promise<{ deletedRecords: number }> {
  const result = await prisma.record.deleteMany({
    where: { type, metadata: { path: ["importRunId"], equals: runId } },
  });
  return { deletedRecords: result.count };
}

// Personnel (and any future Entity-mapped content type) needs a separate
// function rather than a polymorphic table-switch on the one above —
// Record and Entity have genuinely different cascade relations
// (Relationship/MediaAsset/Citation/EntityAlias all cascade off Entity,
// Record's cascades differ), so keeping them as two small, explicit
// functions avoids one accidentally assuming the wrong table's relations.
// Deleting an Entity cascades through Relationship (onDelete: Cascade on
// both from/to), so rolling back a run also removes any Relationship row
// touching a deleted entity — but only those, since cascade only follows
// real foreign keys to rows actually being deleted.
export async function rollbackEntityImportRun(type: string, runId: string): Promise<{ deletedRecords: number }> {
  const result = await prisma.entity.deleteMany({
    where: { type, metadata: { path: ["importRunId"], equals: runId } },
  });
  return { deletedRecords: result.count };
}
