import { registerDirtyGuard } from "./admin-dirty-guard.js";

/**
 * VeteransLedger · Admin — Fixed-File Editor Guard
 *
 * Shared unsaved-changes protection for the /api/site-content editors
 * (NSDAP, Content Pages, Homepage, Navigation, Site Settings, Page Content).
 *
 * These are deliberately NOT createContentModule() modules — they edit whole
 * JSON files by key rather than CRUD-ing records, so that factory's
 * list/create/delete/pagination abstraction has nothing to attach to. What
 * they were missing is the one guarantee that factory does provide and that
 * is genuinely shared: warn before losing unsaved edits. This closes that gap
 * against the existing admin-dirty-guard.js registry rather than introducing
 * a second CMS architecture.
 *
 * Dirty detection snapshots every form control inside the tab panel, so it
 * works for all six editors regardless of their very different internals
 * (structured fields, raw-JSON textareas, block editors, managed card
 * collections) with no per-editor field lists. Editors with state outside
 * form controls (e.g. Homepage's card draft array) pass an `extra` function.
 *
 * Admin-only and English-only: this touches no translation data and no
 * public-facing localization.
 */

/**
 * Serializes every form control inside a panel into a stable string.
 * Checkboxes/radios record checked state; file inputs are ignored (their
 * value is not restorable and never part of the saved payload).
 */
export function snapshotPanelInputs(panelId, extra) {
  const panel = document.getElementById(panelId);
  if (!panel) return "";
  const values = [];
  panel.querySelectorAll("input, textarea, select").forEach((el) => {
    if (el.type === "checkbox" || el.type === "radio") values.push(el.checked ? 1 : 0);
    else if (el.type === "file") values.push(0);
    else values.push(el.value);
  });
  return JSON.stringify({ values, extra: extra ? extra() : null });
}

/**
 * Registers a dirty guard for one fixed-file editor.
 *
 *   tabPanelId — the .admin-tab-panel id (what admin.js checks on tab switch)
 *   extra      — optional () => any for state outside form controls
 *
 * Returns { markClean, isDirty }. Call markClean() after a file loads and
 * after a successful save; until the first markClean() the editor reports
 * clean, so a tab the admin never opened can never block navigation.
 */
export function createFileEditorGuard({ tabPanelId, extra } = {}) {
  let baseline = null;

  const snapshot = () => snapshotPanelInputs(tabPanelId, extra);

  function isDirty() {
    if (baseline === null) return false;
    return snapshot() !== baseline;
  }

  registerDirtyGuard(tabPanelId, isDirty);

  return {
    markClean() { baseline = snapshot(); },
    isDirty,
  };
}
