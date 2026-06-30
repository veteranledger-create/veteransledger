import { authHeader, makeStatusFn, safeJson } from "./admin-utils.js";
import { TranslationsPanel } from "./translations-panel.js";

/**
 * VeteransLedger · Admin — Page Content Editor
 * Reads/writes /public/data/page-content.json via the site-content API.
 * Controls hero title/subtitle and meta title/description for every public page.
 * The About page also exposes its archive-info sidebar values.
 */

const KEY = "page-content.json";
const setStatus = makeStatusFn("pce-form-status");
const translationsPanel = new TranslationsPanel("pce-translations-panel", "site_content");

let fullData = null;

const PAGES = [
  { value: "about",      label: "About",        hasArchiveInfo: true },
  { value: "timeline",   label: "Timeline",      hasArchiveInfo: false },
  { value: "campaigns",  label: "Campaigns",     hasArchiveInfo: false },
  { value: "armaments",  label: "Armaments",     hasArchiveInfo: false },
  { value: "personnel",  label: "Personnel",     hasArchiveInfo: false },
  { value: "letters",    label: "Letters",       hasArchiveInfo: false },
  { value: "formations", label: "Formations",    hasArchiveInfo: false },
  { value: "nsdap",      label: "NSDAP",         hasArchiveInfo: false },
  { value: "articles",       label: "Articles",             hasArchiveInfo: false },
  { value: "policies",       label: "Site Policies",        hasArchiveInfo: false },
  { value: "search",         label: "Search",               hasArchiveInfo: false },
  { value: "awards",         label: "Awards & Decorations", hasArchiveInfo: false },
  { value: "maps",           label: "Historical Maps",      hasArchiveInfo: false },
  { value: "political-docs", label: "Political Documents",  hasArchiveInfo: false },
];

function f(id) { return document.getElementById(id); }

function init() {
  document.getElementById("admin-tabs")?.addEventListener("click", (e) => {
    if (e.target.closest('[data-tab="tab-page-content"]')) loadPageContent();
  });

  f("pce-page-select")?.addEventListener("change", () => {
    const key = f("pce-page-select")?.value;
    if (!key || !fullData) return;
    populateForm(key, fullData[key] ?? {});
  });

  f("pce-save-btn")?.addEventListener("click", handleSave);
}

async function loadPageContent() {
  setStatus("Loading…", false);
  try {
    const res = await fetch(`/api/site-content?key=${encodeURIComponent(KEY)}`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    fullData = await safeJson(res);
    setStatus("", false);
    translationsPanel.load(KEY);
    // Auto-select first page if nothing is selected yet
    const sel = f("pce-page-select");
    if (sel && !sel.value) {
      sel.value = PAGES[0].value;
      populateForm(PAGES[0].value, fullData[PAGES[0].value] ?? {});
    } else if (sel?.value) {
      populateForm(sel.value, fullData[sel.value] ?? {});
    }
  } catch (err) {
    setStatus(`Failed to load: ${err.message}`, true);
  }
}

function populateForm(pageKey, page) {
  const meta = page.meta ?? {};
  const hero = page.hero ?? {};
  const info = page.archiveInfo ?? {};

  if (f("pce-meta-title"))    f("pce-meta-title").value    = meta.title       ?? "";
  if (f("pce-meta-desc"))     f("pce-meta-desc").value     = meta.description ?? "";
  if (f("pce-hero-title"))    f("pce-hero-title").value    = hero.title       ?? "";
  if (f("pce-hero-subtitle")) f("pce-hero-subtitle").value = hero.subtitle    ?? "";

  const hasInfo = PAGES.find((p) => p.value === pageKey)?.hasArchiveInfo ?? false;
  const infoSection = f("pce-archiveinfo-section");
  if (infoSection) infoSection.hidden = !hasInfo;

  if (hasInfo) {
    if (f("pce-info-project"))     f("pce-info-project").value     = info.project     ?? "";
    if (f("pce-info-period"))      f("pce-info-period").value      = info.period      ?? "";
    if (f("pce-info-type"))        f("pce-info-type").value        = info.type        ?? "";
    if (f("pce-info-license"))     f("pce-info-license").value     = info.license     ?? "";
    if (f("pce-info-lastUpdated")) f("pce-info-lastUpdated").value = info.lastUpdated ?? "";
  }
}

async function handleSave() {
  const pageKey = f("pce-page-select")?.value;
  if (!pageKey) { setStatus("Select a page first.", true); return; }
  if (!fullData) { setStatus("Load content first.", true); return; }

  const entry = fullData[pageKey] ?? {};

  entry.meta = {
    title:       f("pce-meta-title")?.value.trim() || entry.meta?.title,
    description: f("pce-meta-desc")?.value.trim()  || entry.meta?.description,
  };

  const heroTitle    = f("pce-hero-title")?.value.trim();
  const heroSubtitle = f("pce-hero-subtitle")?.value.trim();
  if (heroTitle || heroSubtitle || entry.hero) {
    entry.hero = {
      title:    heroTitle    || entry.hero?.title    || "",
      subtitle: heroSubtitle || entry.hero?.subtitle || "",
    };
  }

  const hasInfo = PAGES.find((p) => p.value === pageKey)?.hasArchiveInfo ?? false;
  if (hasInfo) {
    entry.archiveInfo = {
      project:     f("pce-info-project")?.value.trim()     || entry.archiveInfo?.project,
      period:      f("pce-info-period")?.value.trim()      || entry.archiveInfo?.period,
      type:        f("pce-info-type")?.value.trim()        || entry.archiveInfo?.type,
      license:     f("pce-info-license")?.value.trim()     || entry.archiveInfo?.license,
      lastUpdated: f("pce-info-lastUpdated")?.value.trim() || entry.archiveInfo?.lastUpdated,
    };
  }

  fullData[pageKey] = entry;

  setStatus("Saving…", false);
  try {
    const res = await fetch(`/api/site-content?key=${encodeURIComponent(KEY)}`, {
      method: "PUT",
      headers: { ...authHeader(), "Content-Type": "application/json" },
      body: JSON.stringify(fullData),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    setStatus("Saved.", false);
  } catch (err) {
    setStatus(`Save failed: ${err.message}`, true);
  }
}

init();
