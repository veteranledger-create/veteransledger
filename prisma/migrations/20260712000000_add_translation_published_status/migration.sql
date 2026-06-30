-- Migration: add_translation_published_status
-- Adds a "published" lifecycle stage to translations (missing -> machine ->
-- human -> published) and an index supporting per-locale status dashboard
-- queries.

ALTER TABLE "translations" ADD COLUMN "publishedAt" TIMESTAMP(3);

CREATE INDEX "translations_locale_status_idx"
    ON "translations"("locale", "status");
