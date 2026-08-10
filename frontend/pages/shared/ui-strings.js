/**
 * VeteransLedger · Interface string catalog
 *
 * Centralizes UI chrome text (buttons, empty states, error messages, form
 * labels, notifications) that isn't CMS-managed content and previously had
 * no localization path at all. Deliberately reuses the existing site_content
 * translation machinery rather than introducing a second system:
 *
 *   - English source of truth: /public/data/ui-strings.json (a flat
 *     key → string map), same shape/location as navigation.json,
 *     homepage.json, etc.
 *   - Translations: fetched the same way as any other site_content file,
 *     via loadTranslation("site_content", "ui-strings.json") — Admin can
 *     generate/edit/publish them exactly like it does for Homepage or
 *     Navigation & Footer today, no new backend or Admin UI required.
 *
 * Two usage patterns, matching the codebase's existing data-bind convention:
 *   1. Declarative — mark an element `data-i18n="key"` (or
 *      `data-i18n-placeholder="key"` / `data-i18n-aria-label="key"`) with the
 *      English text already in place as the no-JS/pre-resolve fallback, then
 *      call applyUiStrings(root) after rendering.
 *   2. Programmatic — call t("key", vars, fallback) directly inside a
 *      template string, same call shape as any other string.
 *
 * applyUiStrings(document) is re-run automatically on every locale change, so
 * most pages don't need their own onLocaleChange wiring for chrome text —
 * only for dynamically-rendered nodes created *between* locale changes should
 * a page call applyUiStrings(root) itself, right after inserting them.
 */

import { getLocale, onLocaleChange } from "./i18n.js";
import { loadTranslation } from "./translation-loader.js";

const CATALOG_URL = "/public/data/ui-strings.json";

let EN = null;
let current = null;

async function loadEnglishCatalog() {
  if (EN) return EN;
  try {
    const res = await fetch(CATALOG_URL);
    EN = res.ok ? await res.json() : {};
  } catch {
    EN = {};
  }
  return EN;
}

async function resolveCatalog() {
  const en = await loadEnglishCatalog();
  const locale = getLocale();
  if (locale === "en") {
    current = en;
    return;
  }
  const t = await loadTranslation("site_content", "ui-strings.json");
  if (t?.fields?.content) {
    try {
      current = { ...en, ...JSON.parse(t.fields.content) };
      return;
    } catch {
      /* translated content isn't valid JSON — keep English */
    }
  }
  current = en;
}

let ready = resolveCatalog().then(() => applyUiStrings(document));

onLocaleChange(() => {
  ready = resolveCatalog().then(() => applyUiStrings(document));
});

/** Resolves once the catalog for the current locale is loaded (already resolved after first load). */
export function whenUiStringsReady() {
  return ready;
}

/**
 * Look up a UI string by key, with optional {placeholder} substitution.
 * Falls back to `fallback` (or the key itself) if the catalog hasn't
 * resolved yet or has no entry — callers should always pass the English
 * text as `fallback` so first paint never shows a raw key.
 */
export function t(key, vars, fallback) {
  const dict = current || EN || {};
  let text = dict[key] ?? fallback ?? key;
  if (vars) {
    for (const [k, v] of Object.entries(vars)) {
      text = text.replace(new RegExp(`\\{${k}\\}`, "g"), v);
    }
  }
  return text;
}

/** Patches every data-i18n[-placeholder|-aria-label] element under root from the current catalog. */
export function applyUiStrings(root = document) {
  const dict = current || EN || {};
  if (!dict) return;

  root.querySelectorAll("[data-i18n]").forEach((el) => {
    const key = el.getAttribute("data-i18n");
    if (dict[key] != null) el.textContent = dict[key];
  });
  root.querySelectorAll("[data-i18n-placeholder]").forEach((el) => {
    const key = el.getAttribute("data-i18n-placeholder");
    if (dict[key] != null) el.setAttribute("placeholder", dict[key]);
  });
  root.querySelectorAll("[data-i18n-aria-label]").forEach((el) => {
    const key = el.getAttribute("data-i18n-aria-label");
    if (dict[key] != null) el.setAttribute("aria-label", dict[key]);
  });
}
