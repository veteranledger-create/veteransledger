import { TranslationsPanel } from "./translations-panel.js";
import { authHeader, escHtml, debounce, loader, toggleModal, makeStatusFn, safeJson } from "./admin-utils.js";
import { initRelatedModal, openRelatedModal } from "./admin-related.js";
import { renderSources as renderSourcesFn, renderRelated as renderRelatedFn } from "./admin-form.js";
import { uploadFile, handleUpload, wireSectionActions, renderGallery, renderDocuments } from "./admin-media-sections.js";
import { initMediaAdmin, registerCallbacks } from "./admin-media.js";

/**
 * VeteransLedger · Admin — Maps
 * Uses the generic /api/records endpoint with type=MAP.
 */

let currentPage = 1;
let editingId = null;
const translationsPanel = new TranslationsPanel("map-translations-panel", "record");
let sourcesDraft = [];
let relatedDraft = [];
let galleryDraft = [];
let documentsDraft = [];

const setStatus = makeStatusFn("map-form-status");
function renderSources() { renderSourcesFn("map-sources-list", sourcesDraft, renderSources); }
function renderRelated() { renderRelatedFn("map-related-list", relatedDraft, renderRelated); }
function renderGalleryAdmin() { renderGallery("map-gallery-list", "map-gallery-count", galleryDraft, renderGalleryAdmin); }
function renderDocumentsAdmin() { renderDocuments("map-documents-list", "map-documents-count", documentsDraft, renderDocumentsAdmin); }

function init() {
  initMediaAdmin();
  initRelatedModal();
  registerCallbacks(uploadFile, setStatus);

  document.getElementById("admin-tabs")?.addEventListener("click", (e) => {
    if (e.target.closest('[data-tab="tab-maps"]')) {
      registerCallbacks(uploadFile, setStatus);
      loadRecords(1);
    }
  });

  document.getElementById("map-new-btn")?.addEventListener("click", () => openForm(null));
  document.getElementById("map-cancel-btn")?.addEventListener("click", closeForm);
  document.getElementById("map-filter-search")?.addEventListener("input", debounce(() => loadRecords(1), 350));
  document.getElementById("map-form")?.addEventListener("submit", handleSubmit);
  document.getElementById("map-preview-btn")?.addEventListener("click", showPreview);
  document.getElementById("map-preview-modal-close")?.addEventListener("click", () => toggleModal("map-preview-modal", false));
  document.getElementById("map-add-source-btn")?.addEventListener("click", () => { sourcesDraft.push({ ref: "", type: "" }); renderSources(); });
  document.getElementById("map-add-related-btn")?.addEventListener("click", () => openRelatedModal((item) => { relatedDraft.push(item); renderRelated(); }));

  document.getElementById("map-gallery-upload")?.addEventListener("change", (e) => handleUpload(e.target.files, "map-gallery-upload", galleryDraft, renderGalleryAdmin, setStatus));
  document.getElementById("map-documents-upload")?.addEventListener("change", (e) => handleUpload(e.target.files, "map-documents-upload", documentsDraft, renderDocumentsAdmin, setStatus));
  wireSectionActions("map", "gallery", galleryDraft, renderGalleryAdmin, "image");
  wireSectionActions("map", "documents", documentsDraft, renderDocumentsAdmin, "document");
}

async function loadRecords(page = 1) {
  currentPage = page;
  const container = document.getElementById("map-list");
  if (!container) return;
  container.innerHTML = loader();
  const search = document.getElementById("map-filter-search")?.value || "";
  const params = new URLSearchParams({ type: "MAP", page, limit: 20, ...(search && { search }) });
  try {
    const res = await fetch(`/api/records?${params}`, { headers: authHeader() });
    if (!res.ok) throw new Error();
    renderList(container, await safeJson(res));
  } catch (_) {
    container.innerHTML = `<p class="text-dim">Maps unavailable.</p>`;
  }
}

function renderList(container, { data, total, page, pages }) {
  if (!data.length) { container.innerHTML = `<p class="text-dim">No maps yet. Create one above.</p>`; return; }
  container.innerHTML = `
    <p class="list-meta">${total} maps · page ${page} of ${pages}</p>
    <table class="admin-table">
      <thead><tr>
        <th>Title</th>
        <th>Status</th>
        <th class="col-actions">Actions</th>
      </tr></thead>
      <tbody>
        ${data.map((r) => `
          <tr>
            <td class="td-primary">${escHtml(r.title)}</td>
            <td>${r.published ? '<span class="status-published">Published</span>' : '<span class="status-draft">Draft</span>'}</td>
            <td class="col-actions">
              <button class="btn btn-secondary btn--xs" data-edit="${r.id}">Edit</button>
              <button class="btn btn-secondary btn--xs btn--danger" data-delete="${r.id}">Delete</button>
            </td>
          </tr>`).join("")}
      </tbody>
    </table>
    ${pages > 1 ? `<div class="pagination">
      ${page > 1 ? `<button class="btn btn-secondary" data-page="${page - 1}">← Prev</button>` : ""}
      ${page < pages ? `<button class="btn btn-secondary" data-page="${page + 1}">Next →</button>` : ""}
    </div>` : ""}`;
  container.querySelectorAll("[data-edit]").forEach((btn) => btn.addEventListener("click", () => openForm(btn.dataset.edit)));
  container.querySelectorAll("[data-delete]").forEach((btn) => btn.addEventListener("click", () => deleteRecord(btn.dataset.delete)));
  container.querySelectorAll("[data-page]").forEach((btn) => btn.addEventListener("click", () => loadRecords(+btn.dataset.page)));
}

async function deleteRecord(id) {
  if (!confirm("Delete this map? This cannot be undone.")) return;
  try {
    const res = await fetch(`/api/records/${id}`, { method: "DELETE", headers: authHeader() });
    if (!res.ok) throw new Error();
    loadRecords(currentPage);
  } catch (_) { alert("Delete failed. Try again."); }
}

function openForm(id) {
  editingId = id;
  sourcesDraft = []; relatedDraft = []; galleryDraft = []; documentsDraft = [];
  document.getElementById("map-form")?.reset();
  document.getElementById("map-form-title").textContent = id ? "Edit Map" : "New Map";
  document.getElementById("map-form-panel").hidden = false;
  renderSources(); renderRelated(); renderGalleryAdmin(); renderDocumentsAdmin();
  setStatus("", false);
  if (id) { loadIntoForm(id); translationsPanel.load(id); }
  else translationsPanel.clear();
}

function closeForm() {
  document.getElementById("map-form-panel").hidden = true;
  editingId = null;
}

async function loadIntoForm(id) {
  try {
    const res = await fetch(`/api/records/${id}`, { headers: authHeader() });
    if (!res.ok) throw new Error();
    const r = await safeJson(res);
    const meta = r.metadata || {};
    const form = document.getElementById("map-form");
    form.querySelector("[name='title']").value = r.title || "";
    form.querySelector("[name='summary']").value = r.summary || "";
    form.querySelector("[name='theater']").value = meta.theater || "";
    form.querySelector("[name='year']").value = meta.year || "";
    form.querySelector("[name='published']").checked = !!r.published;
    sourcesDraft = Array.isArray(meta.sources) ? meta.sources.map((s) => ({ ref: s.ref || "", type: s.type || "" })) : [];
    relatedDraft = Array.isArray(meta.related_records) ? [...meta.related_records] : [];
    galleryDraft = Array.isArray(meta.gallery) ? meta.gallery.map((g) => ({ ...g })) : [];
    documentsDraft = Array.isArray(meta.documents) ? meta.documents.map((d) => ({ ...d })) : [];
    renderSources(); renderRelated(); renderGalleryAdmin(); renderDocumentsAdmin();
  } catch (_) { setStatus("Failed to load map.", true); }
}

async function showPreview() {
  if (!editingId) { alert("Save the map first, then Preview."); return; }
  toggleModal("map-preview-modal", true);
  const content = document.getElementById("map-preview-content");
  content.innerHTML = `<p class="text-dim">Loading…</p>`;
  try {
    const res = await fetch(`/api/records/${editingId}/preview`, { headers: authHeader() });
    if (!res.ok) throw new Error();
    const { rendered, issues } = await safeJson(res);
    const errors = issues.filter((i) => i.severity === "error");
    content.innerHTML = `
      ${errors.length ? `<div class="preview-error">
        <strong>Cannot publish — ${errors.length} blocking issue(s):</strong>
        <ul>${errors.map((e) => `<li>${escHtml(e.message)}</li>`).join("")}</ul>
      </div>` : ""}
      <h3 class="preview-title">${escHtml(rendered.title || "—")}</h3>
      <p class="text-dim mb-2">${[rendered.theater, rendered.year].filter(Boolean).join(" · ")}</p>
      ${rendered.summary ? `<p class="mb-4">${escHtml(rendered.summary.slice(0, 200))}</p>` : ""}
      <pre class="preview-json">${escHtml(JSON.stringify(rendered, null, 2))}</pre>`;
  } catch (_) {
    content.innerHTML = `<p class="text-dim">Preview unavailable.</p>`;
  }
}

async function handleSubmit(e) {
  e.preventDefault();
  const form = e.target;
  const yearVal = form.querySelector("[name='year']").value.trim();
  const body = {
    type: "MAP",
    title: form.querySelector("[name='title']").value.trim(),
    summary: form.querySelector("[name='summary']").value.trim() || undefined,
    published: form.querySelector("[name='published']").checked,
    metadata: {
      theater: form.querySelector("[name='theater']").value.trim() || undefined,
      year: yearVal ? Number(yearVal) : undefined,
      sources: sourcesDraft.filter((s) => s.ref),
      related_records: relatedDraft,
      gallery: galleryDraft.filter((g) => g.file),
      documents: documentsDraft.filter((d) => d.file),
    },
  };
  try {
    const res = await fetch(editingId ? `/api/records/${editingId}` : "/api/records", {
      method: editingId ? "PUT" : "POST",
      headers: { ...authHeader(), "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!res.ok) throw new Error();
    const saved = await safeJson(res);
    editingId = saved.id;
    translationsPanel.load(saved.id);
    setStatus("Saved.", false);
    loadRecords(currentPage);
    if (!document.getElementById("map-preview-modal")?.hidden) showPreview();
  } catch (_) { setStatus("Save failed. Try again.", true); }
}

init();
