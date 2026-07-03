import prisma from "../../database/prisma";
import { AppError } from "../../middleware/error.middleware";
import { SiteContentService } from "../site-content/site-content.service";
import { resolveProvider, TranslationProvider } from "./providers";

// Supported target locales (English is always the source)
export const SUPPORTED_LOCALES = ["de", "ja", "it", "ru", "es", "fr", "uk", "ar"] as const;
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

// ── Translation provider ──────────────────────────────────────────────────────
//
// Vendor-specific logic lives in providers.ts (LibreTranslate, DeepL, Google,
// OpenAI — interchangeable via configuration, extensible for future vendors).
// When nothing is configured, resolveProvider() returns null and automatic
// translation is disabled gracefully; manual editing is unaffected. A
// provider either returns real translated text or throws — generate() never
// stores English source as a fake "translation".

const NOT_CONFIGURED = () =>
  new AppError(
    503,
    "Machine translation is not configured. Translations can still be written manually in the editor.",
  );

// ── Structure-preserving JSON translation (site_content) ─────────────────────
//
// Site-content files (homepage, navigation, site settings, pages, policies…)
// are JSON documents. Translating the raw serialized string would mangle keys
// and identifiers, so instead we walk the parsed structure and translate only
// human-readable string VALUES, leaving keys, paths, URLs, ids, dates, and
// other machine-facing values untouched. The output re-serializes to valid
// JSON with the exact original shape.

const NON_TRANSLATABLE_KEYS = new Set([
  "id", "recordId", "href", "url", "src", "file", "icon", "image", "key",
  "slug", "code", "type", "section", "category", "theater", "collection",
  "action", "dataUrl", "panelId", "email", "privacyHref", "font", "template",
]);

function isTranslatableString(key: string, value: string): boolean {
  if (NON_TRANSLATABLE_KEYS.has(key)) return false;
  const v = value.trim();
  if (!v) return false;
  if (/^(https?:)?\//.test(v)) return false;          // URL or absolute path
  if (/^[\d\s.,:;\/\-–—%]+$/.test(v)) return false;    // numbers, dates, ranges
  if (v.includes("@") && !v.includes(" ")) return false; // email addresses
  return true;
}

type JsonValue = string | number | boolean | null | JsonValue[] | { [k: string]: JsonValue };

// Collect-then-apply: gather every translatable string first, translate them
// with bounded concurrency, then write results back. One provider failure
// aborts the whole operation — no partially translated document is stored.
async function translateJsonStructure(root: JsonValue, locale: string, provider: TranslationProvider): Promise<JsonValue> {
  const cloned = JSON.parse(JSON.stringify(root)) as JsonValue;
  const slots: Array<{ parent: Record<string, JsonValue> | JsonValue[]; key: string | number; text: string }> = [];

  const walk = (node: JsonValue, parent: Record<string, JsonValue> | JsonValue[] | null, key: string | number): void => {
    if (typeof node === "string") {
      const keyHint = typeof key === "string" ? key : "";
      if (parent && isTranslatableString(keyHint, node)) slots.push({ parent, key, text: node });
      return;
    }
    if (Array.isArray(node)) {
      node.forEach((child, i) => walk(child, node, typeof key === "string" ? key : i));
      return;
    }
    if (node && typeof node === "object") {
      for (const [k, v] of Object.entries(node)) walk(v, node, k);
    }
  };
  walk(cloned, null, "");

  const CONCURRENCY = 5;
  for (let i = 0; i < slots.length; i += CONCURRENCY) {
    const chunk = slots.slice(i, i + CONCURRENCY);
    const results = await Promise.all(chunk.map((s) => provider.translate(s.text, locale)));
    chunk.forEach((s, j) => {
      (s.parent as Record<string | number, JsonValue>)[s.key] = results[j];
    });
  }
  return cloned;
}

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
      // Handled directly inside generate(): the source JSON is loaded
      // server-side from the live file and translated structure-preservingly.
      // This branch is unreachable from generate() and exists only so an
      // unexpected caller gets an explicit error instead of empty fields.
      throw new AppError(500, "site_content source extraction is handled by generate() directly.");
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
   * Availability of automatic machine translation. Exposed to the Admin UI
   * (GET /api/translations/status) so Generate actions can be disabled
   * proactively instead of failing at click time.
   */
  availability(): { available: boolean; provider: string | null } {
    const p = resolveProvider();
    return { available: !!p, provider: p?.name ?? null };
  }

  /**
   * Generate (or regenerate) a translation for the given locale.
   * - Refuses to overwrite `human`/`published` status unless force=true.
   * - Throws 503 if no provider is configured, 502 if the provider fails —
   *   nothing is ever stored in either case, so a "machine" row always
   *   holds real translated output.
   * - For site_content the source JSON is loaded server-side from the live
   *   file and translated structure-preservingly (string values only);
   *   rawContent remains an optional caller override.
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

    const provider = resolveProvider();
    if (!provider) throw NOT_CONFIGURED();

    // Guard: never overwrite human-verified or published translations unless explicitly forced
    const existing = await this.get(entityType, entityId, locale);
    if ((existing?.status === "human" || existing?.status === "published") && !options.force) {
      throw new AppError(
        409,
        `This translation is ${existing.status === "published" ? "Published" : "Human Verified"}. Use force=true to regenerate.`,
      );
    }

    const translatedFields: TranslationFields = {};

    if (entityType === "site_content") {
      // Load the source document (client-supplied override, else the live file).
      let source: unknown;
      if (options.rawContent) {
        try { source = JSON.parse(options.rawContent); }
        catch { source = options.rawContent; }
      } else {
        source = await new SiteContentService().read(entityId);
      }
      if (typeof source === "string") {
        translatedFields.content = await provider.translate(source, locale);
      } else {
        const translated = await translateJsonStructure(source as JsonValue, locale, provider);
        translatedFields.content = JSON.stringify(translated, null, 2);
      }
    } else {
      const sourceFields = await extractSourceFields(entityType, entityId);
      if (Object.keys(sourceFields).length === 0) {
        throw new AppError(400, "Source record has no translatable fields — nothing to translate.");
      }
      // Translate each non-empty field; any provider failure aborts before storage
      await Promise.all(
        Object.entries(sourceFields).map(async ([key, value]) => {
          translatedFields[key] = value
            ? await provider.translate(value, locale)
            : value;
        }),
      );
    }

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
   * Save a translation's fields and/or status. Upserts: manual translation
   * authoring must work even when no machine-translation provider is
   * configured, so saving from the editor CREATES the row when none exists
   * yet. Setting status="human" or "published" records verifiedAt;
   * "published" additionally records publishedAt; back to "machine" clears both.
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
    // Never create rows whose every field is empty — that would be a fake
    // "translated" state indistinguishable from real content in listings.
    if (!Object.values(fields).some((v) => typeof v === "string" && v.trim())) {
      throw new AppError(400, "Translation is empty — write some translated text before saving.");
    }
    const existing = await this.get(entityType, entityId, locale);

    const now = new Date();
    return prisma.translation.upsert({
      where: { entityType_entityId_locale: { entityType, entityId, locale } },
      create: {
        entityType,
        entityId,
        locale,
        fields,
        status,
        verifiedAt: status === "human" || status === "published" ? now : null,
        publishedAt: status === "published" ? now : null,
      },
      update: {
        fields,
        status,
        verifiedAt: status === "human" || status === "published" ? (existing?.verifiedAt ?? now) : null,
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
