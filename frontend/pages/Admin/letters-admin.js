import { TranslationsPanel } from "./translations-panel.js";
import { initMediaAdmin, registerCallbacks } from "./admin-media.js";
import { escHtml } from "./admin-utils.js";
import { initRelatedModal, openRelatedModal } from "./admin-related.js";
import { renderSources as renderSourcesFn, renderRelated as renderRelatedFn } from "./admin-form.js";
import { uploadFile, handleUpload, wireSectionActions, renderGallery, renderDocuments } from "./admin-media-sections.js";
import { createContentModule } from "./admin-content-module.js";

/**
 * VeteransLedger · Admin — Letters
 * Letter-specific logic only. Shared infrastructure lives in
 * admin-content-module and the pre-existing admin-utils / admin-related /
 * admin-form / admin-media(-sections) modules.
 * Note: Letters filter API uses metadata.language; generator uses
 * metadata.collection. Admin writes BOTH to the same value.
 */

const translationsPanel = new TranslationsPanel("letter-translations-panel", "record");

let _drafts = null;
let _setStatus = null;

function renderGalleryAdmin() { renderGallery("letter-gallery-list", "letter-gallery-count", _drafts.gallery, renderGalleryAdmin); }
function renderDocumentsAdmin() { renderDocuments("letter-documents-list", "letter-documents-count", _drafts.documents, renderDocumentsAdmin); }

// ── List ────────────────────────────────────────────────────────────
function renderLettersList(container, { data, total, page, pages }, { onEdit, onDelete, onPage }) {
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

  container.querySelectorAll("[data-edit]").forEach((btn) => btn.addEventListener("click", () => onEdit(btn.dataset.edit)));
  container.querySelectorAll("[data-delete]").forEach((btn) => btn.addEventListener("click", () => onDelete(btn.dataset.delete)));
  container.querySelectorAll("[data-page]").forEach((btn) => btn.addEventListener("click", () => onPage(+btn.dataset.page)));
}

// ── Form population / serialization ──────────────────────────────────
function populateForm(form, r, drafts) {
  const meta = r.metadata || {};
  form.querySelector("[name='title']").value = r.title || "";
  form.querySelector("[name='from']").value = meta.from || meta.author || "";
  form.querySelector("[name='to']").value = meta.to || "";
  form.querySelector("[name='date']").value = r.date ? r.date.slice(0, 10) : "";
  form.querySelector("[name='collection']").value = meta.collection || meta.language || "german";
  form.querySelector("[name='summary']").value = r.summary || "";
  form.querySelector("[name='full_text']").value = meta.full_text || meta.body || r.content || "";
  form.querySelector("[name='original_text']").value = meta.original_text || meta.original || "";
  form.querySelector("[name='published']").checked = !!r.published;

  drafts.sources = Array.isArray(meta.sources) ? meta.sources.map((s) => ({ ref: s.ref || "", type: s.type || "" })) : [];
  drafts.related = Array.isArray(meta.related_records) ? [...meta.related_records] : [];
  drafts.gallery = Array.isArray(meta.gallery) ? meta.gallery.map((g) => ({ ...g })) : [];
  drafts.documents = Array.isArray(meta.documents) ? meta.documents.map((d) => ({ ...d })) : [];

  // sources/related are repeatableGroups — the factory re-renders them
  // right after this function returns. Only the extraDraftKeys-based media
  // sections need rendering here.
  renderGalleryAdmin(); renderDocumentsAdmin();
}

function serializeForm(form, drafts) {
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
      original_text: form.querySelector("[name='original_text']").value.trim() || undefined,
      sources: drafts.sources.filter((s) => s.ref),
      related_records: drafts.related,
      gallery: drafts.gallery.filter((g) => g.file),
      documents: drafts.documents.filter((d) => d.file),
    },
  };

  // Always send the key (string or explicit null) rather than omitting it
  // when empty, so clearing the date on an edit actually clears it in the DB.
  const dateVal = form.querySelector("[name='date']").value.trim();
  body.date = dateVal || null;

  return body;
}

function renderPreview(rendered, issues) {
  const errors = issues.filter((i) => i.severity === "error");
  return `
    ${errors.length ? `<div class="preview-error">
      <strong>Cannot publish — ${errors.length} blocking issue(s):</strong>
      <ul>${errors.map((e) => `<li>${escHtml(e.message)}</li>`).join("")}</ul>
    </div>` : ""}
    <h3 class="preview-title">${escHtml(rendered.from || rendered.title || "—")}</h3>
    <p class="text-dim mb-3">${escHtml(rendered.collection || "")}${rendered.date ? " · " + rendered.date : ""}</p>
    <p class="mb-4">${escHtml((rendered.excerpt || "").slice(0, 200))}</p>
    <pre class="preview-json">${escHtml(JSON.stringify(rendered, null, 2))}</pre>`;
}

createContentModule({
  idPrefix: "letter",
  apiBase: "/api/letters",
  tabPanelId: "tab-letters",
  tabButtonSelector: '[data-tab="tab-letters"]',
  pageSize: 20,
  filters: [
    { param: "collection", event: "change" },
    { param: "search", event: "input", debounceMs: 350 },
  ],
  renderList: renderLettersList,
  emptyMessage: "No letters yet. Create one above.",
  translationsPanel,
  labels: { new: "New Letter", edit: "Edit Letter" },
  repeatableGroups: [
    {
      key: "sources",
      addBtnId: "letter-add-source-btn",
      render: (draft, onUpdate) => renderSourcesFn("letter-sources-list", draft, onUpdate),
      itemFactory: () => ({ ref: "", type: "" }),
    },
    {
      key: "related",
      addBtnId: "letter-add-related-btn",
      render: (draft, onUpdate) => renderRelatedFn("letter-related-list", draft, onUpdate),
      onAdd: (draft, rerender) => openRelatedModal((item) => { draft.push(item); rerender(); }),
    },
  ],
  extraDraftKeys: ["gallery", "documents"],
  populateForm,
  serializeForm,
  renderPreview,
  onInit: (drafts, { setStatus }) => {
    _drafts = drafts;
    _setStatus = setStatus;

    initMediaAdmin();
    initRelatedModal();
    registerCallbacks(uploadFile, _setStatus);

    document.getElementById("letter-gallery-upload")?.addEventListener("change", (e) => handleUpload(e.target.files, "letter-gallery-upload", drafts.gallery, renderGalleryAdmin, _setStatus));
    document.getElementById("letter-documents-upload")?.addEventListener("change", (e) => handleUpload(e.target.files, "letter-documents-upload", drafts.documents, renderDocumentsAdmin, _setStatus));

    wireSectionActions("letter", "gallery", drafts.gallery, renderGalleryAdmin, "image");
    wireSectionActions("letter", "documents", drafts.documents, renderDocumentsAdmin, "document");
  },
  onTabActivate: () => registerCallbacks(uploadFile, _setStatus),
  onFormOpen: (drafts, isNew) => {
    if (isNew) {
      renderGalleryAdmin(); renderDocumentsAdmin();
    }
  },
});
