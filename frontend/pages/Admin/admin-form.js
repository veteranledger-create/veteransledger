/**
 * VeteransLedger · Admin — Shared Form Components
 * renderSources, renderStringList, renderRelated are reused verbatim by
 * every content admin module. Each function receives a containerId and the
 * calling module's own draft array; no singleton state here.
 */

import { escHtml } from "./admin-utils.js";

// Source reference list: { ref, type } pairs. onUpdate is called after
// removal so the module's wrapper can re-invoke renderSources.
export function renderSources(containerId, sourcesDraft, onUpdate) {
  const container = document.getElementById(containerId);
  if (!container) return;
  container.innerHTML = sourcesDraft
    .map(
      (s, i) => `
    <div style="display:flex;gap:var(--space-2);margin-bottom:var(--space-2);">
      <input class="contact-form__input" placeholder="Reference" value="${escHtml(s.ref)}" data-source-ref="${i}" style="flex:2;">
      <input class="contact-form__input" placeholder="Type (e.g. primary)" value="${escHtml(s.type)}" data-source-type="${i}" style="flex:1;">
      <button type="button" class="btn btn-secondary" data-source-remove="${i}" style="font-size:11px;">✕</button>
    </div>`,
    )
    .join("");
  container.querySelectorAll("[data-source-ref]").forEach((el) =>
    el.addEventListener("input", (e) => { sourcesDraft[+el.dataset.sourceRef].ref = e.target.value; }),
  );
  container.querySelectorAll("[data-source-type]").forEach((el) =>
    el.addEventListener("input", (e) => { sourcesDraft[+el.dataset.sourceType].type = e.target.value; }),
  );
  container.querySelectorAll("[data-source-remove]").forEach((el) =>
    el.addEventListener("click", () => { sourcesDraft.splice(+el.dataset.sourceRemove, 1); onUpdate(); }),
  );
}

// Generic dynamic string list. dataAttr: HTML attribute name without "data-"
// prefix. Browser auto-converts hyphens to camelCase in dataset, so keep
// dataAttr as a single word (no hyphens) to avoid conversion surprises.
export function renderStringList(containerId, draft, dataAttr, label) {
  const container = document.getElementById(containerId);
  if (!container) return;
  container.innerHTML = draft
    .map(
      (val, i) => `
    <div style="display:flex;gap:var(--space-2);margin-bottom:var(--space-2);">
      <input class="contact-form__input" placeholder="${escHtml(label)}" value="${escHtml(val)}" data-${dataAttr}="${i}" style="flex:1;">
      <button type="button" class="btn btn-secondary" data-${dataAttr}-remove="${i}" style="font-size:11px;">✕</button>
    </div>`,
    )
    .join("");
  container.querySelectorAll(`[data-${dataAttr}]`).forEach((el) =>
    el.addEventListener("input", (e) => { draft[+el.dataset[dataAttr]] = e.target.value; }),
  );
  container.querySelectorAll(`[data-${dataAttr}-remove]`).forEach((el) =>
    el.addEventListener("click", () => {
      draft.splice(+el.dataset[`${dataAttr}Remove`], 1);
      renderStringList(containerId, draft, dataAttr, label);
    }),
  );
}

// Related-records display list. onUpdate is called after removal.
export function renderRelated(containerId, relatedDraft, onUpdate) {
  const container = document.getElementById(containerId);
  if (!container) return;
  if (!relatedDraft.length) {
    container.innerHTML = `<p style="font-size:var(--text-sm);color:var(--text-muted);">None selected.</p>`;
    return;
  }
  container.innerHTML = relatedDraft
    .map(
      (r, i) => `
    <div style="display:flex;justify-content:space-between;align-items:center;padding:var(--space-2) var(--space-3);background:rgba(255,255,255,0.03);border-radius:4px;margin-bottom:var(--space-2);font-size:var(--text-sm);">
      <span><span class="badge" style="margin-right:var(--space-2);">${escHtml(r.type)}</span>${escHtml(r.title)} <span style="color:var(--text-muted);">(${escHtml(r.url || r.id)})</span></span>
      <button type="button" class="btn btn-secondary" data-related-remove="${i}" style="font-size:11px;">✕</button>
    </div>`,
    )
    .join("");
  container.querySelectorAll("[data-related-remove]").forEach((el) =>
    el.addEventListener("click", () => { relatedDraft.splice(+el.dataset.relatedRemove, 1); onUpdate(); }),
  );
}
