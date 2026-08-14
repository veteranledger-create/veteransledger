import { TranslationsPanel } from "./translations-panel.js";
import { escHtml } from "./admin-utils.js";
import { initRelatedModal, openRelatedModal } from "./admin-related.js";
import { renderSources as renderSourcesFn, renderRelated as renderRelatedFn } from "./admin-form.js";
import { uploadFile, handleUpload, wireSectionActions, renderGallery, renderDocuments } from "./admin-media-sections.js";
import { initMediaAdmin, registerCallbacks } from "./admin-media.js";
import { createContentModule } from "./admin-content-module.js";

/**
 * VeteransLedger · Admin — Political Documents
 * Uses the generic /api/records endpoint with type=POLITICAL_DOCUMENT
 * (shared with Awards and Maps — see records.service.ts). Political-Docs-
 * specific logic only; shared infrastructure lives in admin-content-module
 * and the pre-existing admin-utils / admin-related / admin-form /
 * admin-media(-sections) modules.
 */

const translationsPanel = new TranslationsPanel("poldoc-translations-panel", "record");

let _drafts = null;
let _setStatus = null;

function renderGalleryAdmin() { renderGallery("poldoc-gallery-list", "poldoc-gallery-count", _drafts.gallery, renderGalleryAdmin); }
function renderDocumentsAdmin() { renderDocuments("poldoc-documents-list", "poldoc-documents-count", _drafts.documents, renderDocumentsAdmin); }

function renderPoldocsList(container, { data, total, page, pages }, { onEdit, onDelete, onPage }) {
  container.innerHTML = `
    <p class="list-meta">${total} documents · page ${page} of ${pages}</p>
    <table class="admin-table">
      <thead><tr>
        <th>Title</th>
        <th>Date</th>
        <th>Status</th>
        <th class="col-actions">Actions</th>
      </tr></thead>
      <tbody>
        ${data.map((r) => `
          <tr>
            <td class="td-primary">${escHtml(r.title)}</td>
            <td class="td-muted">${r.date ? r.date.slice(0, 10) : "—"}</td>
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
  container.querySelectorAll("[data-edit]").forEach((btn) => btn.addEventListener("click", () => onEdit(btn.dataset.edit)));
  container.querySelectorAll("[data-delete]").forEach((btn) => btn.addEventListener("click", () => onDelete(btn.dataset.delete)));
  container.querySelectorAll("[data-page]").forEach((btn) => btn.addEventListener("click", () => onPage(+btn.dataset.page)));
}

function populateForm(form, r, drafts) {
  const meta = r.metadata || {};
  form.querySelector("[name='title']").value = r.title || "";
  form.querySelector("[name='summary']").value = r.summary || "";
  form.querySelector("[name='signatories']").value = (meta.signatories || []).join("\n");
  form.querySelector("[name='published']").checked = !!r.published;
  const dateField = form.querySelector("[name='date']");
  if (dateField) dateField.value = r.date ? r.date.slice(0, 10) : "";

  drafts.sources = Array.isArray(meta.sources) ? meta.sources.map((s) => ({ ref: s.ref || "", type: s.type || "" })) : [];
  drafts.related = Array.isArray(meta.related_records) ? [...meta.related_records] : [];
  drafts.gallery = Array.isArray(meta.gallery) ? meta.gallery.map((g) => ({ ...g })) : [];
  drafts.documents = Array.isArray(meta.documents) ? meta.documents.map((d) => ({ ...d })) : [];

  renderGalleryAdmin(); renderDocumentsAdmin();
}

function serializeForm(form, drafts) {
  const signatoriesText = form.querySelector("[name='signatories']").value.trim();
  const signatories = signatoriesText ? signatoriesText.split("\n").map((s) => s.trim()).filter(Boolean) : [];

  const body = {
    type: "POLITICAL_DOCUMENT",
    title: form.querySelector("[name='title']").value.trim(),
    summary: form.querySelector("[name='summary']").value.trim() || undefined,
    published: form.querySelector("[name='published']").checked,
    metadata: {
      signatories: signatories.length ? signatories : undefined,
      sources: drafts.sources.filter((s) => s.ref),
      related_records: drafts.related,
      gallery: drafts.gallery.filter((g) => g.file),
      documents: drafts.documents.filter((d) => d.file),
    },
  };

  const dateVal = form.querySelector("[name='date']")?.value.trim();
  if (dateVal) body.date = dateVal;

  return body;
}

function renderPreview(rendered, issues) {
  const errors = issues.filter((i) => i.severity === "error");
  const sigs = rendered.signatories?.join(", ") || "";
  return `
    ${errors.length ? `<div class="preview-error">
      <strong>Cannot publish — ${errors.length} blocking issue(s):</strong>
      <ul>${errors.map((e) => `<li>${escHtml(e.message)}</li>`).join("")}</ul>
    </div>` : ""}
    <h3 class="preview-title">${escHtml(rendered.title || "—")}</h3>
    ${rendered.date ? `<p class="text-dim mb-1">${escHtml(rendered.date)}</p>` : ""}
    ${sigs ? `<p class="text-dim mb-3 text-sm-util">Signatories: ${escHtml(sigs)}</p>` : ""}
    ${rendered.summary ? `<p class="mb-4">${escHtml(rendered.summary.slice(0, 200))}</p>` : ""}
    <pre class="preview-json">${escHtml(JSON.stringify(rendered, null, 2))}</pre>`;
}

createContentModule({
  idPrefix: "poldoc",
  apiBase: "/api/records",
  fixedListParams: { type: "POLITICAL_DOCUMENT" },
  tabPanelId: "tab-poldocs",
  tabButtonSelector: '[data-tab="tab-poldocs"]',
  pageSize: 20,
  filters: [
    { param: "search", event: "input", debounceMs: 350 },
  ],
  renderList: renderPoldocsList,
  emptyMessage: "No political documents yet. Create one above.",
  translationsPanel,
  labels: { new: "New Political Document", edit: "Edit Political Document" },
  repeatableGroups: [
    {
      key: "sources",
      addBtnId: "poldoc-add-source-btn",
      render: (draft, onUpdate) => renderSourcesFn("poldoc-sources-list", draft, onUpdate),
      itemFactory: () => ({ ref: "", type: "" }),
    },
    {
      key: "related",
      addBtnId: "poldoc-add-related-btn",
      render: (draft, onUpdate) => renderRelatedFn("poldoc-related-list", draft, onUpdate),
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

    document.getElementById("poldoc-gallery-upload")?.addEventListener("change", (e) => handleUpload(e.target.files, "poldoc-gallery-upload", drafts.gallery, renderGalleryAdmin, _setStatus));
    document.getElementById("poldoc-documents-upload")?.addEventListener("change", (e) => handleUpload(e.target.files, "poldoc-documents-upload", drafts.documents, renderDocumentsAdmin, _setStatus));

    wireSectionActions("poldoc", "gallery", drafts.gallery, renderGalleryAdmin, "image");
    wireSectionActions("poldoc", "documents", drafts.documents, renderDocumentsAdmin, "document");
  },
  onTabActivate: () => registerCallbacks(uploadFile, _setStatus),
  onFormOpen: (drafts, isNew) => {
    if (isNew) {
      renderGalleryAdmin(); renderDocumentsAdmin();
    }
  },
});
