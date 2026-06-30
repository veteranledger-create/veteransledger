-- Migration: add_translations
-- Adds the Translation table for multilingual content support.
-- entityType + entityId + locale forms a composite unique key so
-- every source record has at most one translation per locale.

CREATE TABLE "translations" (
    "id"          TEXT NOT NULL,
    "entityType"  TEXT NOT NULL,
    "entityId"    TEXT NOT NULL,
    "locale"      TEXT NOT NULL,
    "status"      TEXT NOT NULL DEFAULT 'machine',
    "fields"      JSONB NOT NULL DEFAULT '{}',
    "generatedAt" TIMESTAMP(3),
    "verifiedAt"  TIMESTAMP(3),
    "createdAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"   TIMESTAMP(3) NOT NULL,

    CONSTRAINT "translations_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "translations_entityType_entityId_locale_key"
    ON "translations"("entityType", "entityId", "locale");

CREATE INDEX "translations_entityType_entityId_idx"
    ON "translations"("entityType", "entityId");
