import { TranslationsPanel } from "./translations-panel.js";
import { initMediaAdmin, registerCallbacks } from "./admin-media.js";
import { authHeader, escHtml, debounce, loader, toggleModal, makeStatusFn, safeJson } from "./admin-utils.js";
import { initRelatedModal, openRelatedModal } from "./admin-related.js";
import { renderSources as renderSourcesFn, renderRelated as renderRelatedFn, renderStringList } from "./admin-form.js";
import { uploadFile, handleUpload, wireSectionActions, renderGallery, renderDocuments } from "./admin-media-sections.js";
import { initBodyEditor, readBodyBlocks } from "./admin-body-editor.js";

function textToBlocks(text) {
  if (!text) return [];
  return text.split(/\n\n+/).map((p) => p.trim()).filter(Boolean).map((t) => ({ type: "paragraph", text: t }));
}

/**
 * VeteransLedger · Admin — Personnel
 * Personnel-specific logic only (Entity model, portrait, commands/awards/campaigns).
 * All shared infrastructure lives in the admin-utils / admin-related / admin-form /
 * admin-media-sections modules.
 */

const BRANCH_OPTIONS = [
  { value: "army",         label: "Army" },
  { value: "kriegsmarine", label: "Kriegsmarine" },
  { value: "luftwaffe",    label: "Luftwaffe" },
  { value: "waffen-ss",    label: "Waffen-SS" },
  { value: "foreign",      label: "Foreign / Other" },
];

let currentPage = 1;
let editingId = null;
const translationsPanel = new TranslationsPanel("personnel-translations-panel", "entity");
let commandsDraft = [];
let awardsDraft = [];
let campaignsDraft = [];
let sourcesDraft = [];
let relatedDraft = [];
let galleryDraft = [];
let documentsDraft = [];

const setStatus = makeStatusFn("personnel-form-status");

// ── Local thin wrappers ───────────────────────────────────────
function renderCommands() { renderStringList("personnel-commands-list", commandsDraft, "cmd", "Command / unit"); }
function renderAwards() { renderStringList("personnel-awards-list", awardsDraft, "award", "Award / decoration"); }
function renderCampaigns() { renderStringList("personnel-campaigns-list", campaignsDraft, "campaign", "Campaign / theatre"); }
function renderSources() { renderSourcesFn("personnel-sources-list", sourcesDraft, renderSources); }
function renderRelated() { renderRelatedFn("personnel-related-list", relatedDraft, renderRelated); }
function renderGalleryAdmin() { renderGallery("personnel-gallery-list", "personnel-gallery-count", galleryDraft, renderGalleryAdmin); }
function renderDocumentsAdmin() { renderDocuments("personnel-documents-list", "personnel-documents-count", documentsDraft, renderDocumentsAdmin); }

function init() {
  initMediaAdmin();
  initRelatedModal();
  registerCallbacks(uploadFile, setStatus);

  document.getElementById("admin-tabs")?.addEventListener("click", (e) => {
    if (e.target.closest('[data-tab="tab-personnel"]')) {
      registerCallbacks(uploadFile, setStatus);
      loadPersonnel(1);
    }
  });

  document.getElementById("personnel-new-btn")?.addEventListener("click", () => openForm(null));
  document.getElementById("personnel-cancel-btn")?.addEventListener("click", closeForm);
  document.getElementById("personnel-filter-branch")?.addEventListener("change", () => loadPersonnel(1));
  document.getElementById("personnel-filter-search")?.addEventListener("input", debounce(() => loadPersonnel(1), 350));
  document.getElementById("personnel-form")?.addEventListener("submit", handleSubmit);
  document.getElementById("personnel-preview-btn")?.addEventListener("click", showPreview);
  document.getElementById("personnel-preview-modal-close")?.addEventListener("click", () => toggleModal("personnel-preview-modal", false));

  document.getElementById("personnel-add-command-btn")?.addEventListener("click", () => { commandsDraft.push(""); renderCommands(); });
  document.getElementById("personnel-add-award-btn")?.addEventListener("click", () => { awardsDraft.push(""); renderAwards(); });
  document.getElementById("personnel-add-campaign-btn")?.addEventListener("click", () => { campaignsDraft.push(""); renderCampaigns(); });
  document.getElementById("personnel-add-source-btn")?.addEventListener("click", () => { sourcesDraft.push({ ref: "", type: "" }); renderSources(); });
  document.getElementById("personnel-add-related-btn")?.addEventListener("click", () => openRelatedModal(pickRelated));

  document.getElementById("personnel-portrait-upload")?.addEventListener("change", async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    setStatus("Uploading portrait…", false);
    try {
      const asset = await uploadFile(file);
      document.getElementById("personnel-portrait-url").value = asset.url;
      e.target.value = "";
      setStatus("Portrait uploaded. Save to persist.", false);
    } catch (_) {
      setStatus("Portrait upload failed.", true);
    }
  });

  document.getElementById("personnel-gallery-upload")?.addEventListener("change", (e) => handleUpload(e.target.files, "personnel-gallery-upload", galleryDraft, renderGalleryAdmin, setStatus));
  document.getElementById("personnel-documents-upload")?.addEventListener("change", (e) => handleUpload(e.target.files, "personnel-documents-upload", documentsDraft, renderDocumentsAdmin, setStatus));

  wireSectionActions("personnel", "gallery", galleryDraft, renderGalleryAdmin, "image");
  wireSectionActions("personnel", "documents", documentsDraft, renderDocumentsAdmin, "document");
}

// ── List ──────────────────────────────────────────────────────
async function loadPersonnel(page = 1) {
  currentPage = page;
  const container = document.getElementById("personnel-list");
  if (!container) return;
  container.innerHTML = loader();

  const branch = document.getElementById("personnel-filter-branch")?.value || "";
  const search = document.getElementById("personnel-filter-search")?.value || "";
  const params = new URLSearchParams({ page, limit: 20, ...(branch && { branch }), ...(search && { search }) });

  try {
    const res = await fetch(`/api/personnel?${params}`, { headers: authHeader() });
    if (!res.ok) throw new Error();
    renderList(container, await safeJson(res));
  } catch (_) {
    container.innerHTML = `<p class="text-dim">Personnel unavailable.</p>`;
  }
}

function renderList(container, { data, total, page, pages }) {
  if (!data.length) {
    container.innerHTML = `<p class="text-dim">No personnel records yet. Create one above.</p>`;
    return;
  }
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

  container.querySelectorAll("[data-edit]").forEach((btn) => btn.addEventListener("click", () => openForm(btn.dataset.edit)));
  container.querySelectorAll("[data-delete]").forEach((btn) => btn.addEventListener("click", () => deletePersonnel(btn.dataset.delete)));
  container.querySelectorAll("[data-page]").forEach((btn) => btn.addEventListener("click", () => loadPersonnel(+btn.dataset.page)));
}

async function deletePersonnel(id) {
  if (!confirm("Delete this personnel record? This cannot be undone.")) return;
  try {
    const res = await fetch(`/api/personnel/${id}`, { method: "DELETE", headers: authHeader() });
    if (!res.ok) throw new Error();
    loadPersonnel(currentPage);
  } catch (_) {
    alert("Delete failed. Try again.");
  }
}

// ── Form ──────────────────────────────────────────────────────
function openForm(id) {
  editingId = id;
  commandsDraft = []; awardsDraft = []; campaignsDraft = [];
  sourcesDraft = []; relatedDraft = []; galleryDraft = []; documentsDraft = [];
  document.getElementById("personnel-form")?.reset();
  document.getElementById("personnel-form-title").textContent = id ? "Edit Personnel Record" : "New Personnel Record";
  document.getElementById("personnel-form-panel").hidden = false;
  initBodyEditor("personnel-biography-editor", []);
  renderCommands(); renderAwards(); renderCampaigns();
  renderSources(); renderRelated();
  renderGalleryAdmin(); renderDocumentsAdmin();
  setStatus("", false);
  if (id) { loadPersonnelIntoForm(id); translationsPanel.load(id); }
  else translationsPanel.clear();
}

function closeForm() {
  document.getElementById("personnel-form-panel").hidden = true;
  editingId = null;
}

async function loadPersonnelIntoForm(id) {
  try {
    const res = await fetch(`/api/personnel/${id}`, { headers: authHeader() });
    if (!res.ok) throw new Error();
    const r = await safeJson(res);
    const meta = r.metadata || {};
    const form = document.getElementById("personnel-form");

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

    commandsDraft = Array.isArray(meta.commands) ? [...meta.commands] : [];
    awardsDraft = Array.isArray(meta.awards) ? [...meta.awards] : [];
    campaignsDraft = Array.isArray(meta.campaigns) ? [...meta.campaigns] : [];
    sourcesDraft = Array.isArray(meta.sources) ? meta.sources.map((s) => ({ ref: s.ref || "", type: s.type || "" })) : [];
    relatedDraft = Array.isArray(meta.related_records) ? [...meta.related_records] : [];
    galleryDraft = Array.isArray(meta.gallery) ? meta.gallery.map((g) => ({ ...g })) : [];
    documentsDraft = Array.isArray(meta.documents) ? meta.documents.map((d) => ({ ...d })) : [];

    renderCommands(); renderAwards(); renderCampaigns();
    renderSources(); renderRelated();
    renderGalleryAdmin(); renderDocumentsAdmin();
  } catch (_) {
    setStatus("Failed to load personnel record.", true);
  }
}

// ── Related pick callback ─────────────────────────────────────
function pickRelated(item) {
  relatedDraft.push(item);
  renderRelated();
}

// ── Preview ───────────────────────────────────────────────────
async function showPreview() {
  if (!editingId) { alert("Save the record first, then Preview."); return; }
  toggleModal("personnel-preview-modal", true);
  const content = document.getElementById("personnel-preview-content");
  content.innerHTML = `<p class="text-dim">Loading…</p>`;
  try {
    const res = await fetch(`/api/personnel/${editingId}/preview`, { headers: authHeader() });
    if (!res.ok) throw new Error();
    const { rendered, issues } = await safeJson(res);
    const errors = issues.filter((i) => i.severity === "error");
    content.innerHTML = `
      ${errors.length ? `<div class="preview-error">
        <strong>Cannot publish — ${errors.length} blocking issue(s):</strong>
        <ul>${errors.map((e) => `<li>${escHtml(e.message)}</li>`).join("")}</ul>
      </div>` : ""}
      <h3 class="preview-title">${escHtml(rendered.name)}</h3>
      <p class="text-dim mb-1">${escHtml(rendered.rank || "")}${rendered.rank && rendered.branch ? " · " : ""}${escHtml(rendered.branch || "")}</p>
      <p class="text-dim mb-3">${escHtml(rendered.nation || "")}</p>
      <p class="mb-4">${escHtml(rendered.biography?.slice(0, 200) || "")}${(rendered.biography?.length || 0) > 200 ? "…" : ""}</p>
      <pre class="preview-json">${escHtml(JSON.stringify(rendered, null, 2))}</pre>`;
  } catch (_) {
    content.innerHTML = `<p class="text-dim">Preview unavailable.</p>`;
  }
}

// ── Submit ────────────────────────────────────────────────────
async function handleSubmit(e) {
  e.preventDefault();
  const form = e.target;

  const bioBlocks = readBodyBlocks("personnel-biography-editor");
  const biographyText = bioBlocks
    .map((b) => b.text || b.url || "")
    .filter(Boolean)
    .join("\n\n");

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
      commands: commandsDraft.filter(Boolean),
      awards: awardsDraft.filter(Boolean),
      campaigns: campaignsDraft.filter(Boolean),
      sources: sourcesDraft.filter((s) => s.ref),
      related_records: relatedDraft,
      gallery: galleryDraft.filter((g) => g.file),
      documents: documentsDraft.filter((d) => d.file),
    },
  };

  const birthDateVal = form.querySelector("[name='birthDate']").value.trim();
  const deathDateVal = form.querySelector("[name='deathDate']").value.trim();
  if (birthDateVal) body.birthDate = birthDateVal;
  if (deathDateVal) body.deathDate = deathDateVal;

  try {
    const res = await fetch(editingId ? `/api/personnel/${editingId}` : "/api/personnel", {
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
    loadPersonnel(currentPage);

    if (!document.getElementById("personnel-preview-modal")?.hidden) showPreview();
  } catch (err) {
    setStatus(err.message || "Save failed. Try again.", true);
  }
}

init();
