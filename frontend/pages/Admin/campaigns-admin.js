import { TranslationsPanel } from "./translations-panel.js";
import { initMediaAdmin, registerCallbacks } from "./admin-media.js";
import { authHeader, escHtml, debounce, loader, toggleModal, makeStatusFn, safeJson } from "./admin-utils.js";
import { initRelatedModal, openRelatedModal } from "./admin-related.js";
import { renderSources as renderSourcesFn, renderRelated as renderRelatedFn } from "./admin-form.js";
import { uploadFile, handleUpload, wireSectionActions, renderGallery, renderDocuments } from "./admin-media-sections.js";

/**
 * VeteransLedger · Admin — Campaigns
 * Campaign-specific logic only. Dates are stored in both top-level Prisma
 * columns (for orderBy) and metadata.dates (for conformance + generator).
 */

const KNOWN_THEATERS = [
  { value: "africa",        label: "North Africa" },
  { value: "atlantic",      label: "Atlantic" },
  { value: "eastern-front", label: "Eastern Front" },
  { value: "italy",         label: "Italy" },
  { value: "western-front", label: "Western Front" },
];

let currentPage = 1;
let editingId = null;
const translationsPanel = new TranslationsPanel("campaign-translations-panel", "record");
let sourcesDraft = [];
let relatedDraft = [];
let galleryDraft = [];
let documentsDraft = [];

const setStatus = makeStatusFn("campaign-form-status");

function renderSources() { renderSourcesFn("campaign-sources-list", sourcesDraft, renderSources); }
function renderRelated() { renderRelatedFn("campaign-related-list", relatedDraft, renderRelated); }
function renderGalleryAdmin() { renderGallery("campaign-gallery-list", "campaign-gallery-count", galleryDraft, renderGalleryAdmin); }
function renderDocumentsAdmin() { renderDocuments("campaign-documents-list", "campaign-documents-count", documentsDraft, renderDocumentsAdmin); }

function init() {
  initMediaAdmin();
  initRelatedModal();
  registerCallbacks(uploadFile, setStatus);

  document.getElementById("admin-tabs")?.addEventListener("click", (e) => {
    if (e.target.closest('[data-tab="tab-campaigns"]')) {
      registerCallbacks(uploadFile, setStatus);
      loadCampaigns(1);
    }
  });

  document.getElementById("campaign-new-btn")?.addEventListener("click", () => openForm(null));
  document.getElementById("campaign-cancel-btn")?.addEventListener("click", closeForm);
  document.getElementById("campaign-filter-theater")?.addEventListener("change", () => loadCampaigns(1));
  document.getElementById("campaign-filter-search")?.addEventListener("input", debounce(() => loadCampaigns(1), 350));
  document.getElementById("campaign-form")?.addEventListener("submit", handleSubmit);
  document.getElementById("campaign-preview-btn")?.addEventListener("click", showPreview);
  document.getElementById("campaign-preview-modal-close")?.addEventListener("click", () => toggleModal("campaign-preview-modal", false));

  document.getElementById("campaign-add-source-btn")?.addEventListener("click", () => { sourcesDraft.push({ ref: "", type: "" }); renderSources(); });
  document.getElementById("campaign-add-related-btn")?.addEventListener("click", () =>
    openRelatedModal((item) => { relatedDraft.push(item); renderRelated(); })
  );

  document.getElementById("campaign-gallery-upload")?.addEventListener("change", (e) => handleUpload(e.target.files, "campaign-gallery-upload", galleryDraft, renderGalleryAdmin, setStatus));
  document.getElementById("campaign-documents-upload")?.addEventListener("change", (e) => handleUpload(e.target.files, "campaign-documents-upload", documentsDraft, renderDocumentsAdmin, setStatus));

  wireSectionActions("campaign", "gallery", galleryDraft, renderGalleryAdmin, "image");
  wireSectionActions("campaign", "documents", documentsDraft, renderDocumentsAdmin, "document");
}

// ── List ──────────────────────────────────────────────────────
async function loadCampaigns(page = 1) {
  currentPage = page;
  const container = document.getElementById("campaign-list");
  if (!container) return;
  container.innerHTML = loader();

  const theater = document.getElementById("campaign-filter-theater")?.value || "";
  const search = document.getElementById("campaign-filter-search")?.value || "";
  const params = new URLSearchParams({ page, limit: 20, ...(theater && { theater }), ...(search && { search }) });

  try {
    const res = await fetch(`/api/campaigns?${params}`, { headers: authHeader() });
    if (!res.ok) throw new Error();
    renderList(container, await safeJson(res));
  } catch (_) {
    container.innerHTML = `<p class="text-dim">Campaigns unavailable.</p>`;
  }
}

function renderList(container, { data, total, page, pages }) {
  if (!data.length) {
    container.innerHTML = `<p class="text-dim">No campaigns yet. Create one above.</p>`;
    return;
  }
  container.innerHTML = `
    <p class="list-meta">${total} campaigns · page ${page} of ${pages}</p>
    <table class="admin-table">
      <thead>
        <tr>
          <th>Title</th>
          <th>Theater</th>
          <th>Start</th>
          <th>Status</th>
          <th class="col-actions">Actions</th>
        </tr>
      </thead>
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

  container.querySelectorAll("[data-edit]").forEach((btn) => btn.addEventListener("click", () => openForm(btn.dataset.edit)));
  container.querySelectorAll("[data-delete]").forEach((btn) => btn.addEventListener("click", () => deleteCampaign(btn.dataset.delete)));
  container.querySelectorAll("[data-page]").forEach((btn) => btn.addEventListener("click", () => loadCampaigns(+btn.dataset.page)));
}

async function deleteCampaign(id) {
  if (!confirm("Delete this campaign? This cannot be undone.")) return;
  try {
    const res = await fetch(`/api/campaigns/${id}`, { method: "DELETE", headers: authHeader() });
    if (!res.ok) throw new Error();
    loadCampaigns(currentPage);
  } catch (_) {
    alert("Delete failed. Try again.");
  }
}

// ── Form ──────────────────────────────────────────────────────
function openForm(id) {
  editingId = id;
  sourcesDraft = []; relatedDraft = []; galleryDraft = []; documentsDraft = [];
  document.getElementById("campaign-form")?.reset();
  document.getElementById("campaign-form-title").textContent = id ? "Edit Campaign" : "New Campaign";
  document.getElementById("campaign-form-panel").hidden = false;
  renderSources(); renderRelated(); renderGalleryAdmin(); renderDocumentsAdmin();
  setStatus("", false);
  if (id) { loadCampaignIntoForm(id); translationsPanel.load(id); }
  else translationsPanel.clear();
}

function closeForm() {
  document.getElementById("campaign-form-panel").hidden = true;
  editingId = null;
}

async function loadCampaignIntoForm(id) {
  try {
    const res = await fetch(`/api/campaigns/${id}`, { headers: authHeader() });
    if (!res.ok) throw new Error();
    const r = await safeJson(res);
    const meta = r.metadata || {};
    const form = document.getElementById("campaign-form");

    form.querySelector("[name='title']").value = r.title || "";
    form.querySelector("[name='theater']").value = meta.theater || "";
    form.querySelector("[name='startDate']").value = r.startDate ? r.startDate.slice(0, 10) : (meta.dates?.start || "");
    form.querySelector("[name='endDate']").value = r.endDate ? r.endDate.slice(0, 10) : (meta.dates?.end || "");
    form.querySelector("[name='summary']").value = r.summary || "";
    form.querySelector("[name='context']").value = meta.context || "";
    form.querySelector("[name='significance']").value = meta.significance || "";
    form.querySelector("[name='outcome']").value = meta.outcome || "";
    form.querySelector("[name='published']").checked = !!r.published;

    sourcesDraft = Array.isArray(meta.sources) ? meta.sources.map((s) => ({ ref: s.ref || "", type: s.type || "" })) : [];
    relatedDraft = Array.isArray(meta.related_records) ? [...meta.related_records] : [];
    galleryDraft = Array.isArray(meta.gallery) ? meta.gallery.map((g) => ({ ...g })) : [];
    documentsDraft = Array.isArray(meta.documents) ? meta.documents.map((d) => ({ ...d })) : [];

    renderSources(); renderRelated(); renderGalleryAdmin(); renderDocumentsAdmin();
  } catch (_) {
    setStatus("Failed to load campaign.", true);
  }
}

// ── Preview ───────────────────────────────────────────────────
async function showPreview() {
  if (!editingId) { alert("Save the campaign first, then Preview."); return; }
  toggleModal("campaign-preview-modal", true);
  const content = document.getElementById("campaign-preview-content");
  content.innerHTML = `<p class="text-dim">Loading…</p>`;
  try {
    const res = await fetch(`/api/campaigns/${editingId}/preview`, { headers: authHeader() });
    if (!res.ok) throw new Error();
    const { rendered, issues } = await safeJson(res);
    const errors = issues.filter((i) => i.severity === "error");
    const dates = rendered.dates || {};
    content.innerHTML = `
      ${errors.length ? `<div class="preview-error">
        <strong>Cannot publish — ${errors.length} blocking issue(s):</strong>
        <ul>${errors.map((e) => `<li>${escHtml(e.message)}</li>`).join("")}</ul>
      </div>` : ""}
      <h3 class="preview-title">${escHtml(rendered.title || "—")}</h3>
      <p class="text-dim mb-1">${escHtml(rendered.theater || "")}${dates.start ? " · " + dates.start : ""}</p>
      <p class="mb-4">${escHtml((rendered.summary || "").slice(0, 200))}</p>
      <pre class="preview-json">${escHtml(JSON.stringify(rendered, null, 2))}</pre>`;
  } catch (_) {
    content.innerHTML = `<p class="text-dim">Preview unavailable.</p>`;
  }
}

// ── Submit ────────────────────────────────────────────────────
async function handleSubmit(e) {
  e.preventDefault();
  const form = e.target;
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
      sources: sourcesDraft.filter((s) => s.ref),
      related_records: relatedDraft,
      gallery: galleryDraft.filter((g) => g.file),
      documents: documentsDraft.filter((d) => d.file),
    },
  };

  if (startDateVal) body.startDate = startDateVal;
  if (endDateVal) body.endDate = endDateVal;

  try {
    const res = await fetch(editingId ? `/api/campaigns/${editingId}` : "/api/campaigns", {
      method: editingId ? "PUT" : "POST",
      headers: { ...authHeader(), "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const err = await safeJson(res).catch(() => ({}));
      throw new Error(err.error || "Save failed.");
    }
    const saved = await safeJson(res);
    editingId = saved.id;
    translationsPanel.load(saved.id);
    setStatus("Saved.", false);
    loadCampaigns(currentPage);
    if (!document.getElementById("campaign-preview-modal")?.hidden) showPreview();
  } catch (err) {
    setStatus(err.message || "Save failed. Try again.", true);
  }
}

init();
