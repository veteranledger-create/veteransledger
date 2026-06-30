/**
 * VeteransLedger · Admin — Translations Panel
 * Self-contained component that renders a language card grid for any
 * editable record. Import and instantiate once per admin module.
 *
 * Usage:
 *   const tl = new TranslationsPanel("my-translations-panel", "record");
 *   tl.load(savedId);   // call after save or openForm(existingId)
 *   tl.clear();         // call for new (unsaved) records
 */

import { authHeader, escHtml, safeJson } from "./admin-utils.js";
import { LANGUAGES, FLAG_SVGS } from "../shared/locale-constants.js";

// ── Status display config ─────────────────────────────────────────────────────

const ICON_CHECK =
  '<svg class="icon-inline" width="10" height="10" viewBox="0 0 640 640" aria-hidden="true" xmlns="http://www.w3.org/2000/svg"><path fill="currentColor" d="M297.4 438.6C309.9 451.1 330.2 451.1 342.7 438.6L502.7 278.6C515.2 266.1 515.2 245.8 502.7 233.3C490.2 220.8 469.9 220.8 457.4 233.3L320 370.7L182.6 233.4C170.1 220.9 149.8 220.9 137.3 233.4C124.8 245.9 124.8 266.2 137.3 278.7L297.3 438.7z"/></svg>';
const ICON_GEAR =
  '<svg class="icon-inline" width="10" height="10" viewBox="0 0 92 92" aria-hidden="true" xmlns="http://www.w3.org/2000/svg"><path fill="currentColor" d="M46,65.3c-10.6,0-19.3-8.6-19.3-19.3c0-10.6,8.6-19.3,19.3-19.3c10.6,0,19.3,8.6,19.3,19.3 C65.3,56.6,56.6,65.3,46,65.3z M46,33.8c-6.7,0-12.2,5.5-12.2,12.2c0,6.7,5.5,12.2,12.2,12.2c6.7,0,12.2-5.5,12.2-12.2 C58.2,39.3,52.7,33.8,46,33.8z M46,92h-0.5c-3.5,0-6.5-0.4-6.7-0.4c-1.6-0.2-2.8-1.4-3.1-3l-1-7.2c-2.2-0.7-4.3-1.6-6.3-2.7L22.8,83 c-1.3,1-3,0.9-4.3,0c-0.1-0.1-2.5-2-5-4.4l-0.4-0.4c-2.5-2.5-4.3-4.9-4.4-5c-1-1.3-1-3,0-4.3l4.4-5.8c-1.1-2-1.9-4.2-2.6-6.4l-7-1 c-1.6-0.2-2.8-1.5-3-3.1C0.4,52.5,0,49.5,0,46v-0.5c0-3.5,0.4-6.5,0.4-6.7c0.2-1.6,1.4-2.8,3-3.1l7.2-1c0.7-2.2,1.6-4.3,2.7-6.3 L9,22.8c-1-1.3-0.9-3,0-4.3c0.1-0.1,2-2.5,4.4-5l0.4-0.4c2.5-2.5,4.9-4.3,5-4.4c1.3-1,3-1,4.3,0l5.8,4.4c2-1.1,4.2-1.9,6.4-2.6l1-7 c0.2-1.6,1.5-2.8,3.1-3C39.5,0.4,42.5,0,46,0h0.5c3.5,0,6.5,0.4,6.7,0.4c1.6,0.2,2.8,1.4,3.1,3l1,7.2c2.2,0.7,4.3,1.6,6.3,2.7 L69.2,9c1.3-1,3-0.9,4.3,0c0.1,0.1,2.5,2,5,4.4l0.4,0.4c2.5,2.5,4.3,4.9,4.4,5c1,1.3,1,3,0,4.3L79,28.9c1.1,2,1.9,4.2,2.6,6.4l7,1 c1.6,0.2,2.8,1.5,3,3.1c0,0.1,0.4,3.2,0.4,6.7v0.5c0,3.5-0.4,6.5-0.4,6.7c-0.2,1.6-1.4,2.8-3,3.1l-7.2,1c-0.7,2.2-1.6,4.3-2.7,6.3 l4.3,5.7c1,1.3,0.9,3,0,4.3c-0.1,0.1-2,2.5-4.4,5l-0.4,0.4c-2.5,2.5-4.9,4.3-5,4.4c-1.3,1-3,1-4.3,0L63.1,79c-2,1.1-4.2,1.9-6.4,2.6 l-1,7c-0.2,1.6-1.5,2.8-3.1,3C52.5,91.6,49.5,92,46,92z M42.4,84.8c0.9,0.1,2,0.1,3.1,0.1H46c1.1,0,2.2,0,3.1-0.1l0.9-6.6 c0.2-1.5,1.3-2.6,2.7-3c3.1-0.7,6.1-1.9,8.8-3.6c0.8-0.5,1.8-0.6,2.7-0.4c0.5,0.1,1,0.4,1.4,0.7l5.3,4c0.7-0.6,1.5-1.3,2.3-2.1 l0.4-0.4c0.8-0.8,1.5-1.6,2.1-2.3l-4-5.3c-0.9-1.2-0.9-2.8-0.2-4c1.7-2.6,2.9-5.5,3.6-8.5c0.3-1.5,1.5-2.7,3-2.9l6.7-0.9 c0.1-0.9,0.1-2,0.1-3.1V46c0-1.1,0-2.2-0.1-3.1L78.2,42c-1.4-0.2-2.6-1.3-3-2.7c-0.7-3.1-1.9-6-3.5-8.7c-0.2-0.2-0.3-0.5-0.4-0.8 c-0.4-1.1-0.2-2.4,0.5-3.3l4.1-5.4c-0.6-0.7-1.3-1.5-2.1-2.3l-0.4-0.4c-0.8-0.8-1.6-1.5-2.3-2.1l-5.3,4c-1.3,0.9-3,0.9-4.2,0 c-2.6-1.6-5.5-2.8-8.5-3.6c-1.4-0.3-2.5-1.5-2.7-3l-0.9-6.7c-0.9-0.1-2-0.1-3.1-0.1H46c-1.1,0-2.2,0-3.1,0.1L42,13.8 c-0.2,1.6-1.4,2.8-3,3c-3,0.7-5.9,1.9-8.5,3.5c-0.8,0.5-1.8,0.6-2.7,0.4c-0.5-0.1-1-0.4-1.4-0.7l-5.2-4c-0.7,0.6-1.5,1.3-2.3,2.1 l-0.4,0.4c-0.8,0.8-1.5,1.6-2.1,2.3l4,5.3c0.9,1.2,0.9,2.7,0.2,4c-0.1,0.1-0.1,0.2-0.2,0.3c-1.6,2.6-2.8,5.5-3.5,8.5 c-0.3,1.4-1.5,2.5-3,2.7l-6.7,0.9c-0.1,0.9-0.1,2-0.1,3.1V46c0,1.1,0,2.2,0.1,3.1l6.6,0.9c1.6,0.2,2.8,1.4,3,3c0,0,0,0.1,0,0.1 c0.7,3,1.9,5.8,3.5,8.4c0.5,0.9,0.7,2,0.3,3c-0.1,0.4-0.4,0.8-0.7,1.2L16,70.9c0.6,0.7,1.3,1.5,2.1,2.3l0.4,0.4 c0.8,0.8,1.6,1.5,2.3,2.1l5.3-4c1.3-1,3.2-0.9,4.4,0.1c2.6,1.6,5.4,2.7,8.3,3.5c1.4,0.3,2.5,1.5,2.7,3L42.4,84.8z"/></svg>';

const STATUS_CONFIG = {
  original: { label: "Original",           badge: "tl-badge--original", icon: ICON_CHECK },
  machine:  { label: "Machine Translation", badge: "tl-badge--machine",  icon: ICON_GEAR },
  human:    { label: "Human Verified",      badge: "tl-badge--human",    icon: ICON_CHECK },
  none:     { label: "Not Available",       badge: "tl-badge--none",     icon: "" },
};

// ── Field labels shown in the editor modal ────────────────────────────────────

const FIELD_LABELS = {
  title:     "Title",
  name:      "Name",
  summary:   "Summary",
  biography: "Biography",
  content:   "Content (JSON)",
};

// ── Shared editor modal state ─────────────────────────────────────────────────

let _activeModal = null; // { entityType, entityId, locale, langName, fields, currentStatus, onSaved }

function _getModal() { return document.getElementById("translation-editor-modal"); }

function _openEditorModal({ entityType, entityId, locale, langName, sourceFields, translationFields, currentStatus, rtl, onSaved }) {
  _activeModal = { entityType, entityId, locale, onSaved };

  const modal = _getModal();
  if (!modal) return;

  document.getElementById("tl-modal-title").textContent = `Translate to ${langName}`;

  const fieldKeys = Object.keys(sourceFields);
  const isContent = fieldKeys.length === 1 && fieldKeys[0] === "content";

  const body = document.getElementById("tl-modal-body");
  body.innerHTML = `
    <div class="tl-editor-grid">
      <div class="tl-editor-col">
        <div class="tl-editor-col-head">English (source)</div>
        ${fieldKeys.map((k) => `
          <div class="tl-editor-field">
            <label class="tl-editor-label">${escHtml(FIELD_LABELS[k] || k)}</label>
            <textarea class="contact-form__input code-editor" rows="${isContent ? 14 : (k === "biography" || k === "content" ? 6 : 3)}" readonly>${escHtml(sourceFields[k] || "")}</textarea>
          </div>`).join("")}
      </div>
      <div class="tl-editor-col" ${rtl ? 'dir="rtl"' : ""}>
        <div class="tl-editor-col-head">${escHtml(langName)}</div>
        ${fieldKeys.map((k) => `
          <div class="tl-editor-field">
            <label class="tl-editor-label">${escHtml(FIELD_LABELS[k] || k)}</label>
            <textarea class="contact-form__input code-editor" id="tl-field-${k}" rows="${isContent ? 14 : (k === "biography" || k === "content" ? 6 : 3)}">${escHtml(translationFields[k] || "")}</textarea>
          </div>`).join("")}
      </div>
    </div>
    <p id="tl-modal-status" class="form-status mt-2"></p>`;

  modal.hidden = false;
}

function _collectModalFields() {
  const fields = {};
  document.querySelectorAll("[id^='tl-field-']").forEach((el) => {
    const key = el.id.replace("tl-field-", "");
    fields[key] = el.value;
  });
  return fields;
}

async function _saveModal(status) {
  if (!_activeModal) return;
  const { entityType, entityId, locale, onSaved } = _activeModal;
  const fields = _collectModalFields();
  const statusEl = document.getElementById("tl-modal-status");
  if (statusEl) { statusEl.textContent = "Saving…"; statusEl.className = "form-status mt-2"; }
  try {
    const res = await fetch(`/api/translations/${entityType}/${entityId}/${locale}`, {
      method: "PUT",
      headers: { ...authHeader(), "Content-Type": "application/json" },
      body: JSON.stringify({ fields, status }),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    if (statusEl) { statusEl.textContent = "Saved."; statusEl.className = "form-status form-status--ok mt-2"; }
    setTimeout(() => { _getModal().hidden = true; onSaved?.(); }, 800);
  } catch (err) {
    if (statusEl) { statusEl.textContent = `Save failed: ${err.message}`; statusEl.className = "form-status form-status--err mt-2"; }
  }
}

// Wire up shared modal buttons once (called by first panel that initialises)
let _modalWired = false;
function _wireModal() {
  if (_modalWired) return;
  _modalWired = true;
  document.getElementById("tl-modal-close")?.addEventListener("click",        () => { _getModal().hidden = true; });
  document.getElementById("tl-modal-cancel")?.addEventListener("click",       () => { _getModal().hidden = true; });
  document.getElementById("tl-modal-save-human")?.addEventListener("click",   () => _saveModal("human"));
  document.getElementById("tl-modal-save-machine")?.addEventListener("click", () => _saveModal("machine"));
}

// ── TranslationsPanel class ───────────────────────────────────────────────────

export class TranslationsPanel {
  constructor(containerId, entityType) {
    this._containerId = containerId;
    this._entityType  = entityType;
    this._entityId    = null;
    this._sourceCache = null; // cached source fields for the editor
    _wireModal();
  }

  load(entityId) {
    this._entityId = entityId;
    this._sourceCache = null;
    this._renderSkeleton();
    this._fetchAndRender();
  }

  clear() {
    this._entityId = null;
    this._sourceCache = null;
    const el = document.getElementById(this._containerId);
    if (el) el.innerHTML = `<p class="tl-unsaved-note">Save the record first to manage translations.</p>`;
  }

  _container() { return document.getElementById(this._containerId); }

  _renderSkeleton() {
    const el = this._container();
    if (!el) return;
    el.innerHTML = `
      <div class="section-label form-sub-label mt-6">Translations</div>
      <div class="tl-grid tl-grid--loading">
        ${LANGUAGES.map(() => `<div class="tl-card tl-card--skeleton"></div>`).join("")}
      </div>`;
  }

  async _fetchAndRender() {
    const { entityType: et, _entityId: id } = this;
    if (!id) return;
    const entityType = et; // closure capture

    try {
      const [tlRes, srcRes] = await Promise.all([
        fetch(`/api/translations/${this._entityType}/${id}`, { headers: authHeader() }),
        this._fetchSourceFields(id),
      ]);
      if (!tlRes.ok) throw new Error(`HTTP ${tlRes.status}`);
      const translations = await safeJson(tlRes);
      this._sourceCache = srcRes;
      this._renderCards(translations);
    } catch (err) {
      const el = this._container();
      if (el) el.innerHTML += `<p class="tl-error">Could not load translations: ${escHtml(err.message)}</p>`;
    }
  }

  async _fetchSourceFields(entityId) {
    // Resolve source fields by fetching from the canonical primary table.
    // English content always lives in the primary tables — never in translations.
    switch (this._entityType) {
      case "record": {
        const r = await fetch(`/api/records/${entityId}`, { headers: authHeader() });
        if (!r.ok) return {};
        const d = await r.json();
        return { title: d.title || "", summary: d.summary || "", content: d.content || "" };
      }
      case "entity": {
        const r = await fetch(`/api/personnel/${entityId}`, { headers: authHeader() });
        if (!r.ok) return {};
        const d = await r.json();
        return { name: d.name || "", summary: d.summary || "", biography: d.biography || (d.metadata?.biography || "") };
      }
      case "timeline_event": {
        const r = await fetch(`/api/timeline/${entityId}`, { headers: authHeader() });
        if (!r.ok) return {};
        const d = await r.json();
        return { title: d.title || "", summary: d.summary || "" };
      }
      case "site_content":
        return { content: "" }; // provided externally for site content
      default:
        return {};
    }
  }

  _renderCards(translations) {
    const el = this._container();
    if (!el || !this._entityId) return;

    const cards = LANGUAGES.map((lang) => {
      if (lang.isSource) return this._sourceCard(lang);
      const t = translations[lang.code];
      return t ? this._existingCard(lang, t) : this._emptyCard(lang);
    }).join("");

    el.innerHTML = `
      <div class="section-label form-sub-label mt-6">Translations</div>
      <div class="tl-grid">${cards}</div>`;

    // Wire action buttons
    el.querySelectorAll("[data-tl-generate]").forEach((btn) =>
      btn.addEventListener("click", () => this._handleGenerate(btn.dataset.tlGenerate, btn.dataset.tlForce === "1"))
    );
    el.querySelectorAll("[data-tl-edit]").forEach((btn) =>
      btn.addEventListener("click", () => this._handleEdit(btn.dataset.tlEdit, translations[btn.dataset.tlEdit]))
    );
    el.querySelectorAll("[data-tl-delete]").forEach((btn) =>
      btn.addEventListener("click", () => this._handleDelete(btn.dataset.tlDelete))
    );
  }

  _sourceCard(lang) {
    const cfg = STATUS_CONFIG.original;
    return `
      <div class="tl-card tl-card--original">
        <div class="tl-card-flag">${FLAG_SVGS[lang.code] || ""}</div>
        <div class="tl-card-lang">${escHtml(lang.name)}</div>
        <div class="tl-badge ${cfg.badge}">${cfg.icon} ${cfg.label}</div>
        <div class="tl-card-note">Source language</div>
      </div>`;
  }

  _existingCard(lang, t) {
    const cfg = STATUS_CONFIG[t.status] || STATUS_CONFIG.machine;
    const isHuman = t.status === "human";
    return `
      <div class="tl-card tl-card--${t.status}">
        <div class="tl-card-flag">${FLAG_SVGS[lang.code] || ""}</div>
        <div class="tl-card-lang">${escHtml(lang.name)}</div>
        <div class="tl-badge ${cfg.badge}">${cfg.icon} ${cfg.label}</div>
        <div class="tl-actions">
          <button class="tl-btn" data-tl-edit="${lang.code}">Edit</button>
          <button class="tl-btn ${isHuman ? "tl-btn--warn" : ""}" data-tl-generate="${lang.code}" data-tl-force="1"
            title="${isHuman ? "This will overwrite a Human Verified translation" : "Regenerate machine translation"}">Regenerate</button>
          <button class="tl-btn tl-btn--danger" data-tl-delete="${lang.code}">Delete</button>
        </div>
      </div>`;
  }

  _emptyCard(lang) {
    return `
      <div class="tl-card tl-card--none">
        <div class="tl-card-flag">${FLAG_SVGS[lang.code] || ""}</div>
        <div class="tl-card-lang">${escHtml(lang.name)}</div>
        <div class="tl-badge ${STATUS_CONFIG.none.badge}">Not Available</div>
        <div class="tl-actions">
          <button class="tl-btn tl-btn--primary" data-tl-generate="${lang.code}">Generate</button>
        </div>
      </div>`;
  }

  async _handleGenerate(locale, force = false) {
    const lang = LANGUAGES.find((l) => l.code === locale);
    if (force && lang) {
      if (!confirm(`Regenerate the ${lang.name} translation? ${lang && "Human Verified" ? "This will overwrite the human-verified version." : ""}`)) return;
    }
    const btn = this._container()?.querySelector(`[data-tl-generate="${locale}"]`);
    if (btn) { btn.disabled = true; btn.textContent = "Generating…"; }

    try {
      const res = await fetch(`/api/translations/${this._entityType}/${this._entityId}/${locale}/generate`, {
        method: "POST",
        headers: { ...authHeader(), "Content-Type": "application/json" },
        body: JSON.stringify({ force }),
      });
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        throw new Error(d.error || `HTTP ${res.status}`);
      }
      this._fetchAndRender();
    } catch (err) {
      alert(`Generation failed: ${err.message}`);
      if (btn) { btn.disabled = false; btn.textContent = force ? "Regenerate" : "Generate"; }
    }
  }

  async _handleEdit(locale, existingTranslation) {
    const lang = LANGUAGES.find((l) => l.code === locale);
    if (!lang) return;

    // Use cached source fields; fall back to fetching now
    const sourceFields = this._sourceCache || await this._fetchSourceFields(this._entityId);
    const translationFields = (existingTranslation?.fields) || {};

    _openEditorModal({
      entityType:        this._entityType,
      entityId:          this._entityId,
      locale,
      langName:          lang.name,
      sourceFields:      Object.fromEntries(Object.entries(sourceFields).filter(([, v]) => v)),
      translationFields,
      currentStatus:     existingTranslation?.status || "machine",
      rtl:               lang.rtl,
      onSaved:           () => this._fetchAndRender(),
    });
  }

  async _handleDelete(locale) {
    const lang = LANGUAGES.find((l) => l.code === locale);
    if (!lang) return;
    if (!confirm(`Delete the ${lang.name} translation? This cannot be undone.`)) return;

    const btn = this._container()?.querySelector(`[data-tl-delete="${locale}"]`);
    if (btn) btn.disabled = true;

    try {
      const res = await fetch(`/api/translations/${this._entityType}/${this._entityId}/${locale}`, {
        method: "DELETE",
        headers: authHeader(),
      });
      if (!res.ok && res.status !== 404) throw new Error(`HTTP ${res.status}`);
      this._fetchAndRender();
    } catch (err) {
      alert(`Delete failed: ${err.message}`);
      if (btn) btn.disabled = false;
    }
  }
}
