import { TranslationsPanel } from "./translations-panel.js";
import { initMediaAdmin, registerCallbacks } from "./admin-media.js";
import { authHeader, escHtml, debounce, loader, toggleModal, makeStatusFn, safeJson } from "./admin-utils.js";
import { initRelatedModal, openRelatedModal } from "./admin-related.js";
import { renderSources as renderSourcesFn, renderRelated as renderRelatedFn } from "./admin-form.js";
import { uploadFile, handleUpload, wireSectionActions, renderGallery, renderDocuments } from "./admin-media-sections.js";

/**
 * VeteransLedger · Admin — Letters
 * Letter-specific logic only. Shared infrastructure is in admin-utils /
 * admin-related / admin-form / admin-media-sections.
 * Note: Letters filter API uses metadata.language; generator uses
 * metadata.collection. Admin writes BOTH to the same value.
 */

let currentPage = 1;
let editingId = null;
const translationsPanel = new TranslationsPanel("letter-translations-panel", "record");
let sourcesDraft = [];
let relatedDraft = [];
let galleryDraft = [];
let documentsDraft = [];

const setStatus = makeStatusFn("letter-form-status");

function renderSources() { renderSourcesFn("letter-sources-list", sourcesDraft, renderSources); }
function renderRelated() { renderRelatedFn("letter-related-list", relatedDraft, renderRelated); }
function renderGalleryAdmin() { renderGallery("letter-gallery-list", "letter-gallery-count", galleryDraft, renderGalleryAdmin); }
function renderDocumentsAdmin() { renderDocuments("letter-documents-list", "letter-documents-count", documentsDraft, renderDocumentsAdmin); }

function init() {
  initMediaAdmin();
  initRelatedModal();
  registerCallbacks(uploadFile, setStatus);

  document.getElementById("admin-tabs")?.addEventListener("click", (e) => {
    if (e.target.closest('[data-tab="tab-letters"]')) {
      registerCallbacks(uploadFile, setStatus);
      loadLetters(1);
    }
  });

  document.getElementById("letter-new-btn")?.addEventListener("click", () => openForm(null));
  document.getElementById("letter-cancel-btn")?.addEventListener("click", closeForm);
  document.getElementById("letter-filter-collection")?.addEventListener("change", () => loadLetters(1));
  document.getElementById("letter-filter-search")?.addEventListener("input", debounce(() => loadLetters(1), 350));
  document.getElementById("letter-form")?.addEventListener("submit", handleSubmit);
  document.getElementById("letter-preview-btn")?.addEventListener("click", showPreview);
  document.getElementById("letter-preview-modal-close")?.addEventListener("click", () => toggleModal("letter-preview-modal", false));

  document.getElementById("letter-add-source-btn")?.addEventListener("click", () => { sourcesDraft.push({ ref: "", type: "" }); renderSources(); });
  document.getElementById("letter-add-related-btn")?.addEventListener("click", () =>
    openRelatedModal((item) => { relatedDraft.push(item); renderRelated(); })
  );

  document.getElementById("letter-gallery-upload")?.addEventListener("change", (e) => handleUpload(e.target.files, "letter-gallery-upload", galleryDraft, renderGalleryAdmin, setStatus));
  document.getElementById("letter-documents-upload")?.addEventListener("change", (e) => handleUpload(e.target.files, "letter-documents-upload", documentsDraft, renderDocumentsAdmin, setStatus));

  wireSectionActions("letter", "gallery", galleryDraft, renderGalleryAdmin, "image");
  wireSectionActions("letter", "documents", documentsDraft, renderDocumentsAdmin, "document");
}

// ── List ──────────────────────────────────────────────────────
async function loadLetters(page = 1) {
  currentPage = page;
  const container = document.getElementById("letter-list");
  if (!container) return;
  container.innerHTML = loader();

  const collection = document.getElementById("letter-filter-collection")?.value || "";
  const search = document.getElementById("letter-filter-search")?.value || "";
  const params = new URLSearchParams({ page, limit: 20, ...(collection && { language: collection }), ...(search && { search }) });

  try {
    const res = await fetch(`/api/letters?${params}`, { headers: authHeader() });
    if (!res.ok) throw new Error();
    renderList(container, await safeJson(res));
  } catch (_) {
    container.innerHTML = `<p class="text-dim">Letters unavailable.</p>`;
  }
}

function renderList(container, { data, total, page, pages }) {
  if (!data.length) {
    container.innerHTML = `<p class="text-dim">No letters yet. Create one above.</p>`;
    return;
  }
  container.innerHTML = `
    <p class="list-meta">${total} letters · page ${page} of ${pages}</p>
    <table class="admin-table">
      <thead>
        <tr>
          <th>Sender / Title</th>
          <th>Collection</th>
          <th>Date</th>
          <th>Status</th>
          <th class="col-actions">Actions</th>
        </tr>
      </thead>
      <tbody>
        ${data.map((r) => {
          const meta = r.metadata || {};
          const sender = meta.from || meta.author || r.title || "—";
          const collection = meta.collection || meta.language || "german";
          return `
          <tr>
            <td class="td-primary">${escHtml(sender)}</td>
            <td><span class="badge">${escHtml(collection)}</span></td>
            <td class="td-muted">${r.date ? r.date.slice(0, 10) : "—"}</td>
            <td>${r.published ? '<span class="status-published">Published</span>' : '<span class="status-draft">Draft</span>'}</td>
            <td class="col-actions">
              <button class="btn btn-secondary btn--xs" data-edit="${r.id}">Edit</button>
              <button class="btn btn-secondary btn--xs btn--danger" data-delete="${r.id}">Delete</button>
            </td>
          </tr>`;
        }).join("")}
      </tbody>
    </table>
    ${pages > 1 ? `<div class="pagination">
      ${page > 1 ? `<button class="btn btn-secondary" data-page="${page - 1}">← Prev</button>` : ""}
      ${page < pages ? `<button class="btn btn-secondary" data-page="${page + 1}">Next →</button>` : ""}
    </div>` : ""}`;

  container.querySelectorAll("[data-edit]").forEach((btn) => btn.addEventListener("click", () => openForm(btn.dataset.edit)));
  container.querySelectorAll("[data-delete]").forEach((btn) => btn.addEventListener("click", () => deleteLetter(btn.dataset.delete)));
  container.querySelectorAll("[data-page]").forEach((btn) => btn.addEventListener("click", () => loadLetters(+btn.dataset.page)));
}

async function deleteLetter(id) {
  if (!confirm("Delete this letter? This cannot be undone.")) return;
  try {
    const res = await fetch(`/api/letters/${id}`, { method: "DELETE", headers: authHeader() });
    if (!res.ok) throw new Error();
    loadLetters(currentPage);
  } catch (_) {
    alert("Delete failed. Try again.");
  }
}

// ── Form ──────────────────────────────────────────────────────
function openForm(id) {
  editingId = id;
  sourcesDraft = []; relatedDraft = []; galleryDraft = []; documentsDraft = [];
  document.getElementById("letter-form")?.reset();
  document.getElementById("letter-form-title").textContent = id ? "Edit Letter" : "New Letter";
  document.getElementById("letter-form-panel").hidden = false;
  renderSources(); renderRelated(); renderGalleryAdmin(); renderDocumentsAdmin();
  setStatus("", false);
  if (id) { loadLetterIntoForm(id); translationsPanel.load(id); }
  else translationsPanel.clear();
}

function closeForm() {
  document.getElementById("letter-form-panel").hidden = true;
  editingId = null;
}

async function loadLetterIntoForm(id) {
  try {
    const res = await fetch(`/api/letters/${id}`, { headers: authHeader() });
    if (!res.ok) throw new Error();
    const r = await safeJson(res);
    const meta = r.metadata || {};
    const form = document.getElementById("letter-form");

    form.querySelector("[name='title']").value = r.title || "";
    form.querySelector("[name='from']").value = meta.from || meta.author || "";
    form.querySelector("[name='to']").value = meta.to || "";
    form.querySelector("[name='date']").value = r.date ? r.date.slice(0, 10) : "";
    form.querySelector("[name='collection']").value = meta.collection || meta.language || "german";
    form.querySelector("[name='summary']").value = r.summary || "";
    form.querySelector("[name='full_text']").value = meta.full_text || meta.body || r.content || "";
    form.querySelector("[name='published']").checked = !!r.published;

    sourcesDraft = Array.isArray(meta.sources) ? meta.sources.map((s) => ({ ref: s.ref || "", type: s.type || "" })) : [];
    relatedDraft = Array.isArray(meta.related_records) ? [...meta.related_records] : [];
    galleryDraft = Array.isArray(meta.gallery) ? meta.gallery.map((g) => ({ ...g })) : [];
    documentsDraft = Array.isArray(meta.documents) ? meta.documents.map((d) => ({ ...d })) : [];

    renderSources(); renderRelated(); renderGalleryAdmin(); renderDocumentsAdmin();
  } catch (_) {
    setStatus("Failed to load letter.", true);
  }
}

// ── Preview ───────────────────────────────────────────────────
async function showPreview() {
  if (!editingId) { alert("Save the letter first, then Preview."); return; }
  toggleModal("letter-preview-modal", true);
  const content = document.getElementById("letter-preview-content");
  content.innerHTML = `<p class="text-dim">Loading…</p>`;
  try {
    const res = await fetch(`/api/letters/${editingId}/preview`, { headers: authHeader() });
    if (!res.ok) throw new Error();
    const { rendered, issues } = await safeJson(res);
    const errors = issues.filter((i) => i.severity === "error");
    content.innerHTML = `
      ${errors.length ? `<div class="preview-error">
        <strong>Cannot publish — ${errors.length} blocking issue(s):</strong>
        <ul>${errors.map((e) => `<li>${escHtml(e.message)}</li>`).join("")}</ul>
      </div>` : ""}
      <h3 class="preview-title">${escHtml(rendered.from || rendered.title || "—")}</h3>
      <p class="text-dim mb-3">${escHtml(rendered.collection || "")}${rendered.date ? " · " + rendered.date : ""}</p>
      <p class="mb-4">${escHtml((rendered.excerpt || "").slice(0, 200))}</p>
      <pre class="preview-json">${escHtml(JSON.stringify(rendered, null, 2))}</pre>`;
  } catch (_) {
    content.innerHTML = `<p class="text-dim">Preview unavailable.</p>`;
  }
}

// ── Submit ────────────────────────────────────────────────────
async function handleSubmit(e) {
  e.preventDefault();
  const form = e.target;
  const fromVal = form.querySelector("[name='from']").value.trim();
  const titleVal = form.querySelector("[name='title']").value.trim();
  const collectionVal = form.querySelector("[name='collection']").value || "german";

  const body = {
    title: titleVal || fromVal || "Untitled Letter",
    summary: form.querySelector("[name='summary']").value.trim() || undefined,
    published: form.querySelector("[name='published']").checked,
    metadata: {
      from: fromVal || undefined,
      to: form.querySelector("[name='to']").value.trim() || undefined,
      collection: collectionVal,
      language: collectionVal,
      full_text: form.querySelector("[name='full_text']").value.trim() || undefined,
      sources: sourcesDraft.filter((s) => s.ref),
      related_records: relatedDraft,
      gallery: galleryDraft.filter((g) => g.file),
      documents: documentsDraft.filter((d) => d.file),
    },
  };

  const dateVal = form.querySelector("[name='date']").value.trim();
  if (dateVal) body.date = dateVal;

  try {
    const res = await fetch(editingId ? `/api/letters/${editingId}` : "/api/letters", {
      method: editingId ? "PUT" : "POST",
      headers: { ...authHeader(), "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const err = await safeJson(res).catch(() => ({}));
      throw new Error(err.error || "Save failed.");
    }
    const saved = await safeJson(res);
    editingId = saved.id;
    translationsPanel.load(saved.id);
    setStatus("Saved.", false);
    loadLetters(currentPage);
    if (!document.getElementById("letter-preview-modal")?.hidden) showPreview();
  } catch (err) {
    setStatus(err.message || "Save failed. Try again.", true);
  }
}

init();
