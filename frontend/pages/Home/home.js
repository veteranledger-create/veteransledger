/**
 * VeteransLedger · Home page
 * Loads /public/data/homepage.json and applies editable content to the
 * data-home / data-home-card-* hooks added to index.html.
 * Falls back gracefully to the hardcoded HTML values when the file is
 * missing, so the page works even before a first publish.
 */

import { loadTranslation } from "/pages/shared/translation-loader.js";
import { onLocaleChange } from "/pages/shared/i18n.js";

async function init() {
  let data;
  try {
    const res = await fetch("/public/data/homepage.json");
    if (res.ok) data = await res.json();
  } catch (_) {}

  if (!data) return; // keep hardcoded HTML as-is

  // site_content translations store the whole source file as one
  // re-translated JSON string — swap it in before populating the DOM.
  const t = await loadTranslation("site_content", "homepage.json");
  if (t?.fields?.content) {
    try { data = JSON.parse(t.fields.content); }
    catch { /* translated content isn't valid JSON — keep English */ }
  }

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

  // Primary CTA — label is CMS-editable text; the trailing arrow is a real
  // SVG icon appended after it, not part of the editable string, so a
  // legacy label still ending in "→" doesn't produce a doubled-up arrow.
  if (hero.primaryCta) {
    const el = document.querySelector("[data-home='hero-primary-cta']");
    if (el) {
      if (hero.primaryCta.label) {
        const label = hero.primaryCta.label.replace(/\s*(→|»|›)\s*$/, "");
        el.textContent = label + " ";
        el.insertAdjacentHTML("beforeend", '<span class="icon-svg icon-svg--arrow-right icon-svg--md" aria-hidden="true"></span>');
      }
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
  // Rendered dynamically so the Admin card manager can add/remove/reorder/
  // disable cards freely — the static HTML cards remain only as the
  // no-data fallback. Disabled cards stay in the JSON but are not shown.
  const grid = document.getElementById("browse-grid");
  const cards = (data.archiveCards || []).filter((c) => c.enabled !== false);
  if (grid && cards.length) {
    grid.innerHTML = cards.map((card) => `
        <a href="${escAttr(card.href || "#")}" class="archive-card">
          <div class="archive-card__icon" aria-hidden="true">
            ${card.icon ? `<img src="${escAttr(card.icon)}" alt="">` : ""}
          </div>
          <h2 class="archive-card__title">${escText(card.title || "")}</h2>
          <p class="archive-card__desc">${escText(card.desc || "")}</p>
          <span class="icon-svg icon-svg--arrow-right icon-svg--lg archive-card__arrow" aria-hidden="true"></span>
        </a>`).join("");
  }
}

onLocaleChange(() => init());

function setText(selector, value) {
  if (!value) return;
  const el = document.querySelector(selector);
  if (el) el.textContent = value;
}

function escText(str) {
  return String(str).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
function escAttr(str) {
  return escText(str).replace(/"/g, "&quot;");
}

init();
