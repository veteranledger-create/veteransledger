/**
 * VeteransLedger · Page Content applier
 * Loads /public/data/page-content.json and patches the current page's
 * hero title, hero subtitle, meta title, and meta description.
 * Runs automatically as a side-effect import from layout.js.
 *
 * URL segment → JSON key mapping lets every page be controlled from Admin
 * without adding per-page script tags or data attributes.
 */

const PAGE_MAP = {
  "":             "home",      // homepage handled separately by home.js
  "about":        "about",
  "timeline":     "timeline",
  "campaigns":    "campaigns",
  "armaments":    "armaments",
  "personnel":    "personnel",
  "letters":      "letters",
  "formations":   "formations",
  "nsdap":        "nsdap",
  "articles":     "articles",
  "site-policies":"policies",
  "policies":     "policies",
  "search":       "search",
  "awards":            "awards",
  "maps":              "maps",
  "political-documents":"political-docs",
};

async function applyPageContent() {
  const segment = window.location.pathname.split("/").filter(Boolean)[0] ?? "";
  const pageKey = PAGE_MAP[segment];
  if (!pageKey || pageKey === "home") return;

  let data;
  try {
    const res = await fetch("/public/data/page-content.json");
    if (res.ok) data = await res.json();
  } catch (_) {}

  const page = data?.[pageKey];
  if (!page) return;

  // ── Meta ──────────────────────────────────────────────────────────────────
  if (page.meta?.title) document.title = page.meta.title;
  if (page.meta?.description) {
    const el = document.querySelector('meta[name="description"]');
    if (el) el.setAttribute("content", page.meta.description);
  }

  // ── Hero ──────────────────────────────────────────────────────────────────
  if (page.hero?.title) {
    const el = document.querySelector(".page-hero__title");
    if (el) el.textContent = page.hero.title;
  }
  if (page.hero?.subtitle) {
    const el = document.querySelector(".page-hero__subtitle");
    if (el) el.textContent = page.hero.subtitle;
  }

  // ── Per-page keyed values (e.g. archive-info sidebar on About) ────────────
  document.querySelectorAll("[data-pc-info]").forEach((el) => {
    const key = el.dataset.pcInfo;
    if (page.archiveInfo?.[key] != null) el.textContent = page.archiveInfo[key];
  });

  // ── Section labels (e.g. "Mission", "Sources & Methodology" on About) ────
  document.querySelectorAll("[data-pc-section]").forEach((el) => {
    const key = el.dataset.pcSection;
    if (page.sectionLabels?.[key] != null) el.textContent = page.sectionLabels[key];
  });
}

applyPageContent();
