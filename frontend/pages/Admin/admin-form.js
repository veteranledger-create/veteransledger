/**
 * VeteransLedger · Admin — Shared Form Components
 * renderSources, renderStringList, renderRelated are reused verbatim by
 * every content admin module. Each function receives a containerId and the
 * calling module's own draft array; no singleton state here.
 */

import { escHtml } from "./admin-utils.js";
import { resolveRelatedUrl } from "/pages/shared/related-url-resolver.js";

// Source reference list: { ref, type } pairs. onUpdate is called after
// removal so the module's wrapper can re-invoke renderSources.
export function renderSources(containerId, sourcesDraft, onUpdate) {
  const container = document.getElementById(containerId);
  if (!container) return;
  container.innerHTML = sourcesDraft
    .map(
      (s, i) => `
    <div class="source-row">
      <input class="contact-form__input flex-2" placeholder="Reference" value="${escHtml(s.ref)}" data-source-ref="${i}">
      <input class="contact-form__input flex-1" placeholder="Type (e.g. primary)" value="${escHtml(s.type)}" data-source-type="${i}">
      <button type="button" class="btn btn-secondary btn--xs" data-source-remove="${i}"><svg class="icon-inline" width="10" height="10" viewBox="0 0 24 24" aria-hidden="true" xmlns="http://www.w3.org/2000/svg"><path fill="currentColor" fill-rule="evenodd" clip-rule="evenodd" d="M5.29289 5.29289C5.68342 4.90237 6.31658 4.90237 6.70711 5.29289L12 10.5858L17.2929 5.29289C17.6834 4.90237 18.3166 4.90237 18.7071 5.29289C19.0976 5.68342 19.0976 6.31658 18.7071 6.70711L13.4142 12L18.7071 17.2929C19.0976 17.6834 19.0976 18.3166 18.7071 18.7071C18.3166 19.0976 17.6834 19.0976 17.2929 18.7071L12 13.4142L6.70711 18.7071C6.31658 19.0976 5.68342 19.0976 5.29289 18.7071C4.90237 18.3166 4.90237 17.6834 5.29289 17.2929L10.5858 12L5.29289 6.70711C4.90237 6.31658 4.90237 5.68342 5.29289 5.29289Z"/></svg></button>
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
    <div class="source-row">
      <input class="contact-form__input flex-1" placeholder="${escHtml(label)}" value="${escHtml(val)}" data-${dataAttr}="${i}">
      <button type="button" class="btn btn-secondary btn--xs" data-${dataAttr}-remove="${i}"><svg class="icon-inline" width="10" height="10" viewBox="0 0 24 24" aria-hidden="true" xmlns="http://www.w3.org/2000/svg"><path fill="currentColor" fill-rule="evenodd" clip-rule="evenodd" d="M5.29289 5.29289C5.68342 4.90237 6.31658 4.90237 6.70711 5.29289L12 10.5858L17.2929 5.29289C17.6834 4.90237 18.3166 4.90237 18.7071 5.29289C19.0976 5.68342 19.0976 6.31658 18.7071 6.70711L13.4142 12L18.7071 17.2929C19.0976 17.6834 19.0976 18.3166 18.7071 18.7071C18.3166 19.0976 17.6834 19.0976 17.2929 18.7071L12 13.4142L6.70711 18.7071C6.31658 19.0976 5.68342 19.0976 5.29289 18.7071C4.90237 18.3166 4.90237 17.6834 5.29289 17.2929L10.5858 12L5.29289 6.70711C4.90237 6.31658 4.90237 5.68342 5.29289 5.29289Z"/></svg></button>
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
    container.innerHTML = `<p class="empty-note">None selected.</p>`;
    return;
  }
  container.innerHTML = relatedDraft
    .map(
      (r, i) => `
    <div class="related-item">
      <span><span class="badge">${escHtml(r.type)}</span>${escHtml(r.title)} <span class="text-dim">(${escHtml(resolveRelatedUrl(r.type, r.id))})</span></span>
      <button type="button" class="btn btn-secondary btn--xs" data-related-remove="${i}"><svg class="icon-inline" width="10" height="10" viewBox="0 0 24 24" aria-hidden="true" xmlns="http://www.w3.org/2000/svg"><path fill="currentColor" fill-rule="evenodd" clip-rule="evenodd" d="M5.29289 5.29289C5.68342 4.90237 6.31658 4.90237 6.70711 5.29289L12 10.5858L17.2929 5.29289C17.6834 4.90237 18.3166 4.90237 18.7071 5.29289C19.0976 5.68342 19.0976 6.31658 18.7071 6.70711L13.4142 12L18.7071 17.2929C19.0976 17.6834 19.0976 18.3166 18.7071 18.7071C18.3166 19.0976 17.6834 19.0976 17.2929 18.7071L12 13.4142L6.70711 18.7071C6.31658 19.0976 5.68342 19.0976 5.29289 18.7071C4.90237 18.3166 4.90237 17.6834 5.29289 17.2929L10.5858 12L5.29289 6.70711C4.90237 6.31658 4.90237 5.68342 5.29289 5.29289Z"/></svg></button>
    </div>`,
    )
    .join("");
  container.querySelectorAll("[data-related-remove]").forEach((el) =>
    el.addEventListener("click", () => { relatedDraft.splice(+el.dataset.relatedRemove, 1); onUpdate(); }),
  );
}
