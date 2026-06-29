import { authHeader, makeStatusFn } from "./admin-utils.js";

/**
 * VeteransLedger · Admin — Homepage Editor
 * Reads/writes /public/data/homepage.json via the site-content API.
 * Structured form: hero section + browse label + per-card title/desc.
 */

const KEY = "homepage.json";
const setStatus = makeStatusFn("homepage-form-status");
let fullData = null;

function init() {
  document.getElementById("admin-tabs")?.addEventListener("click", (e) => {
    if (e.target.closest('[data-tab="tab-homepage"]')) loadHomepage();
  });
  document.getElementById("homepage-save-btn")?.addEventListener("click", handleSave);
}

async function loadHomepage() {
  setStatus("Loading…", false);
  try {
    const res = await fetch(`/api/site-content?key=${encodeURIComponent(KEY)}`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    fullData = await res.json();
    populateForm(fullData);
    setStatus("", false);
  } catch (err) {
    setStatus(`Failed to load: ${err.message}`, true);
  }
}

function f(id) { return document.getElementById(id); }

function populateForm(data) {
  const hero = data.hero || {};

  if (f("hp-hero-eyebrow"))      f("hp-hero-eyebrow").value      = hero.eyebrow      || "";
  if (f("hp-hero-title"))        f("hp-hero-title").value        = hero.title        || "";
  if (f("hp-hero-subtitle"))     f("hp-hero-subtitle").value     = hero.subtitle     || "";
  if (f("hp-hero-description"))  f("hp-hero-description").value  = hero.description  || "";
  if (f("hp-hero-cta-primary"))  f("hp-hero-cta-primary").value  = hero.primaryCta?.label  || "";
  if (f("hp-hero-cta-href"))     f("hp-hero-cta-href").value     = hero.primaryCta?.href   || "";
  if (f("hp-hero-cta-secondary")) f("hp-hero-cta-secondary").value = hero.secondaryCta?.label || "";
  if (f("hp-browse-label"))      f("hp-browse-label").value      = data.browseSectionLabel || "";

  (data.archiveCards || []).forEach((card, i) => {
    const titleEl = f(`hp-card-title-${i}`);
    const descEl  = f(`hp-card-desc-${i}`);
    const hrefEl  = f(`hp-card-href-${i}`);
    if (titleEl) titleEl.value = card.title || "";
    if (descEl)  descEl.value  = card.desc  || "";
    if (hrefEl)  hrefEl.value  = card.href  || "";
  });
}

async function handleSave() {
  if (!fullData) { setStatus("Load homepage first.", true); return; }

  const hero = fullData.hero || {};
  hero.eyebrow     = f("hp-hero-eyebrow")?.value.trim()  || hero.eyebrow;
  hero.title       = f("hp-hero-title")?.value.trim()    || hero.title;
  hero.subtitle    = f("hp-hero-subtitle")?.value.trim() || hero.subtitle;
  hero.description = f("hp-hero-description")?.value.trim() || hero.description;

  const primaryLabel = f("hp-hero-cta-primary")?.value.trim();
  const primaryHref  = f("hp-hero-cta-href")?.value.trim();
  if (primaryLabel || primaryHref) {
    hero.primaryCta = { label: primaryLabel || hero.primaryCta?.label, href: primaryHref || hero.primaryCta?.href };
  }
  const secLabel = f("hp-hero-cta-secondary")?.value.trim();
  if (secLabel) hero.secondaryCta = { ...(hero.secondaryCta || {}), label: secLabel };

  fullData.hero = hero;
  fullData.browseSectionLabel = f("hp-browse-label")?.value.trim() || fullData.browseSectionLabel;

  const cards = fullData.archiveCards || [];
  cards.forEach((card, i) => {
    card.title = f(`hp-card-title-${i}`)?.value.trim() || card.title;
    card.desc  = f(`hp-card-desc-${i}`)?.value.trim()  || card.desc;
    card.href  = f(`hp-card-href-${i}`)?.value.trim()  || card.href;
  });

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
