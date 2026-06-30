import { authHeader, makeStatusFn, safeJson } from "./admin-utils.js";
import { TranslationsPanel } from "./translations-panel.js";

/**
 * VeteransLedger · Admin — Navigation & Footer Editor
 * Reads/writes public/data/navigation.json via the site-content API.
 * Exposes structured fields for brand, all footer sections, social links,
 * and a raw JSON editor for the navigation items tree.
 */

const KEY = "navigation.json";
const setStatus = makeStatusFn("nav-form-status");
const translationsPanel = new TranslationsPanel("navigation-translations-panel", "site_content");
let fullData = null;

function f(id) { return document.getElementById(id); }

function init() {
  document.getElementById("admin-tabs")?.addEventListener("click", (e) => {
    if (e.target.closest('[data-tab="tab-navigation"]')) loadNav();
  });
  f("nav-save-btn")?.addEventListener("click", handleSave);
}

async function loadNav() {
  setStatus("Loading…", false);
  try {
    const res = await fetch(`/api/site-content?key=${encodeURIComponent(KEY)}`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    fullData = await safeJson(res);
    populateForm(fullData);
    setStatus("", false);
    translationsPanel.load(KEY);
  } catch (err) {
    setStatus(`Failed to load navigation: ${err.message}`, true);
  }
}

function populateForm(data) {
  const brand  = data.brand  ?? {};
  const footer = data.footer ?? {};
  const info   = footer.archiveInfo ?? {};
  const connect = footer.connect ?? {};

  // Brand
  if (f("nav-brand-name"))    f("nav-brand-name").value    = brand.name    ?? "";
  if (f("nav-brand-tagline")) f("nav-brand-tagline").value = brand.tagline ?? "";

  // Footer — top band
  if (f("nav-footer-about"))        f("nav-footer-about").value        = footer.aboutText      ?? "";
  if (f("nav-footer-signature"))    f("nav-footer-signature").value    = footer.signature      ?? "";
  if (f("nav-footer-badge"))        f("nav-footer-badge").value        = footer.educationalBadge ?? "";
  if (f("nav-footer-stats-heading")) f("nav-footer-stats-heading").value = footer.statsHeading  ?? "";
  if (f("nav-footer-stats-json"))   f("nav-footer-stats-json").value   = JSON.stringify(footer.stats ?? [], null, 2);

  // Footer — bottom band
  if (f("nav-footer-quicklinks"))     f("nav-footer-quicklinks").value     = footer.quickLinksHeading ?? "";
  if (f("nav-footer-info-heading"))   f("nav-footer-info-heading").value   = info.heading             ?? "";
  if (f("nav-footer-info-items"))     f("nav-footer-info-items").value     = JSON.stringify(info.items ?? [], null, 2);
  if (f("nav-footer-legal-links"))    f("nav-footer-legal-links").value    = JSON.stringify(footer.legalLinks ?? [], null, 2);
  if (f("nav-footer-legal-heading"))  f("nav-footer-legal-heading").value  = footer.legalHeading      ?? "";
  if (f("nav-footer-connect-heading")) f("nav-footer-connect-heading").value = connect.heading        ?? "";
  if (f("nav-footer-connect-prompt")) f("nav-footer-connect-prompt").value = connect.prompt           ?? "";
  if (f("nav-footer-connect-email"))  f("nav-footer-connect-email").value  = connect.email            ?? "";

  // Footer — legal strip
  if (f("nav-footer-legal-line")) f("nav-footer-legal-line").value = footer.legalLine  ?? "";
  if (f("nav-footer-copyright"))  f("nav-footer-copyright").value  = footer.copyright  ?? "";

  // Social links JSON
  if (f("nav-social-json")) f("nav-social-json").value = JSON.stringify(footer.social ?? [], null, 2);

  // Navigation items tree (primary + utility combined for editing)
  if (f("nav-items-json")) {
    const items = "primary" in data ? data.primary : (data.items ?? data.sections ?? []);
    f("nav-items-json").value = JSON.stringify(items, null, 2);
  }
}

function parseJsonField(id, fallback = []) {
  const el = f(id);
  if (!el || !el.value.trim()) return fallback;
  try { return JSON.parse(el.value); } catch (_) { return null; }
}

async function handleSave() {
  if (!fullData) { setStatus("Load navigation first.", true); return; }

  // Validate JSON fields before touching fullData
  const stats      = parseJsonField("nav-footer-stats-json");
  const infoItems  = parseJsonField("nav-footer-info-items");
  const legalLinks = parseJsonField("nav-footer-legal-links");
  const social     = parseJsonField("nav-social-json");
  const navItems   = parseJsonField("nav-items-json");

  if (stats === null || infoItems === null || legalLinks === null || social === null || navItems === null) {
    setStatus("Invalid JSON in one of the array fields — fix syntax before saving.", true);
    return;
  }

  // Brand
  fullData.brand = {
    ...(fullData.brand ?? {}),
    name:    f("nav-brand-name")?.value.trim()    || fullData.brand?.name,
    tagline: f("nav-brand-tagline")?.value.trim() || undefined,
  };

  // Footer
  fullData.footer = {
    ...(fullData.footer ?? {}),
    aboutText:        f("nav-footer-about")?.value.trim()         || fullData.footer?.aboutText,
    signature:        f("nav-footer-signature")?.value.trim()     || undefined,
    educationalBadge: f("nav-footer-badge")?.value.trim()         || undefined,
    statsHeading:     f("nav-footer-stats-heading")?.value.trim() || undefined,
    stats,
    quickLinksHeading: f("nav-footer-quicklinks")?.value.trim()     || undefined,
    archiveInfo: {
      heading: f("nav-footer-info-heading")?.value.trim() || undefined,
      items:   infoItems,
    },
    legalHeading: f("nav-footer-legal-heading")?.value.trim()  || undefined,
    legalLinks,
    connect: {
      heading: f("nav-footer-connect-heading")?.value.trim() || undefined,
      prompt:  f("nav-footer-connect-prompt")?.value.trim()  || undefined,
      email:   f("nav-footer-connect-email")?.value.trim()   || undefined,
    },
    legalLine:  f("nav-footer-legal-line")?.value.trim() || undefined,
    copyright:  f("nav-footer-copyright")?.value.trim()  || undefined,
    social,
    columns: fullData.footer?.columns ?? [],
  };

  // Navigation items
  if ("primary" in fullData) fullData.primary = navItems;
  else if ("items" in fullData) fullData.items = navItems;
  else fullData.sections = navItems;

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
