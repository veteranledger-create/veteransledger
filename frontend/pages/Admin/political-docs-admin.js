import { authHeader, escHtml, debounce, loader, toggleModal, makeStatusFn } from "./admin-utils.js";
import { initRelatedModal, openRelatedModal } from "./admin-related.js";
import { renderSources as renderSourcesFn, renderRelated as renderRelatedFn } from "./admin-form.js";
import { uploadFile, handleUpload, wireSectionActions, renderGallery, renderDocuments } from "./admin-media-sections.js";
import { initMediaAdmin, registerCallbacks } from "./admin-media.js";

/**
 * VeteransLedger · Admin — Political Documents
 * Uses the generic /api/records endpoint with type=POLITICAL_DOCUMENT.
 */

let currentPage = 1;
let editingId = null;
let sourcesDraft = [];
let relatedDraft = [];
let galleryDraft = [];
let documentsDraft = [];

const setStatus = makeStatusFn("poldoc-form-status");
function renderSources() { renderSourcesFn("poldoc-sources-list", sourcesDraft, renderSources); }
function renderRelated() { renderRelatedFn("poldoc-related-list", relatedDraft, renderRelated); }
function renderGalleryAdmin() { renderGallery("poldoc-gallery-list", "poldoc-gallery-count", galleryDraft, renderGalleryAdmin); }
function renderDocumentsAdmin() { renderDocuments("poldoc-documents-list", "poldoc-documents-count", documentsDraft, renderDocumentsAdmin); }

function init() {
  initMediaAdmin();
  initRelatedModal();
  registerCallbacks(uploadFile, setStatus);

  document.getElementById("admin-tabs")?.addEventListener("click", (e) => {
    if (e.target.closest('[data-tab="tab-poldocs"]')) {
      registerCallbacks(uploadFile, setStatus);
      loadRecords(1);
    }
  });

  document.getElementById("poldoc-new-btn")?.addEventListener("click", () => openForm(null));
  document.getElementById("poldoc-cancel-btn")?.addEventListener("click", closeForm);
  document.getElementById("poldoc-filter-search")?.addEventListener("input", debounce(() => loadRecords(1), 350));
  document.getElementById("poldoc-form")?.addEventListener("submit", handleSubmit);
  document.getElementById("poldoc-preview-btn")?.addEventListener("click", showPreview);
  document.getElementById("poldoc-preview-modal-close")?.addEventListener("click", () => toggleModal("poldoc-preview-modal", false));
  document.getElementById("poldoc-add-source-btn")?.addEventListener("click", () => { sourcesDraft.push({ ref: "", type: "" }); renderSources(); });
  document.getElementById("poldoc-add-related-btn")?.addEventListener("click", () => openRelatedModal((item) => { relatedDraft.push(item); renderRelated(); }));

  document.getElementById("poldoc-gallery-upload")?.addEventListener("change", (e) => handleUpload(e.target.files, "poldoc-gallery-upload", galleryDraft, renderGalleryAdmin, setStatus));
  document.getElementById("poldoc-documents-upload")?.addEventListener("change", (e) => handleUpload(e.target.files, "poldoc-documents-upload", documentsDraft, renderDocumentsAdmin, setStatus));
  wireSectionActions("poldoc", "gallery", galleryDraft, renderGalleryAdmin, "image");
  wireSectionActions("poldoc", "documents", documentsDraft, renderDocumentsAdmin, "document");
}

async function loadRecords(page = 1) {
  currentPage = page;
  const container = document.getElementById("poldoc-list");
  if (!container) return;
  container.innerHTML = loader();
  const search = document.getElementById("poldoc-filter-search")?.value || "";
  const params = new URLSearchParams({ type: "POLITICAL_DOCUMENT", page, limit: 20, ...(search && { search }) });
  try {
    const res = await fetch(`/api/records?${params}`, { headers: authHeader() });
    if (!res.ok) throw new Error();
    renderList(container, await res.json());
  } catch (_) {
    container.innerHTML = `<p style="color:var(--text-muted)">Political documents unavailable.</p>`;
  }
}

function renderList(container, { data, total, page, pages }) {
  if (!data.length) { container.innerHTML = `<p style="color:var(--text-muted)">No political documents yet. Create one above.</p>`; return; }
  container.innerHTML = `
    <p style="font-size:var(--text-xs);color:var(--text-muted);margin-bottom:var(--space-4);">${total} documents · page ${page} of ${pages}</p>
    <table style="width:100%;border-collapse:collapse;font-size:var(--text-sm);">
      <thead><tr style="border-bottom:1px solid var(--border-dim);color:var(--text-muted);text-align:left;">
        <th style="padding:var(--space-3) var(--space-4);">Title</th>
        <th style="padding:var(--space-3) var(--space-4);">Date</th>
        <th style="padding:var(--space-3) var(--space-4);">Status</th>
        <th style="padding:var(--space-3) var(--space-4);text-align:right;">Actions</th>
      </tr></thead>
      <tbody>
        ${data.map((r) => `
          <tr style="border-bottom:1px solid var(--border-dim);">
            <td style="padding:var(--space-3) var(--space-4);color:var(--text-primary);">${escHtml(r.title)}</td>
            <td style="padding:var(--space-3) var(--space-4);color:var(--text-muted);">${r.date ? r.date.slice(0, 10) : "—"}</td>
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
  if (!confirm("Delete this document? This cannot be undone.")) return;
  try {
    const res = await fetch(`/api/records/${id}`, { method: "DELETE", headers: authHeader() });
    if (!res.ok) throw new Error();
    loadRecords(currentPage);
  } catch (_) { alert("Delete failed. Try again."); }
}

function openForm(id) {
  editingId = id;
  sourcesDraft = []; relatedDraft = []; galleryDraft = []; documentsDraft = [];
  document.getElementById("poldoc-form")?.reset();
  document.getElementById("poldoc-form-title").textContent = id ? "Edit Political Document" : "New Political Document";
  document.getElementById("poldoc-form-panel").hidden = false;
  renderSources(); renderRelated(); renderGalleryAdmin(); renderDocumentsAdmin();
  setStatus("", false);
  if (id) loadIntoForm(id);
}

function closeForm() {
  document.getElementById("poldoc-form-panel").hidden = true;
  editingId = null;
}

async function loadIntoForm(id) {
  try {
    const res = await fetch(`/api/records/${id}`, { headers: authHeader() });
    if (!res.ok) throw new Error();
    const r = await res.json();
    const meta = r.metadata || {};
    const form = document.getElementById("poldoc-form");
    form.querySelector("[name='title']").value = r.title || "";
    form.querySelector("[name='summary']").value = r.summary || "";
    form.querySelector("[name='signatories']").value = (meta.signatories || []).join("\n");
    form.querySelector("[name='published']").checked = !!r.published;
    const dateVal = r.date ? r.date.slice(0, 10) : "";
    if (form.querySelector("[name='date']")) form.querySelector("[name='date']").value = dateVal;
    sourcesDraft = Array.isArray(meta.sources) ? meta.sources.map((s) => ({ ref: s.ref || "", type: s.type || "" })) : [];
    relatedDraft = Array.isArray(meta.related_records) ? [...meta.related_records] : [];
    galleryDraft = Array.isArray(meta.gallery) ? meta.gallery.map((g) => ({ ...g })) : [];
    documentsDraft = Array.isArray(meta.documents) ? meta.documents.map((d) => ({ ...d })) : [];
    renderSources(); renderRelated(); renderGalleryAdmin(); renderDocumentsAdmin();
  } catch (_) { setStatus("Failed to load document.", true); }
}

async function showPreview() {
  if (!editingId) { alert("Save the document first, then Preview."); return; }
  toggleModal("poldoc-preview-modal", true);
  const content = document.getElementById("poldoc-preview-content");
  content.innerHTML = `<p style="color:var(--text-muted);">Loading…</p>`;
  try {
    const res = await fetch(`/api/records/${editingId}/preview`, { headers: authHeader() });
    if (!res.ok) throw new Error();
    const { rendered, issues } = await res.json();
    const errors = issues.filter((i) => i.severity === "error");
    const sigs = rendered.signatories?.join(", ") || "";
    content.innerHTML = `
      ${errors.length ? `<div style="background:#3a1515;border:1px solid #6a2020;border-radius:4px;padding:var(--space-3);margin-bottom:var(--space-4);color:#e06060;font-size:var(--text-sm);">
        <strong>Cannot publish — ${errors.length} blocking issue(s):</strong>
        <ul style="margin:var(--space-2) 0 0 var(--space-4);">${errors.map((e) => `<li>${escHtml(e.message)}</li>`).join("")}</ul>
      </div>` : ""}
      <h3 style="font-family:var(--font-display);margin-bottom:var(--space-2);">${escHtml(rendered.title || "—")}</h3>
      ${rendered.date ? `<p style="color:var(--text-muted);margin-bottom:var(--space-1);">${escHtml(rendered.date)}</p>` : ""}
      ${sigs ? `<p style="color:var(--text-muted);margin-bottom:var(--space-3);font-size:var(--text-sm);">Signatories: ${escHtml(sigs)}</p>` : ""}
      ${rendered.summary ? `<p style="margin-bottom:var(--space-4);">${escHtml(rendered.summary.slice(0, 200))}</p>` : ""}
      <pre style="font-size:11px;background:rgba(255,255,255,0.03);padding:var(--space-3);border-radius:4px;overflow-x:auto;">${escHtml(JSON.stringify(rendered, null, 2))}</pre>`;
  } catch (_) {
    content.innerHTML = `<p style="color:var(--text-muted);">Preview unavailable.</p>`;
  }
}

async function handleSubmit(e) {
  e.preventDefault();
  const form = e.target;
  const signatoriesText = form.querySelector("[name='signatories']").value.trim();
  const signatories = signatoriesText ? signatoriesText.split("\n").map((s) => s.trim()).filter(Boolean) : [];
  const body = {
    type: "POLITICAL_DOCUMENT",
    title: form.querySelector("[name='title']").value.trim(),
    summary: form.querySelector("[name='summary']").value.trim() || undefined,
    published: form.querySelector("[name='published']").checked,
    metadata: {
      signatories: signatories.length ? signatories : undefined,
      sources: sourcesDraft.filter((s) => s.ref),
      related_records: relatedDraft,
      gallery: galleryDraft.filter((g) => g.file),
      documents: documentsDraft.filter((d) => d.file),
    },
  };
  const dateVal = form.querySelector("[name='date']")?.value.trim();
  if (dateVal) body.date = dateVal;
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
    if (!document.getElementById("poldoc-preview-modal")?.hidden) showPreview();
  } catch (_) { setStatus("Save failed. Try again.", true); }
}

init();
