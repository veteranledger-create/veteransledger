-- Migration: fix_migration_drift
-- Reconciles migration history with schema.prisma. None of this changes
-- application behavior: every statement is additive/relaxing, not
-- destructive, and no application code currently depends on the DB-level
-- default being removed from translations.fields (Prisma Client always
-- supplies that field explicitly since schema.prisma declares no @default).
--
-- 1) timeline_events: schema.prisma declares `year Int?` and `date DateTime?`,
--    but no prior migration ever added `year` or relaxed `date` to nullable.
-- 2) translations.fields: the first translations migration set a DB-level
--    default ('{}') that schema.prisma has never declared; dropping it here
--    makes the column match schema.prisma exactly. Existing rows and all
--    inserts are unaffected because every insert already specifies `fields`.
-- 3) records / entities / audit_logs: seven indexes declared in
--    schema.prisma were never created in any migration.

-- AlterTable
ALTER TABLE "timeline_events" ADD COLUMN     "year" INTEGER,
ALTER COLUMN "date" DROP NOT NULL;

-- AlterTable
ALTER TABLE "translations" ALTER COLUMN "fields" DROP DEFAULT;

-- CreateIndex
CREATE INDEX "audit_logs_userId_idx" ON "audit_logs"("userId");

-- CreateIndex
CREATE INDEX "audit_logs_createdAt_idx" ON "audit_logs"("createdAt");

-- CreateIndex
CREATE INDEX "entities_type_idx" ON "entities"("type");

-- CreateIndex
CREATE INDEX "entities_type_published_idx" ON "entities"("type", "published");

-- CreateIndex
CREATE INDEX "records_type_idx" ON "records"("type");

-- CreateIndex
CREATE INDEX "records_type_published_idx" ON "records"("type", "published");

-- CreateIndex
CREATE INDEX "records_createdAt_idx" ON "records"("createdAt");
