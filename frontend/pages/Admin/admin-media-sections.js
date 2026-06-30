/**
 * VeteransLedger · Admin — Shared Media Section Renderers
 * Eliminates the ~150 lines of near-identical gallery / documents / blueprints /
 * video rendering code that previously lived in every content admin module.
 *
 * All functions are stateless — they receive the draft array and an onUpdate
 * callback (the calling module's own thin wrapper) so re-renders stay correct
 * when items are removed or reordered.
 */

import { authHeader, escHtml, safeJson } from "./admin-utils.js";
import {
  mediaItemControls, updateSectionCount, wireMediaItemControls,
  clearSectionAttribution, validateMediaUrls, DOC_TYPE_OPTIONS,
} from "./admin-media.js";

// ── Upload helpers ────────────────────────────────────────────

export async function uploadFile(file) {
  const fd = new FormData();
  fd.append("file", file);
  const res = await fetch("/api/media/upload", { method: "POST", headers: authHeader(), body: fd });
  if (!res.ok) throw new Error(`Upload failed (${res.status})`);
  return await safeJson(res);
}

export async function handleUpload(files, inputId, draft, renderFn, setStatus, isVideo = false) {
  if (!files || !files.length) return;
  setStatus(`Uploading ${files.length} file(s)…`, false);
  const errors = [];
  for (const file of files) {
    try {
      const asset = await uploadFile(file);
      const item = { file: asset.url, title: file.name.replace(/\.[^.]+$/, "").replace(/[-_]/g, " "), caption: "", source: "" };
      if (isVideo) { item.thumbnail = asset.thumbnailUrl || ""; item.duration = ""; }
      draft.push(item);
    } catch (_) { errors.push(file.name); }
  }
  const input = document.getElementById(inputId);
  if (input) input.value = "";
  renderFn();
  if (errors.length) setStatus(`Upload failed for: ${errors.join(", ")}. Others saved.`, true);
  else setStatus(`${files.length} file(s) uploaded. Save the form to persist.`, false);
}

// Wires Check URLs / Clear Attribution / Delete All for one media section.
export function wireSectionActions(prefix, section, draft, renderFn, mediaType) {
  document.getElementById(`${prefix}-${section}-check-urls`)?.addEventListener("click", () => validateMediaUrls(draft, renderFn));
  document.getElementById(`${prefix}-${section}-clear-attr`)?.addEventListener("click", () => clearSectionAttribution(draft, renderFn, mediaType));
  document.getElementById(`${prefix}-${section}-delete-all`)?.addEventListener("click", () => {
    if (!draft.length) return;
    if (!confirm(`Remove all ${draft.length} ${mediaType}(s)?`)) return;
    draft.length = 0; renderFn();
  });
}

// ── Gallery ───────────────────────────────────────────────────

export function renderGallery(listId, countId, draft, onUpdate) {
  const container = document.getElementById(listId);
  if (!container) return;
  updateSectionCount(countId, draft.length, "image", "images");
  if (!draft.length) { container.innerHTML = `<p class="media-empty-state">No gallery images yet.</p>`; return; }
  container.innerHTML = draft.map((g, i) => `
    <div class="media-card">
      <div class="media-card__body">
        <img class="media-card__thumb" src="${escHtml(g.file)}" alt="" onerror="this.style.opacity='0.25'">
        <div class="media-card__fields">
          <input class="contact-form__input" placeholder="Title" value="${escHtml(g.title || "")}" data-gallery-title="${i}">
          <div class="media-card__row2">
            <input class="contact-form__input" placeholder="Caption" value="${escHtml(g.caption || "")}" data-gallery-caption="${i}">
            <input class="contact-form__input" placeholder="Source / citation" value="${escHtml(g.source || "")}" data-gallery-source="${i}">
          </div>
          <div class="media-card__url">${escHtml(g.file)}</div>
        </div>
      </div>
      ${mediaItemControls(draft, i, onUpdate, "image")}
    </div>`).join("");
  container.querySelectorAll("[data-gallery-title]").forEach((el) => el.addEventListener("input", () => { draft[+el.dataset.galleryTitle].title = el.value; }));
  container.querySelectorAll("[data-gallery-caption]").forEach((el) => el.addEventListener("input", () => { draft[+el.dataset.galleryCaption].caption = el.value; }));
  container.querySelectorAll("[data-gallery-source]").forEach((el) => el.addEventListener("input", () => { draft[+el.dataset.gallerySource].source = el.value; }));
  wireMediaItemControls(container, draft, onUpdate, "image");
}

// ── Documents ─────────────────────────────────────────────────

export function renderDocuments(listId, countId, draft, onUpdate) {
  const container = document.getElementById(listId);
  if (!container) return;
  updateSectionCount(countId, draft.length, "document", "documents");
  if (!draft.length) { container.innerHTML = `<p class="media-empty-state">No documents yet.</p>`; return; }
  container.innerHTML = draft.map((d, i) => `
    <div class="media-card">
      <div class="media-card__body">
        <div class="media-card__icon" title="${escHtml(d.file)}">
          <img src="/public/images/icons/ui/file.svg" alt="" width="28" height="28" style="opacity:0.7;" onerror="this.parentElement.textContent='📄'">
        </div>
        <div class="media-card__fields">
          <input class="contact-form__input" placeholder="Title" value="${escHtml(d.title || "")}" data-doc-title="${i}">
          <div class="media-card__row2">
            <select class="contact-form__input" data-doc-type="${i}">
              ${DOC_TYPE_OPTIONS.map((o) => `<option value="${o.value}"${d.type === o.value ? " selected" : ""}>${o.label}</option>`).join("")}
            </select>
            <input class="contact-form__input" placeholder="Caption / description" value="${escHtml(d.caption || "")}" data-doc-caption="${i}">
          </div>
          <div class="media-card__url">${escHtml(d.file)}</div>
        </div>
      </div>
      ${mediaItemControls(draft, i, onUpdate, "document")}
    </div>`).join("");
  container.querySelectorAll("[data-doc-title]").forEach((el) => el.addEventListener("input", () => { draft[+el.dataset.docTitle].title = el.value; }));
  container.querySelectorAll("[data-doc-type]").forEach((el) => el.addEventListener("change", () => { draft[+el.dataset.docType].type = el.value; }));
  container.querySelectorAll("[data-doc-caption]").forEach((el) => el.addEventListener("input", () => { draft[+el.dataset.docCaption].caption = el.value; }));
  wireMediaItemControls(container, draft, onUpdate, "document");
}

// ── Blueprints (armaments-specific) ──────────────────────────

export function renderBlueprints(listId, countId, draft, onUpdate) {
  const container = document.getElementById(listId);
  if (!container) return;
  updateSectionCount(countId, draft.length, "blueprint", "blueprints");
  if (!draft.length) { container.innerHTML = `<p class="media-empty-state">No blueprints yet.</p>`; return; }
  container.innerHTML = draft.map((b, i) => `
    <div class="media-card">
      <div class="media-card__body">
        <img class="media-card__thumb media-card__thumb--contain" src="${escHtml(b.file)}" alt="" onerror="this.style.opacity='0.25'">
        <div class="media-card__fields">
          <input class="contact-form__input" placeholder="Title (e.g. Side elevation)" value="${escHtml(b.title || "")}" data-bp-title="${i}">
          <div class="media-card__row2">
            <input class="contact-form__input" placeholder="Caption" value="${escHtml(b.caption || "")}" data-bp-caption="${i}">
            <input class="contact-form__input" placeholder="Source / citation" value="${escHtml(b.source || "")}" data-bp-source="${i}">
          </div>
          <div class="media-card__url">${escHtml(b.file)}</div>
        </div>
      </div>
      ${mediaItemControls(draft, i, onUpdate, "blueprint")}
    </div>`).join("");
  container.querySelectorAll("[data-bp-title]").forEach((el) => el.addEventListener("input", () => { draft[+el.dataset.bpTitle].title = el.value; }));
  container.querySelectorAll("[data-bp-caption]").forEach((el) => el.addEventListener("input", () => { draft[+el.dataset.bpCaption].caption = el.value; }));
  container.querySelectorAll("[data-bp-source]").forEach((el) => el.addEventListener("input", () => { draft[+el.dataset.bpSource].source = el.value; }));
  wireMediaItemControls(container, draft, onUpdate, "blueprint");
}

// ── Videos (armaments-specific) ──────────────────────────────

export function renderVideos(listId, countId, draft, onUpdate) {
  const container = document.getElementById(listId);
  if (!container) return;
  updateSectionCount(countId, draft.length, "video", "videos");
  if (!draft.length) { container.innerHTML = `<p class="media-empty-state">No videos yet.</p>`; return; }
  container.innerHTML = draft.map((v, i) => `
    <div class="media-card">
      <div class="media-card__body">
        <div class="media-card__icon" title="${escHtml(v.file)}">▶</div>
        <div class="media-card__fields">
          <input class="contact-form__input" placeholder="Title" value="${escHtml(v.title || "")}" data-vid-title="${i}">
          <div class="media-card__row2">
            <input class="contact-form__input" placeholder="Duration (e.g. 2:14)" value="${escHtml(v.duration || "")}" data-vid-duration="${i}">
            <input class="contact-form__input" placeholder="Caption" value="${escHtml(v.caption || "")}" data-vid-caption="${i}">
          </div>
          <input class="contact-form__input" placeholder="Poster thumbnail URL (optional)" value="${escHtml(v.thumbnail || "")}" data-vid-thumb="${i}">
          <div class="media-card__url">${escHtml(v.file)}</div>
        </div>
      </div>
      ${mediaItemControls(draft, i, onUpdate, "video")}
    </div>`).join("");
  container.querySelectorAll("[data-vid-title]").forEach((el) => el.addEventListener("input", () => { draft[+el.dataset.vidTitle].title = el.value; }));
  container.querySelectorAll("[data-vid-duration]").forEach((el) => el.addEventListener("input", () => { draft[+el.dataset.vidDuration].duration = el.value; }));
  container.querySelectorAll("[data-vid-caption]").forEach((el) => el.addEventListener("input", () => { draft[+el.dataset.vidCaption].caption = el.value; }));
  container.querySelectorAll("[data-vid-thumb]").forEach((el) => el.addEventListener("input", () => { draft[+el.dataset.vidThumb].thumbnail = el.value; }));
  wireMediaItemControls(container, draft, onUpdate, "video");
}
