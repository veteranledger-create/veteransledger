import { initMediaAdmin, registerCallbacks } from "./admin-media.js";
import { authHeader, escHtml, debounce, loader, toggleModal, makeStatusFn } from "./admin-utils.js";
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
    renderList(container, await res.json());
  } catch (_) {
    container.innerHTML = `<p style="color:var(--text-muted)">Letters unavailable.</p>`;
  }
}

function renderList(container, { data, total, page, pages }) {
  if (!data.length) {
    container.innerHTML = `<p style="color:var(--text-muted)">No letters yet. Create one above.</p>`;
    return;
  }
  container.innerHTML = `
    <p style="font-size:var(--text-xs);color:var(--text-muted);margin-bottom:var(--space-4);">${total} letters · page ${page} of ${pages}</p>
    <table style="width:100%;border-collapse:collapse;font-size:var(--text-sm);">
      <thead>
        <tr style="border-bottom:1px solid var(--border-dim);color:var(--text-muted);text-align:left;">
          <th style="padding:var(--space-3) var(--space-4);">Sender / Title</th>
          <th style="padding:var(--space-3) var(--space-4);">Collection</th>
          <th style="padding:var(--space-3) var(--space-4);">Date</th>
          <th style="padding:var(--space-3) var(--space-4);">Status</th>
          <th style="padding:var(--space-3) var(--space-4);text-align:right;">Actions</th>
        </tr>
      </thead>
      <tbody>
        ${data.map((r) => {
          const meta = r.metadata || {};
          const sender = meta.from || meta.author || r.title || "—";
          const collection = meta.collection || meta.language || "german";
          return `
          <tr style="border-bottom:1px solid var(--border-dim);">
            <td style="padding:var(--space-3) var(--space-4);color:var(--text-primary);">${escHtml(sender)}</td>
            <td style="padding:var(--space-3) var(--space-4);"><span class="badge">${escHtml(collection)}</span></td>
            <td style="padding:var(--space-3) var(--space-4);color:var(--text-muted);">${r.date ? r.date.slice(0, 10) : "—"}</td>
            <td style="padding:var(--space-3) var(--space-4);">${r.published ? '<span style="color:#60c060;">Published</span>' : '<span style="color:var(--text-muted);">Draft</span>'}</td>
            <td style="padding:var(--space-3) var(--space-4);text-align:right;display:flex;gap:var(--space-2);justify-content:flex-end;">
              <button class="btn btn-secondary" style="padding:4px var(--space-3);font-size:11px;" data-edit="${r.id}">Edit</button>
              <button class="btn btn-secondary" style="padding:4px var(--space-3);font-size:11px;color:#e06060;border-color:#4a1515;" data-delete="${r.id}">Delete</button>
            </td>
          </tr>`;
        }).join("")}
      </tbody>
    </table>
    ${pages > 1 ? `<div style="display:flex;gap:var(--space-2);margin-top:var(--space-5);">
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
  if (id) loadLetterIntoForm(id);
}

function closeForm() {
  document.getElementById("letter-form-panel").hidden = true;
  editingId = null;
}

async function loadLetterIntoForm(id) {
  try {
    const res = await fetch(`/api/letters/${id}`, { headers: authHeader() });
    if (!res.ok) throw new Error();
    const r = await res.json();
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
  content.innerHTML = `<p style="color:var(--text-muted);">Loading…</p>`;
  try {
    const res = await fetch(`/api/letters/${editingId}/preview`, { headers: authHeader() });
    if (!res.ok) throw new Error();
    const { rendered, issues } = await res.json();
    const errors = issues.filter((i) => i.severity === "error");
    content.innerHTML = `
      ${errors.length ? `<div style="background:#3a1515;border:1px solid #6a2020;border-radius:4px;padding:var(--space-3);margin-bottom:var(--space-4);color:#e06060;font-size:var(--text-sm);">
        <strong>Cannot publish — ${errors.length} blocking issue(s):</strong>
        <ul style="margin:var(--space-2) 0 0 var(--space-4);">${errors.map((e) => `<li>${escHtml(e.message)}</li>`).join("")}</ul>
      </div>` : ""}
      <h3 style="font-family:var(--font-display);margin-bottom:var(--space-2);">${escHtml(rendered.from || rendered.title || "—")}</h3>
      <p style="color:var(--text-muted);margin-bottom:var(--space-3);">${escHtml(rendered.collection || "")}${rendered.date ? " · " + rendered.date : ""}</p>
      <p style="margin-bottom:var(--space-4);">${escHtml((rendered.excerpt || "").slice(0, 200))}</p>
      <pre style="font-size:11px;background:rgba(255,255,255,0.03);padding:var(--space-3);border-radius:4px;overflow-x:auto;">${escHtml(JSON.stringify(rendered, null, 2))}</pre>`;
  } catch (_) {
    content.innerHTML = `<p style="color:var(--text-muted);">Preview unavailable.</p>`;
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
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error || "Save failed.");
    }
    const saved = await res.json();
    editingId = saved.id;
    setStatus("Saved.", false);
    loadLetters(currentPage);
    if (!document.getElementById("letter-preview-modal")?.hidden) showPreview();
  } catch (err) {
    setStatus(err.message || "Save failed. Try again.", true);
  }
}

init();
