import fs from "fs";
import path from "path";
import prisma from "../../database/prisma";
import { config } from "../../config/app";
import { paths } from "../../config/paths";

/**
 * Dashboard aggregates.
 *
 * Every figure returned here is either a database aggregate (COUNT /
 * GROUP BY against an indexed column) or a direct measurement of the
 * file-backed content under public/data. Nothing is estimated, sampled or
 * extrapolated — if a number cannot be measured it is simply not returned,
 * so the Admin never shows a fabricated metric.
 */

// Locales the public site offers. Mirrors
// frontend/pages/shared/locale-constants.js; kept here so translation
// coverage can be expressed as a denominator without the API importing
// frontend code.
const SUPPORTED_LOCALES = ["de", "ja", "it", "ru", "es", "fr", "uk", "ar"];

const IMAGE_RE = /\.(jpe?g|png|webp|gif|svg|bmp|tiff?)$/i;
const UNVERIFIED_RE = /unverified|pending|unconfirmed/i;

// Content-health scanning walks ~150 JSON files. That is cheap, but the
// dashboard can be reloaded freely, so the result is memoised briefly
// rather than rescanning on every request.
const HEALTH_TTL_MS = 60_000;
let healthCache: { at: number; value: ContentHealth } | null = null;

export interface ContentHealth {
  scannedFiles: number;
  imageReferences: { total: number; unique: number; resolved: number; missing: number };
  provenance: { declaredAiGenerated: number; unverifiedSource: number; noProvenanceRecorded: number; documented: number };
  samples: { missing: string[]; unverified: string[] };
  measuredAt: string;
}

function walkJson(dir: string, out: string[] = []): string[] {
  let entries: fs.Dirent[];
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return out; }
  for (const e of entries) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walkJson(p, out);
    else if (e.name.endsWith(".json")) out.push(p);
  }
  return out;
}

/** Maps a public URL path (/public/... or /storage/...) to a file on disk. */
function resolveAssetPath(url: string): string | null {
  const asPublic = url.startsWith("/public/") ? paths.publicAsset.fromUrl(url) : null;
  if (asPublic) return asPublic;
  if (url.startsWith("/storage/")) return path.join(config.paths.storage, url.slice("/storage/".length));
  return null;
}

/**
 * Walks every object in a content file looking for image references, and
 * classifies the provenance metadata recorded alongside each one. The
 * provenance fields are the archive's own (`is_ai_generated`,
 * `historical_status`, `source`, `credit`, `license`, `archive`) — nothing
 * is inferred about an image beyond what the data already states.
 */
function scanNode(node: unknown, acc: {
  refs: string[];
  ai: number; unverified: number; none: number; documented: number;
  unverifiedSamples: string[];
}): void {
  if (Array.isArray(node)) { node.forEach((n) => scanNode(n, acc)); return; }
  if (!node || typeof node !== "object") return;

  const obj = node as Record<string, unknown>;
  let selfIsImage = false;

  for (const [key, value] of Object.entries(obj)) {
    if (typeof value === "string" && IMAGE_RE.test(value) && value.includes("/")) {
      acc.refs.push(value);
      if (key === "src") selfIsImage = true;
    } else {
      scanNode(value, acc);
    }
  }

  // Provenance is only meaningful on the image object itself (the one that
  // carries `src`), not on every ancestor that happens to contain a path.
  if (selfIsImage) {
    const status = typeof obj.historical_status === "string" ? obj.historical_status : "";
    const documented = ["source", "credit", "license", "archive", "collection"]
      .some((k) => typeof obj[k] === "string" && (obj[k] as string).trim() !== "");

    if (obj.is_ai_generated === true) acc.ai++;
    if (UNVERIFIED_RE.test(status)) {
      acc.unverified++;
      if (acc.unverifiedSamples.length < 10 && typeof obj.src === "string") acc.unverifiedSamples.push(obj.src);
    }
    if (documented) acc.documented++;
    else if (!status) acc.none++;
  }
}

export class DashboardService {
  /**
   * Archive totals. Every value is a COUNT or GROUP BY; `recordsByType` and
   * `entitiesByType` use the records_type / entities_type indexes, and
   * translation grouping uses translations_locale_status. No table is read
   * in full.
   */
  async getStats(): Promise<object> {
    const [
      records, entities, media, events,
      publishedRecords, publishedEntities, publishedEvents,
      recordsByType, entitiesByType,
      translationTotal, translationsByLocale, translationsByType,
    ] = await Promise.all([
      prisma.record.count(),
      prisma.entity.count(),
      prisma.mediaAsset.count(),
      prisma.timelineEvent.count(),
      prisma.record.count({ where: { published: true } }),
      prisma.entity.count({ where: { published: true } }),
      prisma.timelineEvent.count({ where: { published: true } }),
      prisma.record.groupBy({ by: ["type"], _count: { _all: true } }),
      prisma.entity.groupBy({ by: ["type"], _count: { _all: true } }),
      prisma.translation.count(),
      prisma.translation.groupBy({ by: ["locale"], _count: { _all: true } }),
      prisma.translation.groupBy({ by: ["entityType"], _count: { _all: true } }),
    ]);

    const asMap = (rows: { _count: { _all: number } }[], key: string) =>
      Object.fromEntries(rows.map((r) => [(r as unknown as Record<string, string>)[key], r._count._all]));

    // Record translations are the only DB-backed content currently
    // translated per-row, so coverage is expressed against that denominator
    // and labelled as such rather than implying whole-archive coverage.
    const recordTranslations = translationsByType.find((t) => t.entityType === "record")?._count._all ?? 0;

    return {
      // Backwards-compatible keys the existing stat cards already read.
      records, entities, media, events,
      published: { records: publishedRecords, entities: publishedEntities, events: publishedEvents },
      recordsByType: asMap(recordsByType, "type"),
      entitiesByType: asMap(entitiesByType, "type"),
      translations: {
        total: translationTotal,
        byLocale: asMap(translationsByLocale, "locale"),
        byEntityType: asMap(translationsByType, "entityType"),
        supportedLocales: SUPPORTED_LOCALES.length,
        recordCoverage: {
          translated: recordTranslations,
          possible: publishedRecords * SUPPORTED_LOCALES.length,
        },
      },
    };
  }

  /**
   * File-backed content health. Reads public/data and checks whether each
   * referenced asset exists on disk; returns aggregates plus at most ten
   * example paths so the figures are actionable without shipping a dataset.
   */
  async getContentHealth(): Promise<ContentHealth> {
    if (healthCache && Date.now() - healthCache.at < HEALTH_TTL_MS) return healthCache.value;

    const dataDir = paths.published.root;
    const files = walkJson(dataDir);
    const acc = { refs: [] as string[], ai: 0, unverified: 0, none: 0, documented: 0, unverifiedSamples: [] as string[] };

    for (const f of files) {
      try { scanNode(JSON.parse(fs.readFileSync(f, "utf-8")), acc); } catch { /* skip unreadable/invalid file */ }
    }

    const unique = [...new Set(acc.refs)];
    const missing: string[] = [];
    let resolved = 0;
    for (const ref of unique) {
      const disk = resolveAssetPath(ref);
      if (!disk) continue; // external or unrecognised prefix — not ours to judge
      let ok = false;
      try { ok = fs.statSync(disk).size > 0; } catch { ok = false; }
      if (ok) resolved++; else missing.push(ref);
    }

    const value: ContentHealth = {
      scannedFiles: files.length,
      imageReferences: { total: acc.refs.length, unique: unique.length, resolved, missing: missing.length },
      provenance: {
        declaredAiGenerated: acc.ai,
        unverifiedSource: acc.unverified,
        noProvenanceRecorded: acc.none,
        documented: acc.documented,
      },
      samples: { missing: missing.slice(0, 10), unverified: acc.unverifiedSamples.slice(0, 10) },
      measuredAt: new Date().toISOString(),
    };

    healthCache = { at: Date.now(), value };
    return value;
  }

  async getRecentActivity(): Promise<object[]> {
    const logs = await prisma.auditLog.findMany({
      orderBy: { createdAt: "desc" },
      take: 20,
      include: { user: { select: { email: true } } },
    });
    return logs;
  }
}
