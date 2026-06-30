import prisma from "../../database/prisma";
import { AppError } from "../../middleware/error.middleware";

// Supported target locales (English is always the source)
export const SUPPORTED_LOCALES = ["de", "es", "ru", "ar"] as const;
export type Locale = typeof SUPPORTED_LOCALES[number];

// Translatable fields per entity type. Determines what gets extracted from
// the source record and what editors see in the translation modal.
const SOURCE_FIELDS: Record<string, string[]> = {
  record:         ["title", "summary", "content"],
  entity:         ["name", "summary", "biography"],
  timeline_event: ["title", "summary"],
  site_content:   ["content"],
};

type TranslationFields = Record<string, string>;
export type TranslationStatus = "machine" | "human" | "published";

// entityTypes backed by a Prisma table — their total source count is knowable.
// "site_content" is file-based with an open-ended key space (see site-content
// service's ALLOWED_PREFIXES), so its coverage is queried per-key on demand
// via getItemStatuses() rather than duplicated here as a manifest.
const COUNTABLE_ENTITY_TYPES = ["record", "entity", "timeline_event"] as const;

// ── Translation provider interface ────────────────────────────────────────────

interface TranslationProvider {
  translate(text: string, targetLocale: string): Promise<string>;
}

// LibreTranslate adapter — connects to a self-hosted free translation server.
// Set LIBRE_TRANSLATE_URL=http://localhost:5000 (or your hosted instance).
// Falls back to source text when URL is not configured or the call fails.
class LibreTranslateProvider implements TranslationProvider {
  private readonly url: string | undefined;

  constructor() {
    this.url = process.env.LIBRE_TRANSLATE_URL?.replace(/\/$/, "");
  }

  async translate(text: string, targetLocale: string): Promise<string> {
    if (!this.url || !text.trim()) return text;
    try {
      const res = await fetch(`${this.url}/translate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ q: text, source: "en", target: targetLocale, format: "text" }),
        signal: AbortSignal.timeout(10_000),
      });
      if (!res.ok) return text;
      const data = (await res.json()) as { translatedText?: string };
      return data.translatedText || text;
    } catch {
      return text; // network error or timeout — return source unchanged
    }
  }
}

const provider: TranslationProvider = new LibreTranslateProvider();

// ── Source field extraction ───────────────────────────────────────────────────

async function extractSourceFields(
  entityType: string,
  entityId: string,
): Promise<TranslationFields> {
  const fieldNames = SOURCE_FIELDS[entityType] ?? ["title", "summary"];

  switch (entityType) {
    case "record": {
      const r = await prisma.record.findUnique({ where: { id: entityId } });
      if (!r) throw new AppError(404, "Source record not found");
      return {
        ...(r.title    ? { title:   r.title }            : {}),
        ...(r.summary  ? { summary: r.summary }          : {}),
        ...(r.content  ? { content: r.content }          : {}),
      };
    }
    case "entity": {
      const e = await prisma.entity.findUnique({ where: { id: entityId } });
      if (!e) throw new AppError(404, "Source entity not found");
      const bio = (e.metadata as Record<string, unknown> | null)?.biography as string | undefined;
      return {
        ...(e.name      ? { name:      e.name }      : {}),
        ...(e.summary   ? { summary:   e.summary }   : {}),
        ...(bio         ? { biography: bio }          : {}),
      };
    }
    case "timeline_event": {
      const t = await prisma.timelineEvent.findUnique({ where: { id: entityId } });
      if (!t) throw new AppError(404, "Source timeline event not found");
      return {
        ...(t.title   ? { title:   t.title }   : {}),
        ...(t.summary ? { summary: t.summary } : {}),
      };
    }
    case "site_content": {
      // entityId is the site-content key (e.g. "nsdap/overview.json")
      // The full JSON is stored as the "content" field; the caller provides it.
      // Return empty — the generate endpoint receives raw content via request body.
      return {};
    }
    default:
      throw new AppError(400, `Unsupported entity type: ${entityType}`);
  }
}

// ── Service ───────────────────────────────────────────────────────────────────

export class TranslationsService {
  /** Return all existing translations for a given source record, keyed by locale. */
  async list(entityType: string, entityId: string) {
    const rows = await prisma.translation.findMany({
      where: { entityType, entityId },
      orderBy: { locale: "asc" },
    });
    const map: Record<string, unknown> = {};
    for (const row of rows) map[row.locale] = row;
    return map;
  }

  /** Get a single locale translation. Returns null if not found (not an error). */
  async get(entityType: string, entityId: string, locale: string) {
    return prisma.translation.findUnique({
      where: { entityType_entityId_locale: { entityType, entityId, locale } },
    });
  }

  /**
   * Generate (or regenerate) a translation for the given locale.
   * - Refuses to overwrite `human` status unless force=true.
   * - Calls the translation provider for each source field.
   * - For site_content, rawContent must be supplied as a string.
   */
  async generate(
    entityType: string,
    entityId: string,
    locale: string,
    options: { force?: boolean; rawContent?: string } = {},
  ) {
    if (!SUPPORTED_LOCALES.includes(locale as Locale)) {
      throw new AppError(400, `Unsupported locale: ${locale}`);
    }

    // Guard: never overwrite human-verified or published translations unless explicitly forced
    const existing = await this.get(entityType, entityId, locale);
    if ((existing?.status === "human" || existing?.status === "published") && !options.force) {
      throw new AppError(
        409,
        `This translation is ${existing.status === "published" ? "Published" : "Human Verified"}. Use force=true to regenerate.`,
      );
    }

    // Extract source fields
    let sourceFields: TranslationFields;
    if (entityType === "site_content" && options.rawContent) {
      sourceFields = { content: options.rawContent };
    } else {
      sourceFields = await extractSourceFields(entityType, entityId);
    }

    // Translate each non-empty field
    const translatedFields: TranslationFields = {};
    await Promise.all(
      Object.entries(sourceFields).map(async ([key, value]) => {
        translatedFields[key] = value
          ? await provider.translate(value, locale)
          : value;
      }),
    );

    const now = new Date();
    return prisma.translation.upsert({
      where: { entityType_entityId_locale: { entityType, entityId, locale } },
      create: {
        entityType,
        entityId,
        locale,
        status: "machine",
        fields: translatedFields,
        generatedAt: now,
      },
      update: {
        status: "machine",
        fields: translatedFields,
        generatedAt: now,
        verifiedAt: null,
      },
    });
  }

  /**
   * Update a translation's fields and/or status.
   * Setting status="human" or "published" records verifiedAt; "published"
   * additionally records publishedAt. Moving back to "machine" clears both.
   */
  async update(
    entityType: string,
    entityId: string,
    locale: string,
    fields: TranslationFields,
    status: TranslationStatus,
  ) {
    if (!SUPPORTED_LOCALES.includes(locale as Locale)) {
      throw new AppError(
        400,
        locale === "en"
          ? "English is the source language. It is stored in the primary tables and must not be written to the translations table."
          : `Unsupported locale: ${locale}. Supported: ${SUPPORTED_LOCALES.join(", ")}.`,
      );
    }
    const existing = await this.get(entityType, entityId, locale);
    if (!existing) throw new AppError(404, "Translation not found");

    const now = new Date();
    return prisma.translation.update({
      where: { entityType_entityId_locale: { entityType, entityId, locale } },
      data: {
        fields,
        status,
        verifiedAt: status === "human" || status === "published" ? (existing.verifiedAt ?? now) : null,
        publishedAt: status === "published" ? now : null,
      },
    });
  }

  /** Delete a translation. */
  async delete(entityType: string, entityId: string, locale: string) {
    if (!SUPPORTED_LOCALES.includes(locale as Locale)) {
      throw new AppError(
        400,
        locale === "en"
          ? "English is the source language and cannot be deleted from the translations table."
          : `Unsupported locale: ${locale}. Supported: ${SUPPORTED_LOCALES.join(", ")}.`,
      );
    }
    const existing = await this.get(entityType, entityId, locale);
    if (!existing) throw new AppError(404, "Translation not found");
    await prisma.translation.delete({
      where: { entityType_entityId_locale: { entityType, entityId, locale } },
    });
  }

  // ── Dashboard (Admin Translation tab) ─────────────────────────────────────

  /**
   * Coverage summary for every entity type, broken down by locale and status.
   * For DB-backed types (record/entity/timeline_event) "missing" is exact
   * (sourceTotal - translated). For "site_content" only existing-row counts
   * are returned (the key space is open-ended — see getItemStatuses()).
   */
  async dashboardSummary() {
    const grouped = await prisma.translation.groupBy({
      by: ["entityType", "locale", "status"],
      _count: { _all: true },
    });

    const sourceTotals: Record<string, number> = {};
    for (const t of COUNTABLE_ENTITY_TYPES) {
      sourceTotals[t] =
        t === "record" ? await prisma.record.count()
        : t === "entity" ? await prisma.entity.count()
        : await prisma.timelineEvent.count();
    }

    const entityTypes = new Set<string>([...COUNTABLE_ENTITY_TYPES, "site_content"]);
    for (const g of grouped) entityTypes.add(g.entityType);

    return Array.from(entityTypes).map((entityType) => {
      const sourceTotal = sourceTotals[entityType] ?? null;
      const locales: Record<string, Record<string, number>> = {};
      for (const locale of SUPPORTED_LOCALES) {
        locales[locale] = { machine: 0, human: 0, published: 0 };
      }
      for (const g of grouped) {
        if (g.entityType !== entityType) continue;
        locales[g.locale] ??= { machine: 0, human: 0, published: 0 };
        locales[g.locale][g.status] = g._count._all;
      }
      for (const locale of Object.keys(locales)) {
        const translated = Object.values(locales[locale]).reduce((a, b) => a + b, 0);
        (locales[locale] as Record<string, number | null>).missing =
          sourceTotal === null ? null : Math.max(0, sourceTotal - translated);
      }
      return { entityType, sourceTotal, locales };
    });
  }

  /**
   * Per-locale status for a specific batch of entityIds within one entityType.
   * Used by the dashboard drill-down table; the caller (Admin frontend) supplies
   * the entityId list since it already owns the canonical manifest for
   * file-based types like "site_content".
   */
  async getItemStatuses(entityType: string, entityIds: string[]) {
    const rows = await prisma.translation.findMany({
      where: { entityType, entityId: { in: entityIds } },
    });
    const byEntity = new Map<string, Record<string, { status: string; updatedAt: Date } | null>>();
    for (const id of entityIds) {
      byEntity.set(
        id,
        Object.fromEntries(SUPPORTED_LOCALES.map((l) => [l, null])),
      );
    }
    for (const row of rows) {
      const entry = byEntity.get(row.entityId);
      if (entry) entry[row.locale] = { status: row.status, updatedAt: row.updatedAt };
    }
    return entityIds.map((entityId) => ({ entityId, locales: byEntity.get(entityId) }));
  }
}
