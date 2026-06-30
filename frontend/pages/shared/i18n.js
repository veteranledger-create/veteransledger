/**
 * VeteransLedger · Public i18n core
 * Locale state, persistence, and SEO foundation for the multilingual site.
 *
 * Architecture note: this phase keeps every page at its existing URL and
 * switches displayed content client-side. Locale is persisted to both
 * localStorage and a cookie (not just localStorage) so a future server-side
 * path-based routing phase (/en/, /de/, /es/, /ru/, /ar/) can read the same
 * preference without a migration. True hreflang alternates require distinct
 * per-locale URLs and are intentionally deferred to that phase — see
 * ensureCanonicalTag() below for what IS meaningful to emit today.
 */

import { LANGUAGES } from "./locale-constants.js";

const STORAGE_KEY = "vl_locale";
const COOKIE_KEY = "vl_locale";
const DEFAULT_LOCALE = "en";
const EVENT_NAME = "vl:localechange";

let currentLocale = null;

function readCookie(name) {
  const match = document.cookie.match(new RegExp(`(?:^|; )${name}=([^;]*)`));
  return match ? decodeURIComponent(match[1]) : null;
}

function writeCookie(name, value) {
  document.cookie = `${name}=${encodeURIComponent(value)}; path=/; max-age=31536000; SameSite=Lax`;
}

function isValidLocale(code) {
  return LANGUAGES.some((l) => l.code === code);
}

function detectInitialLocale() {
  const stored = localStorage.getItem(STORAGE_KEY) || readCookie(COOKIE_KEY);
  return isValidLocale(stored) ? stored : DEFAULT_LOCALE;
}

/** Current locale code (e.g. "en", "de"). Defaults to "en" on first visit. */
export function getLocale() {
  if (!currentLocale) currentLocale = detectInitialLocale();
  return currentLocale;
}

/** Switch the active locale. Persists, updates <html>, and notifies listeners. */
export function setLocale(code) {
  if (!isValidLocale(code) || code === currentLocale) return;
  currentLocale = code;
  localStorage.setItem(STORAGE_KEY, code);
  writeCookie(COOKIE_KEY, code);
  applyDocumentAttributes(code);
  window.dispatchEvent(new CustomEvent(EVENT_NAME, { detail: { locale: code } }));
}

function applyDocumentAttributes(code) {
  const lang = LANGUAGES.find((l) => l.code === code);
  document.documentElement.lang = code;
  document.documentElement.dir = lang?.rtl ? "rtl" : "ltr";
}

/** Subscribe to locale changes. Returns an unsubscribe function. */
export function onLocaleChange(callback) {
  const handler = (e) => callback(e.detail.locale);
  window.addEventListener(EVENT_NAME, handler);
  return () => window.removeEventListener(EVENT_NAME, handler);
}

/** Call once on page load (from MainLayout) to apply the stored locale and SEO tags. */
export function initI18n() {
  applyDocumentAttributes(getLocale());
  ensureCanonicalTag();
}

// Self-referencing canonical avoids duplicate-content signals while every
// locale is served from one URL. Skipped if the page already defines one.
function ensureCanonicalTag() {
  if (document.querySelector('link[rel="canonical"]')) return;
  const link = document.createElement("link");
  link.rel = "canonical";
  link.href = window.location.origin + window.location.pathname;
  document.head.appendChild(link);
}
