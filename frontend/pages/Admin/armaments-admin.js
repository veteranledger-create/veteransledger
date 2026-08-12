import { TranslationsPanel } from "./translations-panel.js";
import { initMediaAdmin, registerCallbacks } from "./admin-media.js";
import { authHeader, escHtml, safeJson, toggleModal } from "./admin-utils.js";
import { initRelatedModal, openRelatedModal } from "./admin-related.js";
import { renderSources as renderSourcesFn, renderRelated as renderRelatedFn } from "./admin-form.js";
import { uploadFile, handleUpload, wireSectionActions, renderGallery, renderBlueprints, renderVideos, renderDocuments } from "./admin-media-sections.js";
import { createContentModule } from "./admin-content-module.js";

/**
 * VeteransLedger · Admin — Armaments
 * Armament-specific logic only. All shared infrastructure lives in
 * admin-content-module (CRUD/dirty-state/submit-protection/validation/
 * modal+keyboard behavior) and the pre-existing admin-utils / admin-related
 * / admin-form / admin-media(-sections) modules — nothing here duplicates
 * any of that; this file only supplies Armaments' own field mapping,
 * duplicate-name check, and media wiring.
 */

const SPEC_FIELDS = ["designation", "manufacturer", "crew", "weight", "armor", "armament", "engine", "speed", "range", "units_produced"];
const KNOWN_META_KEYS = new Set(["category", "nation", "sources", "related_records", "importRunId", "fileNation", "schemaType", "gallery", "blueprints", "videos", "documents", ...SPEC_FIELDS]);

const translationsPanel = new TranslationsPanel("armament-translations-panel", "record");

// ── Local thin wrappers bind container IDs + drafts to shared renderers ──
// Captured once via onInit so they can reference the SAME drafts object the
// factory manages (mutated in place, never reassigned).
let _drafts = null;
let _setStatus = null;

function renderGalleryAdmin() { renderGallery("armament-gallery-list", "armament-gallery-count", _drafts.gallery, renderGalleryAdmin); }
function renderBlueprintsAdmin() { renderBlueprints("armament-blueprints-list", "armament-blueprints-count", _drafts.blueprints, renderBlueprintsAdmin); }
function renderVideosAdmin() { renderVideos("armament-videos-list", "armament-videos-count", _drafts.videos, renderVideosAdmin); }
function renderDocumentsAdmin() { renderDocuments("armament-documents-list", "armament-documents-count", _drafts.documents, renderDocumentsAdmin); }

// ── Legacy media-library attach (distinct from the gallery/blueprints/
// videos/documents upload sections above — this attaches EXISTING assets
// from the shared media library via a picker modal, persisted through a
// separate PUT /api/armaments/:id/media call after the main save). ──
function renderMedia() {
  const container = document.getElementById("armament-media-list");
  if (!container) return;
  if (!_drafts.media.length) {
    container.innerHTML = `<p class="empty-note">No media attached.</p>`;
    return;
  }
  container.innerHTML = `<div style="display:flex;gap:var(--space-3);flex-wrap:wrap;">${_drafts.media.map((m, i) => `
    <div style="position:relative;">
      <img src="${escHtml(m.thumbnailUrl || m.url)}" alt="${escHtml(m.originalName || "")}" style="width:80px;height:60px;object-fit:cover;border-radius:4px;">
      <button type="button" data-media-remove="${i}" style="position:absolute;top:-6px;right:-6px;background:#4a1515;color:#fff;border:none;border-radius:50%;width:18px;height:18px;font-size:10px;cursor:pointer;"><svg class="icon-inline" width="10" height="10" viewBox="0 0 24 24" aria-hidden="true" xmlns="http://www.w3.org/2000/svg"><path fill="currentColor" fill-rule="evenodd" clip-rule="evenodd" d="M5.29289 5.29289C5.68342 4.90237 6.31658 4.90237 6.70711 5.29289L12 10.5858L17.2929 5.29289C17.6834 4.90237 18.3166 4.90237 18.7071 5.29289C19.0976 5.68342 19.0976 6.31658 18.7071 6.70711L13.4142 12L18.7071 17.2929C19.0976 17.6834 19.0976 18.3166 18.7071 18.7071C18.3166 19.0976 17.6834 19.0976 17.2929 18.7071L12 13.4142L6.70711 18.7071C6.31658 19.0976 5.68342 19.0976 5.29289 18.7071C4.90237 18.3166 4.90237 17.6834 5.29289 17.2929L10.5858 12L5.29289 6.70711C4.90237 6.31658 4.90237 5.68342 5.29289 5.29289Z"/></svg></button>
    </div>`).join("")}</div>`;
  container.querySelectorAll("[data-media-remove]").forEach((el) => el.addEventListener("click", () => { _drafts.media.splice(+el.dataset.mediaRemove, 1); renderMedia(); }));
}

async function openMediaModal() {
  toggleModal("media-attach-modal", true);
  const grid = document.getElementById("media-attach-grid");
  grid.innerHTML = `<p class="text-dim">Loading…</p>`;
  try {
    const res = await fetch("/api/media?limit=60", { headers: authHeader() });
    if (!res.ok) throw new Error();
    const data = await safeJson(res);
    const assets = data.data || [];
    if (!assets.length) { grid.innerHTML = `<p class="text-dim">No media uploaded yet — use the Media tab first.</p>`; return; }
    grid.innerHTML = assets.map((a, i) => `
      <div data-pick-media="${i}" style="cursor:pointer;border:2px solid transparent;border-radius:4px;">
        <img src="${escHtml(a.thumbnailUrl || a.url)}" alt="${escHtml(a.originalName)}" style="width:100%;height:80px;object-fit:cover;border-radius:4px;">
      </div>`).join("");
    grid.querySelectorAll("[data-pick-media]").forEach((el) => el.addEventListener("click", () => {
      const asset = assets[+el.dataset.pickMedia];
      if (!_drafts.media.some((m) => m.id === asset.id)) _drafts.media.push(asset);
      renderMedia();
      toggleModal("media-attach-modal", false);
    }));
  } catch (_) {
    grid.innerHTML = `<p class="text-dim">Media library unavailable.</p>`;
  }
}

// ── Armament-specific: extra specs (dynamic key/value pairs beyond the
// fixed SPEC_FIELDS inputs) ───────────────────────────────────────────
function renderExtraSpecs(draft, onUpdate) {
  const container = document.getElementById("armament-extra-specs");
  if (!container) return;
  container.innerHTML = draft.map((s, i) => `
    <div class="source-row">
      <input class="contact-form__input" placeholder="Field name" value="${escHtml(s.key)}" data-spec-key="${i}" style="flex:1;">
      <input class="contact-form__input" placeholder="Value" value="${escHtml(s.value)}" data-spec-value="${i}" style="flex:1;">
      <button type="button" class="btn btn-secondary" data-spec-remove="${i}" style="font-size:11px;"><svg class="icon-inline" width="10" height="10" viewBox="0 0 24 24" aria-hidden="true" xmlns="http://www.w3.org/2000/svg"><path fill="currentColor" fill-rule="evenodd" clip-rule="evenodd" d="M5.29289 5.29289C5.68342 4.90237 6.31658 4.90237 6.70711 5.29289L12 10.5858L17.2929 5.29289C17.6834 4.90237 18.3166 4.90237 18.7071 5.29289C19.0976 5.68342 19.0976 6.31658 18.7071 6.70711L13.4142 12L18.7071 17.2929C19.0976 17.6834 19.0976 18.3166 18.7071 18.7071C18.3166 19.0976 17.6834 19.0976 17.2929 18.7071L12 13.4142L6.70711 18.7071C6.31658 19.0976 5.68342 19.0976 5.29289 18.7071C4.90237 18.3166 4.90237 17.6834 5.29289 17.2929L10.5858 12L5.29289 6.70711C4.90237 6.31658 4.90237 5.68342 5.29289 5.29289Z"/></svg></button>
    </div>`).join("");
  container.querySelectorAll("[data-spec-key]").forEach((el) => el.addEventListener("input", (e) => { draft[+el.dataset.specKey].key = e.target.value; }));
  container.querySelectorAll("[data-spec-value]").forEach((el) => el.addEventListener("input", (e) => { draft[+el.dataset.specValue].value = e.target.value; }));
  container.querySelectorAll("[data-spec-remove]").forEach((el) => el.addEventListener("click", () => { draft.splice(+el.dataset.specRemove, 1); onUpdate(); }));
}

// ── List ────────────────────────────────────────────────────────────
function renderArmamentsList(container, { data, total, page, pages }, { onEdit, onDelete, onPage }) {
  container.innerHTML = `
    <p class="list-meta">${total} armaments · page ${page} of ${pages}</p>
    <table class="admin-table">
      <thead>
        <tr>
          <th>Title</th>
          <th>Category</th>
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
            <td class="td-primary">${escHtml(r.title)}</td>
            <td><span class="badge">${escHtml(meta.category || "—")}</span></td>
            <td class="td-muted">${escHtml(meta.nation || r.nationality || "—")}</td>
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
  form.querySelector("[name='id']").value = r.id;
  form.querySelector("[name='title']").value = r.title || "";
  form.querySelector("[name='summary']").value = r.summary || "";
  form.querySelector("[name='category']").value = meta.category || "";
  form.querySelector("[name='nation']").value = meta.nation || r.nationality || "";
  form.querySelector("[name='published']").checked = !!r.published;

  for (const field of SPEC_FIELDS) {
    const input = form.querySelector(`[name='spec_${field}']`);
    if (input && meta[field] !== undefined) input.value = typeof meta[field] === "object" ? JSON.stringify(meta[field]) : meta[field];
  }

  drafts.extraSpecs = Object.entries(meta).filter(([k]) => !KNOWN_META_KEYS.has(k)).map(([key, value]) => ({ key, value: typeof value === "object" ? JSON.stringify(value) : String(value) }));
  drafts.sources = Array.isArray(meta.sources) ? meta.sources.map((s) => ({ ref: s.ref || "", type: s.type || "" })) : [];
  drafts.related = Array.isArray(meta.related_records) ? [...meta.related_records] : [];
  drafts.media = Array.isArray(r.media) ? [...r.media] : [];
  drafts.gallery = Array.isArray(meta.gallery) ? meta.gallery.map((g) => ({ ...g })) : [];
  drafts.blueprints = Array.isArray(meta.blueprints) ? meta.blueprints.map((b) => ({ ...b })) : [];
  drafts.videos = Array.isArray(meta.videos) ? meta.videos.map((v) => ({ ...v })) : [];
  drafts.documents = Array.isArray(meta.documents) ? meta.documents.map((d) => ({ ...d })) : [];

  // extraSpecs/sources/related are repeatableGroups — the factory re-renders
  // them right after this function returns. Only the extraDraftKeys-based
  // media sections need rendering here.
  renderGalleryAdmin(); renderBlueprintsAdmin(); renderVideosAdmin(); renderDocumentsAdmin(); renderMedia();
}

function serializeForm(form, drafts) {
  const specs = {};
  for (const field of SPEC_FIELDS) {
    const value = form.querySelector(`[name='spec_${field}']`)?.value;
    if (value) specs[field] = field === "crew" || field === "units_produced" ? Number(value) : value;
  }
  for (const { key, value } of drafts.extraSpecs) {
    if (key) specs[key] = value;
  }

  return {
    title: form.querySelector("[name='title']").value.trim(),
    summary: form.querySelector("[name='summary']").value.trim() || undefined,
    category: form.querySelector("[name='category']").value,
    nation: form.querySelector("[name='nation']").value.trim(),
    specs,
    sources: drafts.sources.filter((s) => s.ref),
    related_records: drafts.related,
    gallery: drafts.gallery.filter((g) => g.file),
    blueprints: drafts.blueprints.filter((b) => b.file),
    videos: drafts.videos.filter((v) => v.file),
    documents: drafts.documents.filter((d) => d.file),
    published: form.querySelector("[name='published']").checked,
  };
}

function renderPreview(rendered, issues) {
  const errors = issues.filter((i) => i.severity === "error");
  return `
    ${errors.length ? `<div class="preview-error">
      <strong>Cannot publish — ${errors.length} blocking issue(s):</strong>
      <ul>${errors.map((e) => `<li>${escHtml(e.message)}</li>`).join("")}</ul>
    </div>` : ""}
    <h3 class="preview-title">${escHtml(rendered.name)}</h3>
    <p class="text-dim mb-3">${escHtml(rendered.nation || "")}</p>
    <p class="mb-4">${escHtml(rendered.summary || "")}</p>
    <pre class="preview-json">${escHtml(JSON.stringify(rendered, null, 2))}</pre>`;
}

// ── Live duplicate-name check — non-blocking, runs before every submit ──
async function checkDuplicatesLive(form, editingId) {
  const category = form.querySelector("[name='category']").value;
  const title = form.querySelector("[name='title']").value.trim();
  if (!category || !title) return;
  try {
    const params = new URLSearchParams({ category, name: title, ...(editingId && { excludeId: editingId }) });
    const res = await fetch(`/api/armaments/check-duplicates?${params}`, { headers: authHeader() });
    if (!res.ok) return;
    const candidates = await safeJson(res);
    const warningEl = document.getElementById("armament-duplicate-warning");
    if (candidates.length) {
      warningEl.hidden = false;
      warningEl.textContent = `Possible duplicate: ${candidates.length} existing armament(s) in this category share a normalized name (e.g. "${candidates[0].title}"). You can still save as a draft — publish will be blocked until this is resolved.`;
    } else {
      warningEl.hidden = true;
    }
  } catch (_) { /* non-blocking by design */ }
}

createContentModule({
  idPrefix: "armament",
  apiBase: "/api/armaments",
  tabPanelId: "tab-armaments",
  tabButtonSelector: '[data-tab="tab-armaments"]',
  pageSize: 20,
  filters: [
    { param: "category", event: "change" },
    { param: "search", event: "input", debounceMs: 350 },
  ],
  renderList: renderArmamentsList,
  emptyMessage: "No armaments yet. Create one above.",
  translationsPanel,
  labels: { new: "New Armament", edit: "Edit Armament" },
  repeatableGroups: [
    {
      key: "extraSpecs",
      addBtnId: "armament-add-spec-btn",
      render: renderExtraSpecs,
      itemFactory: () => ({ key: "", value: "" }),
    },
    {
      key: "sources",
      addBtnId: "armament-add-source-btn",
      render: (draft, onUpdate) => renderSourcesFn("armament-sources-list", draft, onUpdate),
      itemFactory: () => ({ ref: "", type: "" }),
    },
    {
      key: "related",
      addBtnId: "armament-add-related-btn",
      render: (draft, onUpdate) => renderRelatedFn("armament-related-list", draft, onUpdate),
      onAdd: (draft, rerender) => openRelatedModal((item) => { draft.push(item); rerender(); }),
    },
  ],
  extraDraftKeys: ["media", "gallery", "blueprints", "videos", "documents"],
  populateForm,
  serializeForm,
  renderPreview,
  beforeSubmit: (form, drafts, editingId) => checkDuplicatesLive(form, editingId),
  afterSave: async (saved) => {
    document.getElementById("armament-form").querySelector("[name='id']").value = saved.id;
    if (_drafts.media.length) {
      await fetch(`/api/armaments/${saved.id}/media`, {
        method: "PUT",
        headers: { ...authHeader(), "Content-Type": "application/json" },
        body: JSON.stringify({ attach: _drafts.media.map((m) => m.id), detach: [] }),
      });
    }
  },
  onInit: (drafts, { setStatus }) => {
    _drafts = drafts;
    _setStatus = setStatus;

    initMediaAdmin();
    initRelatedModal();
    registerCallbacks(uploadFile, _setStatus);

    document.getElementById("armament-attach-media-btn")?.addEventListener("click", openMediaModal);
    document.getElementById("media-attach-modal-close")?.addEventListener("click", () => toggleModal("media-attach-modal", false));

    document.getElementById("armament-gallery-upload")?.addEventListener("change", (e) => handleUpload(e.target.files, "armament-gallery-upload", drafts.gallery, renderGalleryAdmin, _setStatus));
    document.getElementById("armament-blueprints-upload")?.addEventListener("change", (e) => handleUpload(e.target.files, "armament-blueprints-upload", drafts.blueprints, renderBlueprintsAdmin, _setStatus));
    document.getElementById("armament-videos-upload")?.addEventListener("change", (e) => handleUpload(e.target.files, "armament-videos-upload", drafts.videos, renderVideosAdmin, _setStatus, true));
    document.getElementById("armament-documents-upload")?.addEventListener("change", (e) => handleUpload(e.target.files, "armament-documents-upload", drafts.documents, renderDocumentsAdmin, _setStatus));

    wireSectionActions("armament", "gallery", drafts.gallery, renderGalleryAdmin, "image");
    wireSectionActions("armament", "blueprints", drafts.blueprints, renderBlueprintsAdmin, "blueprint");
    wireSectionActions("armament", "videos", drafts.videos, renderVideosAdmin, "video");
    wireSectionActions("armament", "documents", drafts.documents, renderDocumentsAdmin, "document");
  },
  onTabActivate: () => registerCallbacks(uploadFile, _setStatus),
  onFormOpen: (drafts, isNew) => {
    document.getElementById("armament-duplicate-warning").hidden = true;
    if (isNew) {
      // input[type=hidden]'s .value reflects straight to the attribute, so
      // form.reset() does NOT clear it back to "" once afterSave has set it
      // — must be cleared explicitly here, or a "New" form would silently
      // carry the previously-edited record's id into checkDuplicatesLive
      // (and anything else that might read this field in the future).
      document.getElementById("armament-form").querySelector("[name='id']").value = "";
      renderGalleryAdmin(); renderBlueprintsAdmin(); renderVideosAdmin(); renderDocumentsAdmin(); renderMedia();
    }
  },
});
