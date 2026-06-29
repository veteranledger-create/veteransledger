/**
 * VeteransLedger · Home page
 * Loads /public/data/homepage.json and applies editable content to the
 * data-home / data-home-card-* hooks added to index.html.
 * Falls back gracefully to the hardcoded HTML values when the file is
 * missing, so the page works even before a first publish.
 */

async function init() {
  let data;
  try {
    const res = await fetch("/public/data/homepage.json");
    if (res.ok) data = await res.json();
  } catch (_) {}

  if (!data) return; // keep hardcoded HTML as-is

  // Update document meta from homepage.json so the Admin can control title/description
  if (data.meta?.title) document.title = data.meta.title;
  if (data.meta?.description) {
    const metaEl = document.querySelector('meta[name="description"]');
    if (metaEl) metaEl.setAttribute("content", data.meta.description);
  }

  const hero = data.hero || {};

  // ── Hero text ────────────────────────────────────────────────────────────
  setText("[data-home='hero-eyebrow']",   hero.eyebrow);
  setText("[data-home='hero-subtitle']",  hero.subtitle);
  setText("[data-home='hero-description']", hero.description);

  // Title may contain a <br> — use innerHTML only for this one
  if (hero.title) {
    const el = document.querySelector("[data-home='hero-title']");
    if (el) el.innerHTML = hero.title;
  }

  // Primary CTA
  if (hero.primaryCta) {
    const el = document.querySelector("[data-home='hero-primary-cta']");
    if (el) {
      if (hero.primaryCta.label) el.textContent = hero.primaryCta.label;
      if (hero.primaryCta.href)  el.setAttribute("href", hero.primaryCta.href);
    }
  }

  // Secondary CTA (button — label only; action stays as-is)
  if (hero.secondaryCta?.label) {
    setText("[data-home='hero-secondary-cta']", hero.secondaryCta.label);
  }

  // ── Browse section ───────────────────────────────────────────────────────
  if (data.browseSectionLabel) {
    setText("[data-home='browse-label']", data.browseSectionLabel);
  }

  // ── Archive cards ────────────────────────────────────────────────────────
  (data.archiveCards || []).forEach((card, i) => {
    const anchor = document.querySelector(`[data-home-card="${i}"]`);
    if (anchor && card.href) anchor.setAttribute("href", card.href);

    const icon = document.querySelector(`[data-home-card-icon="${i}"]`);
    if (icon && card.icon) icon.setAttribute("src", card.icon);

    setText(`[data-home-card-title="${i}"]`, card.title);
    setText(`[data-home-card-desc="${i}"]`,  card.desc);
  });
}

function setText(selector, value) {
  if (!value) return;
  const el = document.querySelector(selector);
  if (el) el.textContent = value;
}

init();
