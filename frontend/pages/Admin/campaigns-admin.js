import { TranslationsPanel } from "./translations-panel.js";
import { escHtml } from "./admin-utils.js";
import { initRelatedModal, openRelatedModal } from "./admin-related.js";
import { renderSources as renderSourcesFn, renderRelated as renderRelatedFn } from "./admin-form.js";
import { uploadFile, handleUpload, wireSectionActions, renderGallery, renderDocuments } from "./admin-media-sections.js";
import { initMediaAdmin, registerCallbacks } from "./admin-media.js";
import { createContentModule } from "./admin-content-module.js";

/**
 * VeteransLedger · Admin — Campaigns
 * Campaign-specific logic only. Dates are stored in both top-level Prisma
 * columns (for orderBy) and metadata.dates (for conformance + generator) —
 * preserved as-is from the pre-migration implementation. Shared
 * infrastructure lives in admin-content-module and the pre-existing
 * admin-utils / admin-related / admin-form / admin-media(-sections) modules.
 */

const KNOWN_THEATERS = [
  { value: "africa",        label: "North Africa" },
  { value: "atlantic",      label: "Atlantic" },
  { value: "eastern-front", label: "Eastern Front" },
  { value: "italy",         label: "Italy" },
  { value: "western-front", label: "Western Front" },
];

const translationsPanel = new TranslationsPanel("campaign-translations-panel", "record");

let _drafts = null;
let _setStatus = null;

function renderGalleryAdmin() { renderGallery("campaign-gallery-list", "campaign-gallery-count", _drafts.gallery, renderGalleryAdmin); }
function renderDocumentsAdmin() { renderDocuments("campaign-documents-list", "campaign-documents-count", _drafts.documents, renderDocumentsAdmin); }

function renderCampaignsList(container, { data, total, page, pages }, { onEdit, onDelete, onPage }) {
  container.innerHTML = `
    <p class="list-meta">${total} campaigns · page ${page} of ${pages}</p>
    <table class="admin-table">
      <thead><tr>
        <th>Title</th>
        <th>Theater</th>
        <th>Start</th>
        <th>Status</th>
        <th class="col-actions">Actions</th>
      </tr></thead>
      <tbody>
        ${data.map((r) => {
          const meta = r.metadata || {};
          const theater = KNOWN_THEATERS.find((t) => t.value === meta.theater)?.label || meta.theater || "—";
          const start = r.startDate ? r.startDate.slice(0, 10) : (meta.dates?.start || "—");
          return `
          <tr>
            <td class="td-primary">${escHtml(r.title)}</td>
            <td><span class="badge">${escHtml(theater)}</span></td>
            <td class="td-muted">${escHtml(start)}</td>
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
  form.querySelector("[name='theater']").value = meta.theater || "";
  form.querySelector("[name='startDate']").value = r.startDate ? r.startDate.slice(0, 10) : (meta.dates?.start || "");
  form.querySelector("[name='endDate']").value = r.endDate ? r.endDate.slice(0, 10) : (meta.dates?.end || "");
  form.querySelector("[name='summary']").value = r.summary || "";
  form.querySelector("[name='context']").value = meta.context || "";
  form.querySelector("[name='significance']").value = meta.significance || "";
  form.querySelector("[name='outcome']").value = meta.outcome || "";
  form.querySelector("[name='published']").checked = !!r.published;

  drafts.sources = Array.isArray(meta.sources) ? meta.sources.map((s) => ({ ref: s.ref || "", type: s.type || "" })) : [];
  drafts.related = Array.isArray(meta.related_records) ? [...meta.related_records] : [];
  drafts.gallery = Array.isArray(meta.gallery) ? meta.gallery.map((g) => ({ ...g })) : [];
  drafts.documents = Array.isArray(meta.documents) ? meta.documents.map((d) => ({ ...d })) : [];

  renderGalleryAdmin(); renderDocumentsAdmin();
}

function serializeForm(form, drafts) {
  const startDateVal = form.querySelector("[name='startDate']").value.trim();
  const endDateVal = form.querySelector("[name='endDate']").value.trim();
  const theaterVal = form.querySelector("[name='theater']").value;

  const body = {
    title: form.querySelector("[name='title']").value.trim(),
    summary: form.querySelector("[name='summary']").value.trim() || undefined,
    published: form.querySelector("[name='published']").checked,
    metadata: {
      theater: theaterVal || undefined,
      dates: { start: startDateVal || null, end: endDateVal || null },
      context: form.querySelector("[name='context']").value.trim() || undefined,
      significance: form.querySelector("[name='significance']").value.trim() || undefined,
      outcome: form.querySelector("[name='outcome']").value.trim() || undefined,
      sources: drafts.sources.filter((s) => s.ref),
      related_records: drafts.related,
      gallery: drafts.gallery.filter((g) => g.file),
      documents: drafts.documents.filter((d) => d.file),
    },
  };

  // Always send the key (string or explicit null) rather than omitting it
  // when empty, so clearing a date on an edit actually clears it in the DB.
  body.startDate = startDateVal || null;
  body.endDate = endDateVal || null;

  return body;
}

function renderPreview(rendered, issues) {
  const errors = issues.filter((i) => i.severity === "error");
  const dates = rendered.dates || {};
  return `
    ${errors.length ? `<div class="preview-error">
      <strong>Cannot publish — ${errors.length} blocking issue(s):</strong>
      <ul>${errors.map((e) => `<li>${escHtml(e.message)}</li>`).join("")}</ul>
    </div>` : ""}
    <h3 class="preview-title">${escHtml(rendered.title || "—")}</h3>
    <p class="text-dim mb-1">${escHtml(rendered.theater || "")}${dates.start ? " · " + dates.start : ""}</p>
    <p class="mb-4">${escHtml((rendered.summary || "").slice(0, 200))}</p>
    <pre class="preview-json">${escHtml(JSON.stringify(rendered, null, 2))}</pre>`;
}

createContentModule({
  idPrefix: "campaign",
  apiBase: "/api/campaigns",
  tabPanelId: "tab-campaigns",
  tabButtonSelector: '[data-tab="tab-campaigns"]',
  pageSize: 20,
  filters: [
    { param: "theater", event: "change" },
    { param: "search", event: "input", debounceMs: 350 },
  ],
  renderList: renderCampaignsList,
  emptyMessage: "No campaigns yet. Create one above.",
  translationsPanel,
  labels: { new: "New Campaign", edit: "Edit Campaign" },
  repeatableGroups: [
    {
      key: "sources",
      addBtnId: "campaign-add-source-btn",
      render: (draft, onUpdate) => renderSourcesFn("campaign-sources-list", draft, onUpdate),
      itemFactory: () => ({ ref: "", type: "" }),
    },
    {
      key: "related",
      addBtnId: "campaign-add-related-btn",
      render: (draft, onUpdate) => renderRelatedFn("campaign-related-list", draft, onUpdate),
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

    document.getElementById("campaign-gallery-upload")?.addEventListener("change", (e) => handleUpload(e.target.files, "campaign-gallery-upload", drafts.gallery, renderGalleryAdmin, _setStatus));
    document.getElementById("campaign-documents-upload")?.addEventListener("change", (e) => handleUpload(e.target.files, "campaign-documents-upload", drafts.documents, renderDocumentsAdmin, _setStatus));

    wireSectionActions("campaign", "gallery", () => drafts.gallery, renderGalleryAdmin, "image");
    wireSectionActions("campaign", "documents", () => drafts.documents, renderDocumentsAdmin, "document");
  },
  onTabActivate: () => registerCallbacks(uploadFile, _setStatus),
  onFormOpen: (drafts, isNew) => {
    if (isNew) {
      renderGalleryAdmin(); renderDocumentsAdmin();
    }
  },
});
