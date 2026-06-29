import { initMediaAdmin, registerCallbacks } from "./admin-media.js";
import { authHeader, escHtml, debounce, loader, toggleModal, makeStatusFn } from "./admin-utils.js";
import { initRelatedModal, openRelatedModal } from "./admin-related.js";
import { renderSources as renderSourcesFn, renderRelated as renderRelatedFn } from "./admin-form.js";
import { uploadFile, handleUpload, wireSectionActions, renderGallery, renderDocuments } from "./admin-media-sections.js";
import { initBodyEditor, readBodyBlocks } from "./admin-body-editor.js";

/**
 * VeteransLedger · Admin — Articles
 * Article-specific logic only. Body is managed by the block editor (admin-body-editor.js)
 * which serialises to/from the metadata.body array.
 */

const KNOWN_CATEGORIES = [
  { value: "military",  label: "Military" },
  { value: "political", label: "Political" },
  { value: "economy",   label: "Economy" },
  { value: "legal",     label: "Legal" },
];

let currentPage = 1;
let editingId = null;
let sourcesDraft = [];
let relatedDraft = [];
let galleryDraft = [];
let documentsDraft = [];

const setStatus = makeStatusFn("article-form-status");

function renderSources() { renderSourcesFn("article-sources-list", sourcesDraft, renderSources); }
function renderRelated() { renderRelatedFn("article-related-list", relatedDraft, renderRelated); }
function renderGalleryAdmin() { renderGallery("article-gallery-list", "article-gallery-count", galleryDraft, renderGalleryAdmin); }
function renderDocumentsAdmin() { renderDocuments("article-documents-list", "article-documents-count", documentsDraft, renderDocumentsAdmin); }

function init() {
  initMediaAdmin();
  initRelatedModal();
  registerCallbacks(uploadFile, setStatus);

  document.getElementById("admin-tabs")?.addEventListener("click", (e) => {
    if (e.target.closest('[data-tab="tab-articles"]')) {
      registerCallbacks(uploadFile, setStatus);
      loadArticles(1);
    }
  });

  document.getElementById("article-new-btn")?.addEventListener("click", () => openForm(null));
  document.getElementById("article-cancel-btn")?.addEventListener("click", closeForm);
  document.getElementById("article-filter-category")?.addEventListener("change", () => loadArticles(1));
  document.getElementById("article-filter-search")?.addEventListener("input", debounce(() => loadArticles(1), 350));
  document.getElementById("article-form")?.addEventListener("submit", handleSubmit);
  document.getElementById("article-preview-btn")?.addEventListener("click", showPreview);
  document.getElementById("article-preview-modal-close")?.addEventListener("click", () => toggleModal("article-preview-modal", false));

  document.getElementById("article-add-source-btn")?.addEventListener("click", () => { sourcesDraft.push({ ref: "", type: "" }); renderSources(); });
  document.getElementById("article-add-related-btn")?.addEventListener("click", () =>
    openRelatedModal((item) => { relatedDraft.push(item); renderRelated(); })
  );

  document.getElementById("article-gallery-upload")?.addEventListener("change", (e) => handleUpload(e.target.files, "article-gallery-upload", galleryDraft, renderGalleryAdmin, setStatus));
  document.getElementById("article-documents-upload")?.addEventListener("change", (e) => handleUpload(e.target.files, "article-documents-upload", documentsDraft, renderDocumentsAdmin, setStatus));

  wireSectionActions("article", "gallery", galleryDraft, renderGalleryAdmin, "image");
  wireSectionActions("article", "documents", documentsDraft, renderDocumentsAdmin, "document");
}

// ── List ──────────────────────────────────────────────────────
async function loadArticles(page = 1) {
  currentPage = page;
  const container = document.getElementById("article-list");
  if (!container) return;
  container.innerHTML = loader();

  const category = document.getElementById("article-filter-category")?.value || "";
  const search = document.getElementById("article-filter-search")?.value || "";
  const params = new URLSearchParams({ page, limit: 20, ...(category && { category }), ...(search && { search }) });

  try {
    const res = await fetch(`/api/articles?${params}`, { headers: authHeader() });
    if (!res.ok) throw new Error();
    renderList(container, await res.json());
  } catch (_) {
    container.innerHTML = `<p style="color:var(--text-muted)">Articles unavailable.</p>`;
  }
}

function renderList(container, { data, total, page, pages }) {
  if (!data.length) {
    container.innerHTML = `<p style="color:var(--text-muted)">No articles yet. Create one above.</p>`;
    return;
  }
  container.innerHTML = `
    <p style="font-size:var(--text-xs);color:var(--text-muted);margin-bottom:var(--space-4);">${total} articles · page ${page} of ${pages}</p>
    <table style="width:100%;border-collapse:collapse;font-size:var(--text-sm);">
      <thead>
        <tr style="border-bottom:1px solid var(--border-dim);color:var(--text-muted);text-align:left;">
          <th style="padding:var(--space-3) var(--space-4);">Title</th>
          <th style="padding:var(--space-3) var(--space-4);">Category</th>
          <th style="padding:var(--space-3) var(--space-4);">Status</th>
          <th style="padding:var(--space-3) var(--space-4);text-align:right;">Actions</th>
        </tr>
      </thead>
      <tbody>
        ${data.map((r) => {
          const meta = r.metadata || {};
          const cat = KNOWN_CATEGORIES.find((c) => c.value === meta.category)?.label || meta.category || "—";
          return `
          <tr style="border-bottom:1px solid var(--border-dim);">
            <td style="padding:var(--space-3) var(--space-4);color:var(--text-primary);">${escHtml(r.title)}</td>
            <td style="padding:var(--space-3) var(--space-4);"><span class="badge">${escHtml(cat)}</span></td>
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
  container.querySelectorAll("[data-delete]").forEach((btn) => btn.addEventListener("click", () => deleteArticle(btn.dataset.delete)));
  container.querySelectorAll("[data-page]").forEach((btn) => btn.addEventListener("click", () => loadArticles(+btn.dataset.page)));
}

async function deleteArticle(id) {
  if (!confirm("Delete this article? This cannot be undone.")) return;
  try {
    const res = await fetch(`/api/articles/${id}`, { method: "DELETE", headers: authHeader() });
    if (!res.ok) throw new Error();
    loadArticles(currentPage);
  } catch (_) {
    alert("Delete failed. Try again.");
  }
}

// ── Form ──────────────────────────────────────────────────────
function openForm(id) {
  editingId = id;
  sourcesDraft = []; relatedDraft = []; galleryDraft = []; documentsDraft = [];
  document.getElementById("article-form")?.reset();
  document.getElementById("article-form-title").textContent = id ? "Edit Article" : "New Article";
  document.getElementById("article-form-panel").hidden = false;
  initBodyEditor("article-body-editor", []);
  renderSources(); renderRelated(); renderGalleryAdmin(); renderDocumentsAdmin();
  setStatus("", false);
  if (id) loadArticleIntoForm(id);
}

function closeForm() {
  document.getElementById("article-form-panel").hidden = true;
  editingId = null;
}

async function loadArticleIntoForm(id) {
  try {
    const res = await fetch(`/api/articles/${id}`, { headers: authHeader() });
    if (!res.ok) throw new Error();
    const r = await res.json();
    const meta = r.metadata || {};
    const form = document.getElementById("article-form");

    form.querySelector("[name='title']").value = r.title || "";
    form.querySelector("[name='category']").value = meta.category || "";
    form.querySelector("[name='summary']").value = r.summary || "";
    form.querySelector("[name='published']").checked = !!r.published;
    initBodyEditor("article-body-editor", Array.isArray(meta.body) ? meta.body : []);

    sourcesDraft = Array.isArray(meta.sources) ? meta.sources.map((s) => ({ ref: s.ref || "", type: s.type || "" })) : [];
    relatedDraft = Array.isArray(meta.related_records) ? [...meta.related_records] : [];
    galleryDraft = Array.isArray(meta.gallery) ? meta.gallery.map((g) => ({ ...g })) : [];
    documentsDraft = Array.isArray(meta.documents) ? meta.documents.map((d) => ({ ...d })) : [];

    renderSources(); renderRelated(); renderGalleryAdmin(); renderDocumentsAdmin();
  } catch (_) {
    setStatus("Failed to load article.", true);
  }
}

// ── Preview ───────────────────────────────────────────────────
async function showPreview() {
  if (!editingId) { alert("Save the article first, then Preview."); return; }
  toggleModal("article-preview-modal", true);
  const content = document.getElementById("article-preview-content");
  content.innerHTML = `<p style="color:var(--text-muted);">Loading…</p>`;
  try {
    const res = await fetch(`/api/articles/${editingId}/preview`, { headers: authHeader() });
    if (!res.ok) throw new Error();
    const { rendered, issues } = await res.json();
    const errors = issues.filter((i) => i.severity === "error");
    content.innerHTML = `
      ${errors.length ? `<div style="background:#3a1515;border:1px solid #6a2020;border-radius:4px;padding:var(--space-3);margin-bottom:var(--space-4);color:#e06060;font-size:var(--text-sm);">
        <strong>Cannot publish — ${errors.length} blocking issue(s):</strong>
        <ul style="margin:var(--space-2) 0 0 var(--space-4);">${errors.map((e) => `<li>${escHtml(e.message)}</li>`).join("")}</ul>
      </div>` : ""}
      <h3 style="font-family:var(--font-display);margin-bottom:var(--space-2);">${escHtml(rendered.title || "—")}</h3>
      <p style="color:var(--text-muted);margin-bottom:var(--space-3);">${escHtml(rendered.category || "")}</p>
      <p style="margin-bottom:var(--space-4);">${escHtml((rendered.summary || "").slice(0, 200))}</p>
      <pre style="font-size:11px;background:rgba(255,255,255,0.03);padding:var(--space-3);border-radius:4px;overflow-x:auto;">${escHtml(JSON.stringify(rendered, null, 2))}</pre>`;
  } catch (_) {
    content.innerHTML = `<p style="color:var(--text-muted);">Preview unavailable.</p>`;
  }
}

// ── Submit ────────────────────────────────────────────────────
async function handleSubmit(e) {
  e.preventDefault();
  const form = e.target;
  const body = {
    title: form.querySelector("[name='title']").value.trim(),
    summary: form.querySelector("[name='summary']").value.trim() || undefined,
    published: form.querySelector("[name='published']").checked,
    metadata: {
      category: form.querySelector("[name='category']").value || undefined,
      body: readBodyBlocks("article-body-editor"),
      sources: sourcesDraft.filter((s) => s.ref),
      related_records: relatedDraft,
      gallery: galleryDraft.filter((g) => g.file),
      documents: documentsDraft.filter((d) => d.file),
    },
  };

  try {
    const res = await fetch(editingId ? `/api/articles/${editingId}` : "/api/articles", {
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
    loadArticles(currentPage);
    if (!document.getElementById("article-preview-modal")?.hidden) showPreview();
  } catch (err) {
    setStatus(err.message || "Save failed. Try again.", true);
  }
}

init();
