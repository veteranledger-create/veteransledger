/**
 * VeteransLedger · Public translation loader
 * Fetches a translation for the active locale, with a per-session cache to
 * avoid duplicate requests when multiple components reference the same
 * entity. Always resolves (never throws) — callers fall back to the English
 * content they already have on any miss or error.
 */

import { getLocale } from "./i18n.js";
import { fetchContentJson } from "./content-fetch.js";

const cache = new Map();

/**
 * @param {string} entityType - "record" | "entity" | "timeline_event" | "site_content"
 * @param {string} entityId
 * @returns {Promise<{locale:string, fields:Record<string,string>, status:string, isMachine:boolean}|null>}
 *   null means: no translation available — display the English original.
 */
export async function loadTranslation(entityType, entityId) {
  const locale = getLocale();
  if (locale === "en" || !entityId) return null; // English is the source — never fetched as a translation

  const cacheKey = `${entityType}:${entityId}:${locale}`;
  if (cache.has(cacheKey)) return cache.get(cacheKey);

  const promise = fetch(
    `/api/translations/${encodeURIComponent(entityType)}/${encodeURIComponent(entityId)}/${locale}`,
  )
    .then((res) => {
      if (res.status === 404) return null;
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return res.json();
    })
    .then((row) =>
      row ? { locale, fields: row.fields ?? {}, status: row.status, isMachine: row.status === "machine" } : null,
    )
    .catch(() => null); // network error — silently fall back to English, never block navigation

  cache.set(cacheKey, promise);
  return promise;
}

/** Clear the in-memory cache (call after a locale switch if memory matters on long sessions). */
export function clearTranslationCache() {
  cache.clear();
}

/**
 * Fetches a JSON manifest (e.g. armaments/index.json, personnel/index.json,
 * letters/index.json) and transparently swaps in its translated content —
 * same site_content/{entityId} translation these files already accept via
 * the Admin site-content API, and the same "whole file translated as one
 * JSON string" shape used by navigation.json/homepage.json. On any miss
 * (no translation, parse failure, or fetch failure) falls back to the raw
 * English manifest so category/branch/collection labels never disappear.
 *
 * @param {string} url - e.g. "/public/data/armaments/index.json"
 * @param {string} entityId - e.g. "armaments/index.json"
 */
export async function loadManifestTranslated(url, entityId) {
  return (await loadManifestTranslatedVersioned(url, entityId)).data;
}

/**
 * As loadManifestTranslated, but also reports the published version the
 * English manifest was served from, so a caller can pin its record requests
 * to that same version.
 *
 * The version describes the English source, which is what the server
 * actually served. A translation is a stored copy of a manifest made at some
 * earlier point, so a stale one can name files that the pinned version does
 * not contain — those resolve to null exactly as a missing file always has,
 * rather than being silently answered from a different version.
 *
 * @param {string} url
 * @param {string} entityId
 * @returns {Promise<{ data: unknown, version: string|null }>}
 */
export async function loadManifestTranslatedVersioned(url, entityId) {
  const { data: english, version } = await fetchContentJson(url);

  const t = await loadTranslation("site_content", entityId);
  if (t?.fields?.content) {
    try { return { data: JSON.parse(t.fields.content), version }; }
    catch { /* translated content isn't valid JSON — keep English */ }
  }
  return { data: english, version };
}

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

/**
 * Patches an already-rendered record page in place with translated
 * title/summary/content text, falling back silently to the English content
 * that's already on screen when no translation exists. Every record.js page
 * across the site shares the same .record-header__title / .record-summary
 * markup (see frontend/pages/{Armaments,Personnel,Letters,...}/record.js),
 * so one shared patch function covers all of them. `contentSelector` is
 * opt-in (only Letters' full body currently uses it — most pages' "content"
 * is structured per-type data, not free-form prose) and renders with
 * newline-to-<br> formatting matching how each page already builds its
 * English body.
 *
 * Re-running this after a `vl:localechange` event (see i18n.js) re-applies
 * the patch for the newly selected locale without a full page reload.
 *
 * @param {HTMLElement} root - the element record.js rendered the record into
 * @param {string} entityType - "record" | "entity" | "timeline_event" | "site_content"
 * @param {string} entityId
 * @param {{titleSelector?:string, summarySelector?:string, contentSelector?:string}} [opts]
 */
export async function applyRecordTranslation(root, entityType, entityId, opts = {}) {
  if (!root || !entityId) return null;

  const titleEl = root.querySelector(opts.titleSelector ?? ".record-header__title");
  const summaryEl = root.querySelector(opts.summarySelector ?? ".record-summary");
  const contentEl = opts.contentSelector ? root.querySelector(opts.contentSelector) : null;

  // Capture the original English text on first call so a later switch back
  // to English (or to a locale with no translation yet) can restore it —
  // without this, stale translated text would persist indefinitely.
  if (titleEl && titleEl.dataset.originalText === undefined) titleEl.dataset.originalText = titleEl.textContent;
  if (summaryEl && summaryEl.dataset.originalText === undefined) summaryEl.dataset.originalText = summaryEl.textContent;
  if (contentEl && contentEl.dataset.originalHtml === undefined) contentEl.dataset.originalHtml = contentEl.innerHTML;

  const t = await loadTranslation(entityType, entityId);

  if (!t) {
    if (titleEl?.dataset.originalText !== undefined) titleEl.textContent = titleEl.dataset.originalText;
    if (summaryEl?.dataset.originalText !== undefined) summaryEl.textContent = summaryEl.dataset.originalText;
    if (contentEl?.dataset.originalHtml !== undefined) contentEl.innerHTML = contentEl.dataset.originalHtml;
    return null;
  }

  if (titleEl && t.fields.title) titleEl.textContent = t.fields.title;
  if (summaryEl && t.fields.summary) summaryEl.textContent = t.fields.summary;
  if (contentEl && t.fields.content) contentEl.innerHTML = escapeHtml(t.fields.content).replace(/\n/g, "<br>");

  return t;
}
