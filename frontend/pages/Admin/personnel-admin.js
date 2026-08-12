import { TranslationsPanel } from "./translations-panel.js";
import { initMediaAdmin, registerCallbacks } from "./admin-media.js";
import { escHtml, safeJson } from "./admin-utils.js";
import { initRelatedModal, openRelatedModal } from "./admin-related.js";
import { renderSources as renderSourcesFn, renderRelated as renderRelatedFn, renderStringList } from "./admin-form.js";
import { uploadFile, handleUpload, wireSectionActions, renderGallery, renderDocuments } from "./admin-media-sections.js";
import { initBodyEditor, readBodyBlocks } from "./admin-body-editor.js";
import { createContentModule } from "./admin-content-module.js";

/**
 * VeteransLedger · Admin — Personnel
 * Personnel-specific logic only (Entity model, portrait, commands/awards/
 * campaigns as plain string lists, biography block editor). All shared
 * infrastructure lives in admin-content-module and the pre-existing
 * admin-utils / admin-related / admin-form / admin-media(-sections) /
 * admin-body-editor modules — nothing here duplicates any of that.
 */

function textToBlocks(text) {
  if (!text) return [];
  return text.split(/\n\n+/).map((p) => p.trim()).filter(Boolean).map((t) => ({ type: "paragraph", text: t }));
}

const translationsPanel = new TranslationsPanel("personnel-translations-panel", "entity");

let _drafts = null;
let _setStatus = null;

// ── Local thin wrappers ────────────────────────────────────────────
function renderCommands(draft) { renderStringList("personnel-commands-list", draft, "cmd", "Command / unit"); }
function renderAwards(draft) { renderStringList("personnel-awards-list", draft, "award", "Award / decoration"); }
function renderCampaigns(draft) { renderStringList("personnel-campaigns-list", draft, "campaign", "Campaign / theatre"); }
function renderGalleryAdmin() { renderGallery("personnel-gallery-list", "personnel-gallery-count", _drafts.gallery, renderGalleryAdmin); }
function renderDocumentsAdmin() { renderDocuments("personnel-documents-list", "personnel-documents-count", _drafts.documents, renderDocumentsAdmin); }

// ── List ────────────────────────────────────────────────────────────
function renderPersonnelList(container, { data, total, page, pages }, { onEdit, onDelete, onPage }) {
  container.innerHTML = `
    <p class="list-meta">${total} records · page ${page} of ${pages}</p>
    <table class="admin-table">
      <thead>
        <tr>
          <th>Name</th>
          <th>Branch</th>
          <th>Nation</th>
          <th>Status</th>
          <th class="col-actions">Actions</th>
        </tr>
      </thead>
      <tbody>
        ${data.map((r) => {
          const meta = r.metadata || {};
          return `
          <tr>
            <td class="td-primary">${escHtml(r.name)}</td>
            <td><span class="badge">${escHtml(meta.branch || "—")}</span></td>
            <td class="td-muted">${escHtml(r.nationality || "—")}</td>
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
  form.querySelector("[name='name']").value = r.name || "";
  form.querySelector("[name='branch']").value = meta.branch || "";
  form.querySelector("[name='nationality']").value = r.nationality || "";
  form.querySelector("[name='rank']").value = meta.rank || "";
  form.querySelector("[name='service']").value = meta.service || "";
  form.querySelector("[name='birthDate']").value = r.birthDate ? r.birthDate.slice(0, 10) : "";
  form.querySelector("[name='deathDate']").value = r.deathDate ? r.deathDate.slice(0, 10) : "";
  form.querySelector("[name='birthplace']").value = meta.birthplace || "";
  form.querySelector("[name='summary']").value = r.summary || "";
  form.querySelector("[name='published']").checked = !!r.published;
  const bioBlocks = Array.isArray(meta.biographyBlocks) ? meta.biographyBlocks : textToBlocks(r.biography);
  initBodyEditor("personnel-biography-editor", bioBlocks);
  document.getElementById("personnel-portrait-url").value = meta.portrait || "";

  drafts.commands = Array.isArray(meta.commands) ? [...meta.commands] : [];
  drafts.awards = Array.isArray(meta.awards) ? [...meta.awards] : [];
  drafts.campaigns = Array.isArray(meta.campaigns) ? [...meta.campaigns] : [];
  drafts.sources = Array.isArray(meta.sources) ? meta.sources.map((s) => ({ ref: s.ref || "", type: s.type || "" })) : [];
  drafts.related = Array.isArray(meta.related_records) ? [...meta.related_records] : [];
  drafts.gallery = Array.isArray(meta.gallery) ? meta.gallery.map((g) => ({ ...g })) : [];
  drafts.documents = Array.isArray(meta.documents) ? meta.documents.map((d) => ({ ...d })) : [];

  // commands/awards/campaigns/sources/related are repeatableGroups — the
  // factory re-renders them right after this function returns. Only the
  // extraDraftKeys-based media sections need rendering here.
  renderGalleryAdmin(); renderDocumentsAdmin();
}

function serializeForm(form, drafts) {
  const bioBlocks = readBodyBlocks("personnel-biography-editor");
  const biographyText = bioBlocks.map((b) => b.text || b.url || "").filter(Boolean).join("\n\n");

  const body = {
    name: form.querySelector("[name='name']").value.trim(),
    nationality: form.querySelector("[name='nationality']").value.trim() || undefined,
    biography: biographyText || undefined,
    summary: form.querySelector("[name='summary']").value.trim() || undefined,
    published: form.querySelector("[name='published']").checked,
    metadata: {
      branch: form.querySelector("[name='branch']").value || undefined,
      rank: form.querySelector("[name='rank']").value.trim() || undefined,
      service: form.querySelector("[name='service']").value.trim() || undefined,
      birthplace: form.querySelector("[name='birthplace']").value.trim() || undefined,
      portrait: document.getElementById("personnel-portrait-url").value.trim() || undefined,
      biographyBlocks: bioBlocks.length ? bioBlocks : undefined,
      commands: drafts.commands.filter(Boolean),
      awards: drafts.awards.filter(Boolean),
      campaigns: drafts.campaigns.filter(Boolean),
      sources: drafts.sources.filter((s) => s.ref),
      related_records: drafts.related,
      gallery: drafts.gallery.filter((g) => g.file),
      documents: drafts.documents.filter((d) => d.file),
    },
  };

  const birthDateVal = form.querySelector("[name='birthDate']").value.trim();
  const deathDateVal = form.querySelector("[name='deathDate']").value.trim();
  if (birthDateVal) body.birthDate = birthDateVal;
  if (deathDateVal) body.deathDate = deathDateVal;

  return body;
}

function renderPreview(rendered, issues) {
  const errors = issues.filter((i) => i.severity === "error");
  return `
    ${errors.length ? `<div class="preview-error">
      <strong>Cannot publish — ${errors.length} blocking issue(s):</strong>
      <ul>${errors.map((e) => `<li>${escHtml(e.message)}</li>`).join("")}</ul>
    </div>` : ""}
    <h3 class="preview-title">${escHtml(rendered.name)}</h3>
    <p class="text-dim mb-1">${escHtml(rendered.rank || "")}${rendered.rank && rendered.branch ? " · " : ""}${escHtml(rendered.branch || "")}</p>
    <p class="text-dim mb-3">${escHtml(rendered.nation || "")}</p>
    <p class="mb-4">${escHtml(rendered.biography?.slice(0, 200) || "")}${(rendered.biography?.length || 0) > 200 ? "…" : ""}</p>
    <pre class="preview-json">${escHtml(JSON.stringify(rendered, null, 2))}</pre>`;
}

createContentModule({
  idPrefix: "personnel",
  apiBase: "/api/personnel",
  tabPanelId: "tab-personnel",
  tabButtonSelector: '[data-tab="tab-personnel"]',
  pageSize: 20,
  filters: [
    { param: "branch", event: "change" },
    { param: "search", event: "input", debounceMs: 350 },
  ],
  renderList: renderPersonnelList,
  emptyMessage: "No personnel records yet. Create one above.",
  translationsPanel,
  labels: { new: "New Personnel Record", edit: "Edit Personnel Record" },
  repeatableGroups: [
    { key: "commands", addBtnId: "personnel-add-command-btn", render: renderCommands, itemFactory: () => "" },
    { key: "awards", addBtnId: "personnel-add-award-btn", render: renderAwards, itemFactory: () => "" },
    { key: "campaigns", addBtnId: "personnel-add-campaign-btn", render: renderCampaigns, itemFactory: () => "" },
    {
      key: "sources",
      addBtnId: "personnel-add-source-btn",
      render: (draft, onUpdate) => renderSourcesFn("personnel-sources-list", draft, onUpdate),
      itemFactory: () => ({ ref: "", type: "" }),
    },
    {
      key: "related",
      addBtnId: "personnel-add-related-btn",
      render: (draft, onUpdate) => renderRelatedFn("personnel-related-list", draft, onUpdate),
      onAdd: (draft, rerender) => openRelatedModal((item) => { draft.push(item); rerender(); }),
    },
  ],
  extraDraftKeys: ["gallery", "documents"],
  populateForm,
  serializeForm,
  renderPreview,
  // Biography (block editor) and portrait URL live outside named form
  // fields (the block editor has no `name` attributes at all; the portrait
  // input is a plain #id field, not part of the form's FormData) — without
  // this, editing either would silently not register as unsaved changes.
  snapshotExtra: () => ({
    biography: JSON.stringify(readBodyBlocks("personnel-biography-editor")),
    portrait: document.getElementById("personnel-portrait-url")?.value || "",
  }),
  onInit: (drafts, { setStatus }) => {
    _drafts = drafts;
    _setStatus = setStatus;

    initMediaAdmin();
    initRelatedModal();
    registerCallbacks(uploadFile, _setStatus);

    document.getElementById("personnel-portrait-upload")?.addEventListener("change", async (e) => {
      const file = e.target.files[0];
      if (!file) return;
      _setStatus("Uploading portrait…", false);
      try {
        const asset = await uploadFile(file);
        const urlInput = document.getElementById("personnel-portrait-url");
        urlInput.value = asset.url;
        urlInput.dispatchEvent(new Event("input", { bubbles: true }));
        e.target.value = "";
        _setStatus("Portrait uploaded. Save to persist.", false);
      } catch (_) {
        _setStatus("Portrait upload failed.", true);
      }
    });

    document.getElementById("personnel-gallery-upload")?.addEventListener("change", (e) => handleUpload(e.target.files, "personnel-gallery-upload", drafts.gallery, renderGalleryAdmin, _setStatus));
    document.getElementById("personnel-documents-upload")?.addEventListener("change", (e) => handleUpload(e.target.files, "personnel-documents-upload", drafts.documents, renderDocumentsAdmin, _setStatus));

    wireSectionActions("personnel", "gallery", drafts.gallery, renderGalleryAdmin, "image");
    wireSectionActions("personnel", "documents", drafts.documents, renderDocumentsAdmin, "document");
  },
  onTabActivate: () => registerCallbacks(uploadFile, _setStatus),
  onFormOpen: (drafts, isNew) => {
    if (isNew) {
      initBodyEditor("personnel-biography-editor", []);
      renderGalleryAdmin(); renderDocumentsAdmin();
    }
  },
});
