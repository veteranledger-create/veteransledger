/**
 * VeteransLedger · Admin — Shared Content Module Factory
 *
 * createContentModule(config) generalizes the CRUD/list/form/preview pattern
 * every content admin tab follows, adding infrastructure none of them had
 * before: dirty-state tracking with confirm-before-discard, submit-state
 * protection (no double-submit), a pluggable validation hook, and a single
 * consistent way to wire delete confirmation and repeatable draft groups
 * (sources / related records / and type-specific lists like Formations'
 * commanders).
 *
 * Extension points (onInit/onTabActivate/onFormOpen/beforeSubmit/
 * extraDraftKeys) exist so genuinely module-specific composition — e.g.
 * Armaments wiring the *already-shared* admin-media.js/admin-media-sections.js
 * helpers, or its live duplicate-name check — can hook into the lifecycle
 * without forking it. They are not an excuse to re-implement CRUD, dirty
 * tracking, or modal/keyboard behavior inside a module; that stays here.
 *
 * Migrated so far: Formations (Phase 3 pilot), Armaments, Personnel,
 * Letters. The remaining content modules keep their own bespoke code
 * until migrated in a later batch.
 *
 * DOM id convention (matches the existing per-tab markup exactly):
 *   ${idPrefix}-list, ${idPrefix}-new-btn, ${idPrefix}-cancel-btn,
 *   ${idPrefix}-form-panel, ${idPrefix}-form, ${idPrefix}-form-title,
 *   ${idPrefix}-form-status, ${idPrefix}-preview-btn (optional),
 *   ${idPrefix}-preview-modal / -content / -modal-close (optional),
 *   ${idPrefix}-filter-${param} for each configured filter.
 */

import { authHeader, debounce, safeJson, toggleModal, makeStatusFn } from "./admin-utils.js";
import { registerDirtyGuard } from "./admin-dirty-guard.js";

export function createContentModule(config) {
  const {
    idPrefix,
    apiBase,
    tabPanelId,
    tabButtonSelector,
    pageSize = 50,
    filters = [],
    fixedListParams = {}, // query params always sent with the list request, independent of any filter UI —
                            // e.g. Awards/Maps/Political Docs all share the generic /api/records endpoint
                            // and must pin `type` on every list call, not just when a filter element has a value
    renderList,           // (container, { data, total, page, pages }) => void — builds the table + wires row actions
    emptyMessage = "Nothing here yet.",
    translationsPanel = null,
    repeatableGroups = [], // [{ key, addBtnId, render(draft, onUpdate), itemFactory()? , onAdd(draft, rerender)? }]
    extraDraftKeys = [],   // additional drafts.* keys a module manages itself (e.g. media sections) —
                            // initialized/reset alongside repeatableGroups and included in dirty-tracking,
                            // but rendered/populated entirely by the module's own hooks below.
    populateForm,          // (form, record, drafts) => void
    serializeForm,         // (form, drafts) => body object
    validate = () => [],   // (body) => string[] of error messages, empty = valid
    renderPreview,         // (rendered, issues) => html string
    afterSave = null,      // (savedRecord) => void — extra type-specific post-save work
    beforeSubmit = null,   // async (form, drafts, editingId) => void — non-blocking pre-submit side effect (e.g. live duplicate check)
    onInit = null,         // (drafts, { setStatus }) => void — extra wiring at factory-init time (e.g. media upload inputs)
    onTabActivate = null,  // () => void — extra per-tab-activation wiring (e.g. re-registering shared media callbacks)
    onFormOpen = null,     // (drafts, isNew) => void — extra per-open reset/render (e.g. media section blank state)
    snapshotExtra = null,  // () => object — extra LIVE state read fresh into every dirty-state snapshot, for editors
                            // that manage their own DOM outside named form fields (e.g. the block-based body editor,
                            // which has no `name` attributes for FormData to pick up)
  } = config;

  const id = (suffix) => document.getElementById(`${idPrefix}-${suffix}`);
  const setStatus = makeStatusFn(`${idPrefix}-form-status`);

  let currentPage = 1;
  let editingId = null;
  let isSaving = false;
  let baselineSnapshot = null;
  const drafts = {};
  repeatableGroups.forEach((g) => { drafts[g.key] = []; });
  extraDraftKeys.forEach((k) => { drafts[k] = []; });

  // ── Dirty state ──────────────────────────────────────────────
  function computeSnapshot() {
    const form = id("form");
    if (!form) return "";
    const fields = {};
    new FormData(form).forEach((v, k) => { fields[k] = v; });
    // Checkboxes absent from FormData when unchecked — capture explicitly.
    form.querySelectorAll('input[type="checkbox"][name]').forEach((cb) => { fields[cb.name] = cb.checked; });
    return JSON.stringify({ fields, drafts, extra: snapshotExtra?.() ?? null });
  }

  function isDirty() {
    const panel = id("form-panel");
    if (!panel || panel.hidden) return false;
    return computeSnapshot() !== baselineSnapshot;
  }

  function updateDirtyIndicator() {
    id("form-panel")?.classList.toggle("is-dirty", isDirty());
  }

  function markClean() {
    baselineSnapshot = computeSnapshot();
    updateDirtyIndicator();
  }

  function confirmDiscardIfDirty(message) {
    if (!isDirty()) return true;
    return confirm(message);
  }

  // ── Repeatable draft groups (sources, related, commanders, …) ──
  function renderGroup(g) { g.render(drafts[g.key], () => renderGroup(g)); updateDirtyIndicator(); }
  function renderAllGroups() { repeatableGroups.forEach(renderGroup); }

  function wireGroups() {
    repeatableGroups.forEach((g) => {
      document.getElementById(g.addBtnId)?.addEventListener("click", () => {
        // onAdd covers groups whose "Add" opens a picker (e.g. Related
        // Records → the shared related-record modal) instead of pushing an
        // instantly-editable blank row.
        if (g.onAdd) { g.onAdd(drafts[g.key], () => renderGroup(g)); return; }
        drafts[g.key].push(g.itemFactory ? g.itemFactory() : {});
        renderGroup(g);
      });
    });
  }

  // ── List / pagination / filtering ───────────────────────────────
  function buildQuery(page) {
    const params = new URLSearchParams({ page, limit: pageSize, ...fixedListParams });
    filters.forEach((f) => {
      const el = document.getElementById(`${idPrefix}-filter-${f.param}`);
      const val = el?.value?.trim();
      if (val) params.set(f.param, val);
    });
    return params;
  }

  async function loadList(page = 1) {
    currentPage = page;
    const container = id("list");
    if (!container) return;
    container.innerHTML = `<div class="loader"><span class="loader__dot"></span><span class="loader__dot"></span><span class="loader__dot"></span></div>`;
    try {
      const res = await fetch(`${apiBase}?${buildQuery(page)}`, { headers: authHeader() });
      if (!res.ok) throw new Error();
      const payload = await safeJson(res);
      if (!payload.data.length) {
        container.innerHTML = `<p class="text-dim">${emptyMessage}</p>`;
        return;
      }
      renderList(container, payload, { onEdit: openForm, onDelete: deleteRecord, onPage: loadList });
    } catch (_) {
      container.innerHTML = `<p class="text-dim">Unavailable — try again.</p>`;
    }
  }

  // ── Form lifecycle ──────────────────────────────────────────────
  function openForm(recordId) {
    const panel = id("form-panel");
    if (!panel) return;
    if (!panel.hidden && !confirmDiscardIfDirty("You have unsaved changes. Discard them and open a different record?")) return;

    editingId = recordId;
    repeatableGroups.forEach((g) => { drafts[g.key] = []; });
    extraDraftKeys.forEach((k) => { drafts[k] = []; });
    const form = id("form");
    form?.reset();
    const titleEl = id("form-title");
    if (titleEl) titleEl.textContent = recordId ? config.labels?.edit || "Edit" : config.labels?.new || "New";
    panel.hidden = false;
    renderAllGroups();
    onFormOpen?.(drafts, !recordId);
    setStatus("", false);

    if (recordId) {
      loadIntoForm(recordId);
      translationsPanel?.load(recordId);
    } else {
      translationsPanel?.clear();
      markClean();
    }
  }

  function closeForm() {
    if (!confirmDiscardIfDirty("You have unsaved changes. Close without saving?")) return;
    const panel = id("form-panel");
    if (panel) panel.hidden = true;
    editingId = null;
  }

  async function loadIntoForm(recordId) {
    try {
      const res = await fetch(`${apiBase}/${recordId}`, { headers: authHeader() });
      if (!res.ok) throw new Error();
      const record = await safeJson(res);
      const form = id("form");
      populateForm(form, record, drafts);
      renderAllGroups();
      markClean();
    } catch (_) {
      setStatus("Failed to load record.", true);
    }
  }

  // ── Submit / validate / save ────────────────────────────────────
  async function handleSubmit(e) {
    e.preventDefault();
    if (isSaving) return;
    const form = e.target;
    await beforeSubmit?.(form, drafts, editingId);
    const body = serializeForm(form, drafts);

    const errors = validate(body);
    if (errors.length) {
      setStatus(errors[0], true);
      return;
    }

    isSaving = true;
    const submitBtn = form.querySelector("[type='submit']");
    const savingLabel = "Saving…";
    const idleLabel = submitBtn?.textContent;
    if (submitBtn) { submitBtn.disabled = true; submitBtn.textContent = savingLabel; }
    setStatus(savingLabel, false);

    try {
      const res = await fetch(editingId ? `${apiBase}/${editingId}` : apiBase, {
        method: editingId ? "PUT" : "POST",
        headers: { ...authHeader(), "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        let message = "Save failed. Try again.";
        try {
          const errBody = await safeJson(res);
          message = errBody.error || message;
        } catch (parseErr) {
          // safeJson throws its own descriptive message for non-JSON
          // responses (e.g. an expired session) — prefer that over the
          // generic fallback when available.
          if (parseErr?.message) message = parseErr.message;
        }
        throw new Error(message);
      }
      const saved = await safeJson(res);
      editingId = saved.id;
      translationsPanel?.load(saved.id);
      // Awaited inside this same try/catch, before the success status/reload
      // — a module's post-save side effect (e.g. Armaments' media-attach
      // PUT) that throws is treated as a save failure, matching how each
      // module handled it before migration.
      await afterSave?.(saved);
      markClean();
      setStatus("Saved.", false);
      loadList(currentPage);
      const previewModal = id("preview-modal");
      if (previewModal && !previewModal.hidden) showPreview();
    } catch (err) {
      setStatus(err?.message || "Save failed. Try again.", true);
    } finally {
      isSaving = false;
      if (submitBtn) { submitBtn.disabled = false; submitBtn.textContent = idleLabel; }
    }
  }

  // ── Delete ───────────────────────────────────────────────────────
  async function deleteRecord(recordId) {
    if (!confirm("Delete this record? This cannot be undone.")) return;
    try {
      const res = await fetch(`${apiBase}/${recordId}`, { method: "DELETE", headers: authHeader() });
      if (!res.ok) throw new Error();
      loadList(currentPage);
    } catch (_) {
      alert("Delete failed. Try again.");
    }
  }

  // ── Preview ──────────────────────────────────────────────────────
  async function showPreview() {
    if (!editingId) { alert("Save the record first, then Preview."); return; }
    const modalId = `${idPrefix}-preview-modal`;
    toggleModal(modalId, true);
    const content = id("preview-content");
    if (content) content.innerHTML = `<p class="text-dim">Loading…</p>`;
    try {
      const res = await fetch(`${apiBase}/${editingId}/preview`, { headers: authHeader() });
      if (!res.ok) throw new Error();
      const { rendered, issues } = await safeJson(res);
      if (content) content.innerHTML = renderPreview(rendered, issues);
    } catch (_) {
      if (content) content.innerHTML = `<p class="text-dim">Preview unavailable.</p>`;
    }
  }

  // ── Init ─────────────────────────────────────────────────────────
  function init() {
    if (tabButtonSelector) {
      document.getElementById("admin-tabs")?.addEventListener("click", (e) => {
        if (e.target.closest(tabButtonSelector)) { onTabActivate?.(); loadList(1); }
      });
    }

    id("new-btn")?.addEventListener("click", () => openForm(null));
    id("cancel-btn")?.addEventListener("click", closeForm);
    id("form")?.addEventListener("submit", handleSubmit);
    id("form")?.addEventListener("input", updateDirtyIndicator);
    id("form")?.addEventListener("change", updateDirtyIndicator);
    id("preview-btn")?.addEventListener("click", showPreview);
    id("preview-modal-close")?.addEventListener("click", () => toggleModal(`${idPrefix}-preview-modal`, false));

    filters.forEach((f) => {
      const el = document.getElementById(`${idPrefix}-filter-${f.param}`);
      if (!el) return;
      const handler = () => loadList(1);
      el.addEventListener(f.event, f.debounceMs ? debounce(handler, f.debounceMs) : handler);
    });

    wireGroups();
    onInit?.(drafts, { setStatus });

    if (tabPanelId) registerDirtyGuard(tabPanelId, isDirty);
  }

  init();

  return { loadList, openForm, closeForm, isDirty };
}
