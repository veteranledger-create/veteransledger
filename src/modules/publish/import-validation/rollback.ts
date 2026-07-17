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

// For the 4 content types (Armaments/Articles/Campaigns/Letters) whose
// importer also upserts Collection rows. A Collection is tagged with
// metadata.importRunId only in its `create` branch (see each importer's
// tx.collection.upsert call) — never in `update`, so a Collection that
// already existed before this run (or was created by a different run)
// never carries this run's tag and can never be touched here, satisfying
// "do not delete pre-existing Collections" by construction, not by a
// separate check.
//
// A tagged Collection is only actually deleted if, after this run's
// Records are removed, it has zero Records left pointing at it — this
// covers the (currently theoretical, since each run uses a distinct
// category+sub-slug) case where a later run added more Records to a
// Collection this run created; deleting the Collection out from under
// live Records would violate "leave the database exactly as it was
// before the import" for that later run, so it's left in place instead.
// Both steps run in one transaction so a rollback is itself atomic.
export async function rollbackImportRunWithCollections(
  type: string,
  runId: string,
  collectionCategory: string,
): Promise<{ deletedRecords: number; deletedCollections: number }> {
  return prisma.$transaction(async (tx) => {
    const deleted = await tx.record.deleteMany({
      where: { type, metadata: { path: ["importRunId"], equals: runId } },
    });

    const taggedCollections = await tx.collection.findMany({
      where: { category: collectionCategory, metadata: { path: ["importRunId"], equals: runId } },
      select: { id: true },
    });

    let deletedCollections = 0;
    for (const collection of taggedCollections) {
      const remaining = await tx.record.count({ where: { collectionId: collection.id } });
      if (remaining === 0) {
        await tx.collection.delete({ where: { id: collection.id } });
        deletedCollections++;
      }
    }

    return { deletedRecords: deleted.count, deletedCollections };
  });
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

// TimelineEvent has no `type` discriminator column (unlike Record/Entity),
// so this variant filters on the runId tag alone — there is only one
// content type in this table, so no second-safeguard filter is possible
// or necessary.
export async function rollbackTimelineImportRun(runId: string): Promise<{ deletedRecords: number }> {
  const result = await prisma.timelineEvent.deleteMany({
    where: { metadata: { path: ["importRunId"], equals: runId } },
  });
  return { deletedRecords: result.count };
}
