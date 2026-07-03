import { authHeader, escHtml, makeStatusFn, safeJson } from "./admin-utils.js";
import { TranslationsPanel } from "./translations-panel.js";
import { openIconPicker, iconIdFromPath, iconPath } from "./admin-icon-picker.js";

/**
 * VeteransLedger · Admin — Homepage Editor
 * Reads/writes /public/data/homepage.json via the site-content API.
 * Hero/meta fields stay a simple form; archive cards are a managed
 * collection (add / edit / duplicate / reorder / enable-disable / delete)
 * so the editor stays usable however many cards exist.
 */

const KEY = "homepage.json";
const setStatus = makeStatusFn("homepage-form-status");
const translationsPanel = new TranslationsPanel("homepage-translations-panel", "site_content");
let fullData = null;
let cardsDraft = []; // working copy of archiveCards while editing

const ICON_CLOSE =
  '<svg class="icon-inline" width="10" height="10" viewBox="0 0 24 24" aria-hidden="true" xmlns="http://www.w3.org/2000/svg"><path fill="currentColor" fill-rule="evenodd" clip-rule="evenodd" d="M5.29289 5.29289C5.68342 4.90237 6.31658 4.90237 6.70711 5.29289L12 10.5858L17.2929 5.29289C17.6834 4.90237 18.3166 4.90237 18.7071 5.29289C19.0976 5.68342 19.0976 6.31658 18.7071 6.70711L13.4142 12L18.7071 17.2929C19.0976 17.6834 19.0976 18.3166 18.7071 18.7071C18.3166 19.0976 17.6834 19.0976 17.2929 18.7071L12 13.4142L6.70711 18.7071C6.31658 19.0976 5.68342 19.0976 5.29289 18.7071C4.90237 18.3166 4.90237 17.6834 5.29289 17.2929L10.5858 12L5.29289 6.70711C4.90237 6.31658 4.90237 5.68342 5.29289 5.29289Z"/></svg>';

function init() {
  document.getElementById("admin-tabs")?.addEventListener("click", (e) => {
    if (e.target.closest('[data-tab="tab-homepage"]')) loadHomepage();
  });
  document.getElementById("homepage-save-btn")?.addEventListener("click", handleSave);
  document.getElementById("hp-card-add-btn")?.addEventListener("click", () => {
    syncDraftFromDom();
    cardsDraft.push({ title: "", desc: "", href: "", icon: "", enabled: true });
    renderCards();
  });
}

async function loadHomepage() {
  setStatus("Loading…", false);
  try {
    const res = await fetch(`/api/site-content?key=${encodeURIComponent(KEY)}`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    fullData = await safeJson(res);
    populateForm(fullData);
    setStatus("", false);
    translationsPanel.load(KEY);
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

  cardsDraft = (data.archiveCards || []).map((c) => ({ ...c, enabled: c.enabled !== false }));
  renderCards();
}

// ── Card collection ───────────────────────────────────────────────────────────

function renderCards() {
  const list = f("hp-cards-list");
  if (!list) return;

  if (!cardsDraft.length) {
    list.innerHTML = `<p class="text-dim">No cards yet — use "Add Card" below.</p>`;
    return;
  }

  list.innerHTML = cardsDraft.map((card, i) => {
    const iconId = iconIdFromPath(card.icon) || "";
    return `
    <div class="admin-card hp-card" data-ci="${i}" style="${card.enabled ? "" : "opacity:.55;"}">
      <div style="display:flex;align-items:center;gap:var(--space-2);margin-bottom:var(--space-3);">
        <span class="badge">Card ${i + 1}</span>
        <span style="flex:1;"></span>
        <label style="display:flex;align-items:center;gap:6px;font-size:var(--text-xs);color:var(--text-secondary);cursor:pointer;">
          <input type="checkbox" data-field="enabled" ${card.enabled ? "checked" : ""}> Enabled
        </label>
        <button type="button" class="btn btn-secondary btn--xs" data-move="-1" ${i === 0 ? "disabled" : ""} title="Move up" aria-label="Move card ${i + 1} up">↑</button>
        <button type="button" class="btn btn-secondary btn--xs" data-move="1" ${i === cardsDraft.length - 1 ? "disabled" : ""} title="Move down" aria-label="Move card ${i + 1} down">↓</button>
        <button type="button" class="btn btn-secondary btn--xs" data-duplicate title="Duplicate card">Duplicate</button>
        <button type="button" class="btn btn-secondary btn--xs btn--danger" data-delete title="Delete card">${ICON_CLOSE}</button>
      </div>
      <div class="form-grid-3 mb-2">
        <div class="contact-form__group"><label class="contact-form__label">Title</label><input class="contact-form__input" data-field="title" value="${escHtml(card.title || "")}"></div>
        <div class="contact-form__group"><label class="contact-form__label">Description</label><input class="contact-form__input" data-field="desc" value="${escHtml(card.desc || "")}"></div>
        <div class="contact-form__group"><label class="contact-form__label">Link</label><input class="contact-form__input" data-field="href" value="${escHtml(card.href || "")}" placeholder="/section"></div>
      </div>
      <div class="contact-form__group" style="margin-bottom:0;">
        <label class="contact-form__label">Icon</label>
        <div class="icon-field">
          ${card.icon ? `<img class="icon-field__preview" src="${escHtml(card.icon)}" alt="">` : ""}
          <span class="icon-field__id">${iconId ? escHtml(iconId) : '<span class="text-dim">none</span>'}</span>
          <button type="button" class="btn btn-secondary btn--xs" data-pick-icon>Choose Icon</button>
          ${card.icon ? `<button type="button" class="btn btn-secondary btn--xs" data-clear-icon>Clear</button>` : ""}
        </div>
      </div>
    </div>`;
  }).join("");

  list.querySelectorAll(".hp-card").forEach((row) => {
    const i = +row.dataset.ci;
    row.querySelectorAll("[data-move]").forEach((btn) =>
      btn.addEventListener("click", () => moveCard(i, +btn.dataset.move)));
    row.querySelector("[data-duplicate]")?.addEventListener("click", () => {
      syncDraftFromDom();
      cardsDraft.splice(i + 1, 0, { ...cardsDraft[i] });
      renderCards();
    });
    row.querySelector("[data-delete]")?.addEventListener("click", () => {
      syncDraftFromDom();
      cardsDraft.splice(i, 1);
      renderCards();
    });
    row.querySelector("[data-pick-icon]")?.addEventListener("click", () => {
      syncDraftFromDom();
      openIconPicker({
        current: iconIdFromPath(cardsDraft[i].icon) || undefined,
        onSelect: (id) => { cardsDraft[i].icon = iconPath(id); renderCards(); },
      });
    });
    row.querySelector("[data-clear-icon]")?.addEventListener("click", () => {
      syncDraftFromDom();
      cardsDraft[i].icon = "";
      renderCards();
    });
    row.querySelector('[data-field="enabled"]')?.addEventListener("change", (e) => {
      syncDraftFromDom();
      cardsDraft[i].enabled = e.target.checked;
      renderCards();
    });
  });
}

function moveCard(i, dir) {
  syncDraftFromDom();
  const j = i + dir;
  if (j < 0 || j >= cardsDraft.length) return;
  [cardsDraft[i], cardsDraft[j]] = [cardsDraft[j], cardsDraft[i]];
  renderCards();
}

// Pull current input values into the draft before any structural operation
// (move/duplicate/delete/re-render) so in-progress edits are never lost.
function syncDraftFromDom() {
  document.querySelectorAll("#hp-cards-list .hp-card").forEach((row) => {
    const i = +row.dataset.ci;
    if (!cardsDraft[i]) return;
    cardsDraft[i].title = row.querySelector('[data-field="title"]')?.value.trim() ?? cardsDraft[i].title;
    cardsDraft[i].desc  = row.querySelector('[data-field="desc"]')?.value.trim()  ?? cardsDraft[i].desc;
    cardsDraft[i].href  = row.querySelector('[data-field="href"]')?.value.trim()  ?? cardsDraft[i].href;
    cardsDraft[i].enabled = row.querySelector('[data-field="enabled"]')?.checked ?? cardsDraft[i].enabled;
  });
}

// ── Save ──────────────────────────────────────────────────────────────────────

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

  syncDraftFromDom();
  fullData.archiveCards = cardsDraft
    .filter((c) => c.title || c.href) // drop fully empty rows
    .map((c) => ({ ...c, enabled: c.enabled !== false }));

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
