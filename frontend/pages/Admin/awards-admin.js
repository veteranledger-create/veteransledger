import { authHeader, escHtml, debounce, loader, toggleModal, makeStatusFn } from "./admin-utils.js";
import { initRelatedModal, openRelatedModal } from "./admin-related.js";
import { renderSources as renderSourcesFn, renderRelated as renderRelatedFn } from "./admin-form.js";
import { uploadFile, handleUpload, wireSectionActions, renderGallery, renderDocuments } from "./admin-media-sections.js";
import { initMediaAdmin, registerCallbacks } from "./admin-media.js";

/**
 * VeteransLedger · Admin — Awards & Decorations
 * Uses the generic /api/records endpoint with type=AWARD.
 */

let currentPage = 1;
let editingId = null;
let sourcesDraft = [];
let relatedDraft = [];
let galleryDraft = [];
let documentsDraft = [];

const setStatus = makeStatusFn("award-form-status");
function renderSources() { renderSourcesFn("award-sources-list", sourcesDraft, renderSources); }
function renderRelated() { renderRelatedFn("award-related-list", relatedDraft, renderRelated); }
function renderGalleryAdmin() { renderGallery("award-gallery-list", "award-gallery-count", galleryDraft, renderGalleryAdmin); }
function renderDocumentsAdmin() { renderDocuments("award-documents-list", "award-documents-count", documentsDraft, renderDocumentsAdmin); }

function init() {
  initMediaAdmin();
  initRelatedModal();
  registerCallbacks(uploadFile, setStatus);

  document.getElementById("admin-tabs")?.addEventListener("click", (e) => {
    if (e.target.closest('[data-tab="tab-awards"]')) {
      registerCallbacks(uploadFile, setStatus);
      loadRecords(1);
    }
  });

  document.getElementById("award-new-btn")?.addEventListener("click", () => openForm(null));
  document.getElementById("award-cancel-btn")?.addEventListener("click", closeForm);
  document.getElementById("award-filter-search")?.addEventListener("input", debounce(() => loadRecords(1), 350));
  document.getElementById("award-form")?.addEventListener("submit", handleSubmit);
  document.getElementById("award-preview-modal-close")?.addEventListener("click", () => toggleModal("award-preview-modal", false));
  document.getElementById("award-add-source-btn")?.addEventListener("click", () => { sourcesDraft.push({ ref: "", type: "" }); renderSources(); });
  document.getElementById("award-add-related-btn")?.addEventListener("click", () => openRelatedModal((item) => { relatedDraft.push(item); renderRelated(); }));

  document.getElementById("award-gallery-upload")?.addEventListener("change", (e) => handleUpload(e.target.files, "award-gallery-upload", galleryDraft, renderGalleryAdmin, setStatus));
  document.getElementById("award-documents-upload")?.addEventListener("change", (e) => handleUpload(e.target.files, "award-documents-upload", documentsDraft, renderDocumentsAdmin, setStatus));
  wireSectionActions("award", "gallery", galleryDraft, renderGalleryAdmin, "image");
  wireSectionActions("award", "documents", documentsDraft, renderDocumentsAdmin, "document");
}

async function loadRecords(page = 1) {
  currentPage = page;
  const container = document.getElementById("award-list");
  if (!container) return;
  container.innerHTML = loader();
  const search = document.getElementById("award-filter-search")?.value || "";
  const params = new URLSearchParams({ type: "AWARD", page, limit: 20, ...(search && { search }) });
  try {
    const res = await fetch(`/api/records?${params}`, { headers: authHeader() });
    if (!res.ok) throw new Error();
    renderList(container, await res.json());
  } catch (_) {
    container.innerHTML = `<p style="color:var(--text-muted)">Awards unavailable.</p>`;
  }
}

function renderList(container, { data, total, page, pages }) {
  if (!data.length) { container.innerHTML = `<p style="color:var(--text-muted)">No awards yet. Create one above.</p>`; return; }
  container.innerHTML = `
    <p style="font-size:var(--text-xs);color:var(--text-muted);margin-bottom:var(--space-4);">${total} awards · page ${page} of ${pages}</p>
    <table style="width:100%;border-collapse:collapse;font-size:var(--text-sm);">
      <thead><tr style="border-bottom:1px solid var(--border-dim);color:var(--text-muted);text-align:left;">
        <th style="padding:var(--space-3) var(--space-4);">Title</th>
        <th style="padding:var(--space-3) var(--space-4);">Status</th>
        <th style="padding:var(--space-3) var(--space-4);text-align:right;">Actions</th>
      </tr></thead>
      <tbody>
        ${data.map((r) => `
          <tr style="border-bottom:1px solid var(--border-dim);">
            <td style="padding:var(--space-3) var(--space-4);color:var(--text-primary);">${escHtml(r.title)}</td>
            <td style="padding:var(--space-3) var(--space-4);">${r.published ? '<span style="color:#60c060;">Published</span>' : '<span style="color:var(--text-muted);">Draft</span>'}</td>
            <td style="padding:var(--space-3) var(--space-4);text-align:right;display:flex;gap:var(--space-2);justify-content:flex-end;">
              <button class="btn btn-secondary" style="padding:4px var(--space-3);font-size:11px;" data-edit="${r.id}">Edit</button>
              <button class="btn btn-secondary" style="padding:4px var(--space-3);font-size:11px;color:#e06060;border-color:#4a1515;" data-delete="${r.id}">Delete</button>
            </td>
          </tr>`).join("")}
      </tbody>
    </table>
    ${pages > 1 ? `<div style="display:flex;gap:var(--space-2);margin-top:var(--space-5);">
      ${page > 1 ? `<button class="btn btn-secondary" data-page="${page - 1}">← Prev</button>` : ""}
      ${page < pages ? `<button class="btn btn-secondary" data-page="${page + 1}">Next →</button>` : ""}
    </div>` : ""}`;
  container.querySelectorAll("[data-edit]").forEach((btn) => btn.addEventListener("click", () => openForm(btn.dataset.edit)));
  container.querySelectorAll("[data-delete]").forEach((btn) => btn.addEventListener("click", () => deleteRecord(btn.dataset.delete)));
  container.querySelectorAll("[data-page]").forEach((btn) => btn.addEventListener("click", () => loadRecords(+btn.dataset.page)));
}

async function deleteRecord(id) {
  if (!confirm("Delete this award? This cannot be undone.")) return;
  try {
    const res = await fetch(`/api/records/${id}`, { method: "DELETE", headers: authHeader() });
    if (!res.ok) throw new Error();
    loadRecords(currentPage);
  } catch (_) { alert("Delete failed. Try again."); }
}

function openForm(id) {
  editingId = id;
  sourcesDraft = []; relatedDraft = []; galleryDraft = []; documentsDraft = [];
  document.getElementById("award-form")?.reset();
  document.getElementById("award-form-title").textContent = id ? "Edit Award" : "New Award";
  document.getElementById("award-form-panel").hidden = false;
  renderSources(); renderRelated(); renderGalleryAdmin(); renderDocumentsAdmin();
  setStatus("", false);
  if (id) loadIntoForm(id);
}

function closeForm() {
  document.getElementById("award-form-panel").hidden = true;
  editingId = null;
}

async function loadIntoForm(id) {
  try {
    const res = await fetch(`/api/records/${id}`, { headers: authHeader() });
    if (!res.ok) throw new Error();
    const r = await res.json();
    const meta = r.metadata || {};
    const form = document.getElementById("award-form");
    form.querySelector("[name='title']").value = r.title || "";
    form.querySelector("[name='summary']").value = r.summary || "";
    form.querySelector("[name='nation']").value = meta.nation || r.nationality || "";
    form.querySelector("[name='published']").checked = !!r.published;
    sourcesDraft = Array.isArray(meta.sources) ? meta.sources.map((s) => ({ ref: s.ref || "", type: s.type || "" })) : [];
    relatedDraft = Array.isArray(meta.related_records) ? [...meta.related_records] : [];
    galleryDraft = Array.isArray(meta.gallery) ? meta.gallery.map((g) => ({ ...g })) : [];
    documentsDraft = Array.isArray(meta.documents) ? meta.documents.map((d) => ({ ...d })) : [];
    renderSources(); renderRelated(); renderGalleryAdmin(); renderDocumentsAdmin();
  } catch (_) { setStatus("Failed to load award.", true); }
}

async function handleSubmit(e) {
  e.preventDefault();
  const form = e.target;
  const body = {
    type: "AWARD",
    title: form.querySelector("[name='title']").value.trim(),
    summary: form.querySelector("[name='summary']").value.trim() || undefined,
    published: form.querySelector("[name='published']").checked,
    metadata: {
      nation: form.querySelector("[name='nation']").value.trim() || undefined,
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
    const saved = await res.json();
    editingId = saved.id;
    setStatus("Saved.", false);
    loadRecords(currentPage);
  } catch (_) { setStatus("Save failed. Try again.", true); }
}

init();
