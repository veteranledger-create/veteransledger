import { TranslationsPanel } from "./translations-panel.js";
import { escHtml } from "./admin-utils.js";
import { initRelatedModal, openRelatedModal } from "./admin-related.js";
import { renderSources as renderSourcesFn, renderRelated as renderRelatedFn } from "./admin-form.js";
import { uploadFile, handleUpload, wireSectionActions, renderGallery, renderDocuments } from "./admin-media-sections.js";
import { initMediaAdmin, registerCallbacks } from "./admin-media.js";
import { initBodyEditor, readBodyBlocks } from "./admin-body-editor.js";
import { createContentModule } from "./admin-content-module.js";

/**
 * VeteransLedger · Admin — Articles
 * Article-specific logic only. Body is managed by the block editor
 * (admin-body-editor.js), which has no `name` attributes and so is invisible
 * to FormData-based dirty-tracking — same gap Personnel's biography editor
 * had, fixed the same way here via snapshotExtra(). Shared infrastructure
 * lives in admin-content-module and the pre-existing admin-utils /
 * admin-related / admin-form / admin-media(-sections) / admin-body-editor
 * modules.
 */

const KNOWN_CATEGORIES = [
  { value: "military",  label: "Military" },
  { value: "political", label: "Political" },
  { value: "economy",   label: "Economy" },
  { value: "legal",     label: "Legal" },
];

const translationsPanel = new TranslationsPanel("article-translations-panel", "record");

let _drafts = null;
let _setStatus = null;

function renderGalleryAdmin() { renderGallery("article-gallery-list", "article-gallery-count", _drafts.gallery, renderGalleryAdmin); }
function renderDocumentsAdmin() { renderDocuments("article-documents-list", "article-documents-count", _drafts.documents, renderDocumentsAdmin); }

function renderArticlesList(container, { data, total, page, pages }, { onEdit, onDelete, onPage }) {
  container.innerHTML = `
    <p class="list-meta">${total} articles · page ${page} of ${pages}</p>
    <table class="admin-table">
      <thead><tr>
        <th>Title</th>
        <th>Category</th>
        <th>Status</th>
        <th class="col-actions">Actions</th>
      </tr></thead>
      <tbody>
        ${data.map((r) => {
          const meta = r.metadata || {};
          const cat = KNOWN_CATEGORIES.find((c) => c.value === meta.category)?.label || meta.category || "—";
          return `
          <tr>
            <td class="td-primary">${escHtml(r.title)}</td>
            <td><span class="badge">${escHtml(cat)}</span></td>
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
  container.querySelectorAll("[data-edit]").forEach((btn) => btn.addEventListener("click", () => onEdit(btn.dataset.edit)));
  container.querySelectorAll("[data-delete]").forEach((btn) => btn.addEventListener("click", () => onDelete(btn.dataset.delete)));
  container.querySelectorAll("[data-page]").forEach((btn) => btn.addEventListener("click", () => onPage(+btn.dataset.page)));
}

function populateForm(form, r, drafts) {
  const meta = r.metadata || {};
  form.querySelector("[name='title']").value = r.title || "";
  form.querySelector("[name='category']").value = meta.category || "";
  form.querySelector("[name='summary']").value = r.summary || "";
  form.querySelector("[name='published']").checked = !!r.published;
  initBodyEditor("article-body-editor", Array.isArray(meta.body) ? meta.body : []);

  drafts.sources = Array.isArray(meta.sources) ? meta.sources.map((s) => ({ ref: s.ref || "", type: s.type || "" })) : [];
  drafts.related = Array.isArray(meta.related_records) ? [...meta.related_records] : [];
  drafts.gallery = Array.isArray(meta.gallery) ? meta.gallery.map((g) => ({ ...g })) : [];
  drafts.documents = Array.isArray(meta.documents) ? meta.documents.map((d) => ({ ...d })) : [];

  renderGalleryAdmin(); renderDocumentsAdmin();
}

function serializeForm(form, drafts) {
  return {
    title: form.querySelector("[name='title']").value.trim(),
    summary: form.querySelector("[name='summary']").value.trim() || undefined,
    published: form.querySelector("[name='published']").checked,
    metadata: {
      category: form.querySelector("[name='category']").value || undefined,
      body: readBodyBlocks("article-body-editor"),
      sources: drafts.sources.filter((s) => s.ref),
      related_records: drafts.related,
      gallery: drafts.gallery.filter((g) => g.file),
      documents: drafts.documents.filter((d) => d.file),
    },
  };
}

function renderPreview(rendered, issues) {
  const errors = issues.filter((i) => i.severity === "error");
  return `
    ${errors.length ? `<div class="preview-error">
      <strong>Cannot publish — ${errors.length} blocking issue(s):</strong>
      <ul>${errors.map((e) => `<li>${escHtml(e.message)}</li>`).join("")}</ul>
    </div>` : ""}
    <h3 class="preview-title">${escHtml(rendered.title || "—")}</h3>
    <p class="text-dim mb-3">${escHtml(rendered.category || "")}</p>
    <p class="mb-4">${escHtml((rendered.summary || "").slice(0, 200))}</p>
    <pre class="preview-json">${escHtml(JSON.stringify(rendered, null, 2))}</pre>`;
}

createContentModule({
  idPrefix: "article",
  apiBase: "/api/articles",
  tabPanelId: "tab-articles",
  tabButtonSelector: '[data-tab="tab-articles"]',
  pageSize: 20,
  filters: [
    { param: "category", event: "change" },
    { param: "search", event: "input", debounceMs: 350 },
  ],
  renderList: renderArticlesList,
  emptyMessage: "No articles yet. Create one above.",
  translationsPanel,
  labels: { new: "New Article", edit: "Edit Article" },
  repeatableGroups: [
    {
      key: "sources",
      addBtnId: "article-add-source-btn",
      render: (draft, onUpdate) => renderSourcesFn("article-sources-list", draft, onUpdate),
      itemFactory: () => ({ ref: "", type: "" }),
    },
    {
      key: "related",
      addBtnId: "article-add-related-btn",
      render: (draft, onUpdate) => renderRelatedFn("article-related-list", draft, onUpdate),
      onAdd: (draft, rerender) => openRelatedModal((item) => { draft.push(item); rerender(); }),
    },
  ],
  extraDraftKeys: ["gallery", "documents"],
  populateForm,
  serializeForm,
  renderPreview,
  // The block editor has no `name` attributes at all, so FormData-based
  // dirty-tracking can't see it — without this, editing the body would
  // silently not register as unsaved changes (same gap fixed for Personnel's
  // biography editor in Batch 1).
  snapshotExtra: () => ({
    body: JSON.stringify(readBodyBlocks("article-body-editor")),
  }),
  onInit: (drafts, { setStatus }) => {
    _drafts = drafts;
    _setStatus = setStatus;

    initMediaAdmin();
    initRelatedModal();
    registerCallbacks(uploadFile, _setStatus);

    document.getElementById("article-gallery-upload")?.addEventListener("change", (e) => handleUpload(e.target.files, "article-gallery-upload", drafts.gallery, renderGalleryAdmin, _setStatus));
    document.getElementById("article-documents-upload")?.addEventListener("change", (e) => handleUpload(e.target.files, "article-documents-upload", drafts.documents, renderDocumentsAdmin, _setStatus));

    // Getter form (not a direct array reference): openForm()/populateForm()
    // replace drafts.gallery/drafts.documents with a new array on every
    // open, which would otherwise leave these buttons bound to a stale,
    // disconnected array after the first form-open (see the getter-support
    // fix added to wireSectionActions in admin-media-sections.js).
    wireSectionActions("article", "gallery", () => drafts.gallery, renderGalleryAdmin, "image");
    wireSectionActions("article", "documents", () => drafts.documents, renderDocumentsAdmin, "document");
  },
  onTabActivate: () => registerCallbacks(uploadFile, _setStatus),
  onFormOpen: (drafts, isNew) => {
    if (isNew) {
      initBodyEditor("article-body-editor", []);
      renderGalleryAdmin(); renderDocumentsAdmin();
    }
  },
});
