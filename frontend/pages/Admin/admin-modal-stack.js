/**
 * VeteransLedger · Admin — Modal Stack Manager
 *
 * Shared infrastructure for every Admin modal: real open/close stack
 * tracking, focus trap, focus restoration, and Escape closing only the
 * topmost modal (not every open modal at once). Also exposes enough state
 * for a global Ctrl+S handler to route the save action to whichever modal
 * is currently on top — or fall through to the form behind it when the
 * topmost modal has no save action of its own (e.g. a read-only preview).
 *
 * Passive by design: modals stay plain `<div hidden>` elements exactly as
 * before. This module watches each one's `hidden` attribute via
 * MutationObserver instead of requiring callers to opt in, so every
 * existing modal — including the not-yet-migrated content modules' preview
 * modals — gets focus trap / restoration / correct Escape behavior for
 * free, with zero changes to their own JS.
 */

const FOCUSABLE_SELECTOR =
  'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';

const _stack = []; // { id, el, opener }
const _saveSelectors = {}; // modalId -> CSS selector for its primary save action (omitted/null = no save action, e.g. preview)
let _onEscapeWithNoModal = null;

function _focusableEls(container) {
  return Array.from(container.querySelectorAll(FOCUSABLE_SELECTOR)).filter(
    (el) => el.offsetWidth > 0 || el.offsetHeight > 0 || el === document.activeElement,
  );
}

// Single always-on listener (not added/removed per modal open/close) so
// Escape's "topmost modal, else fall through" decision is made once, from
// authoritative state, before anything mutates — no race with a second,
// separately-registered handler reacting to the `hidden` attribute change.
function _keydown(e) {
  if (e.key === "Escape") {
    const top = _stack[_stack.length - 1];
    if (top) { e.preventDefault(); top.el.hidden = true; }
    else _onEscapeWithNoModal?.();
    return;
  }
  if (e.key !== "Tab") return;
  const top = _stack[_stack.length - 1];
  if (!top) return;
  const focusables = _focusableEls(top.el);
  if (!focusables.length) return;
  const first = focusables[0];
  const last = focusables[focusables.length - 1];
  if (e.shiftKey && document.activeElement === first) {
    e.preventDefault();
    last.focus();
  } else if (!e.shiftKey && document.activeElement === last) {
    e.preventDefault();
    first.focus();
  }
}

function _onOpen(id, el) {
  // Clear any stale entry for this id first rather than no-op'ing on it:
  // a rapid close-then-reopen inside one synchronous tick (e.g. re-showing
  // the same preview modal) can coalesce into a single MutationObserver
  // callback, so an "already tracked" guard here would skip the fresh
  // opener capture and auto-focus for the new open.
  const staleIdx = _stack.findIndex((m) => m.id === id);
  if (staleIdx !== -1) _stack.splice(staleIdx, 1);
  if (!el.hasAttribute("role")) el.setAttribute("role", "dialog");
  el.setAttribute("aria-modal", "true");

  const opener = document.activeElement && document.activeElement !== document.body ? document.activeElement : null;
  _stack.push({ id, el, opener });

  if (!el.contains(document.activeElement)) {
    const [first] = _focusableEls(el);
    (first || el).focus?.({ preventScroll: true });
  }
}

function _onClose(id) {
  const idx = _stack.findIndex((m) => m.id === id);
  if (idx === -1) return;
  const [entry] = _stack.splice(idx, 1);
  if (entry.opener && document.body.contains(entry.opener)) {
    entry.opener.focus?.({ preventScroll: true });
  }
}

function _watch(id) {
  const el = document.getElementById(id);
  if (!el) return;
  if (!el.hidden) _onOpen(id, el);
  new MutationObserver(() => {
    if (!el.hidden) _onOpen(id, el);
    else _onClose(id);
  }).observe(el, { attributes: true, attributeFilter: ["hidden"] });

  // Backdrop click closes this modal. Harmless if a module also wires its
  // own backdrop handler (e.g. admin-related.js) — both just set `hidden`.
  el.addEventListener("click", (e) => { if (e.target === el) el.hidden = true; });
}

let _initialized = false;

/**
 * modalConfigs: [{ id, saveSelector? }]
 * saveSelector, when present, is a CSS selector (scoped to `document`) for
 * the modal's own primary save button — used by the global Ctrl+S handler.
 * Omit it for modals with no save action (previews, pickers).
 *
 * onEscapeWithNoModal, when provided, runs on Escape only when the stack is
 * empty (e.g. admin.js uses it to close an open form panel) — never on the
 * same keypress that just closed a modal.
 */
export function initModalStack(modalConfigs, { onEscapeWithNoModal } = {}) {
  if (onEscapeWithNoModal) _onEscapeWithNoModal = onEscapeWithNoModal;
  modalConfigs.forEach(({ id, saveSelector }) => {
    if (saveSelector) _saveSelectors[id] = saveSelector;
    _watch(id);
  });
  if (!_initialized) {
    _initialized = true;
    document.addEventListener("keydown", _keydown, true);
  }
}

export function getTopModalId() {
  return _stack.length ? _stack[_stack.length - 1].id : null;
}

/** The topmost open modal's configured save button, or null if none is open / it has no save action. */
export function getTopModalSaveButton() {
  const id = getTopModalId();
  if (!id) return null;
  const selector = _saveSelectors[id];
  if (!selector) return null;
  return document.querySelector(selector);
}

export function isAnyModalOpen() {
  return _stack.length > 0;
}
