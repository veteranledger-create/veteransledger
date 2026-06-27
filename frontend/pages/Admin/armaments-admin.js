import { initMediaAdmin, registerCallbacks } from "./admin-media.js";
import { authHeader, escHtml, debounce, loader, toggleModal, makeStatusFn } from "./admin-utils.js";
import { initRelatedModal, openRelatedModal } from "./admin-related.js";
import { renderSources as renderSourcesFn, renderRelated as renderRelatedFn } from "./admin-form.js";
import { uploadFile, handleUpload, wireSectionActions, renderGallery, renderBlueprints, renderVideos, renderDocuments } from "./admin-media-sections.js";

/**
 * VeteransLedger · Admin — Armaments
 * Armament-specific logic only. All shared infrastructure lives in the
 * admin-utils / admin-related / admin-form / admin-media-sections modules.
 */

const SPEC_FIELDS = ["designation", "manufacturer", "crew", "weight", "armor", "armament", "engine", "speed", "range", "units_produced"];

let currentPage = 1;
let editingId = null;
let extraSpecs = [];
let sourcesDraft = [];
let relatedDraft = [];
let mediaDraft = [];
let galleryDraft = [];
let blueprintsDraft = [];
let videosDraft = [];
let documentsDraft = [];

const setStatus = makeStatusFn("armament-form-status");

// ── Local thin wrappers bind container IDs + drafts to shared renderers ──
function renderSources() { renderSourcesFn("armament-sources-list", sourcesDraft, renderSources); }
function renderRelated() { renderRelatedFn("armament-related-list", relatedDraft, renderRelated); }
function renderGalleryAdmin() { renderGallery("armament-gallery-list", "armament-gallery-count", galleryDraft, renderGalleryAdmin); }
function renderBlueprintsAdmin() { renderBlueprints("armament-blueprints-list", "armament-blueprints-count", blueprintsDraft, renderBlueprintsAdmin); }
function renderVideosAdmin() { renderVideos("armament-videos-list", "armament-videos-count", videosDraft, renderVideosAdmin); }
function renderDocumentsAdmin() { renderDocuments("armament-documents-list", "armament-documents-count", documentsDraft, renderDocumentsAdmin); }

function init() {
  initMediaAdmin();
  initRelatedModal();
  registerCallbacks(uploadFile, setStatus);

  document.getElementById("admin-tabs")?.addEventListener("click", (e) => {
    if (e.target.closest('[data-tab="tab-armaments"]')) {
      registerCallbacks(uploadFile, setStatus);
      loadArmaments(1);
    }
  });

  document.getElementById("armament-new-btn")?.addEventListener("click", () => openForm(null));
  document.getElementById("armament-cancel-btn")?.addEventListener("click", closeForm);
  document.getElementById("armament-filter-category")?.addEventListener("change", () => loadArmaments(1));
  document.getElementById("armament-filter-search")?.addEventListener("input", debounce(() => loadArmaments(1), 350));
  document.getElementById("armament-add-spec-btn")?.addEventListener("click", () => { extraSpecs.push({ key: "", value: "" }); renderExtraSpecs(); });
  document.getElementById("armament-add-source-btn")?.addEventListener("click", () => { sourcesDraft.push({ ref: "", type: "" }); renderSources(); });
  document.getElementById("armament-add-related-btn")?.addEventListener("click", () => openRelatedModal(pickRelated));
  document.getElementById("armament-attach-media-btn")?.addEventListener("click", openMediaModal);
  document.getElementById("armament-preview-btn")?.addEventListener("click", showPreview);
  document.getElementById("armament-form")?.addEventListener("submit", handleSubmit);
  document.getElementById("media-attach-modal-close")?.addEventListener("click", () => toggleModal("media-attach-modal", false));
  document.getElementById("armament-preview-modal-close")?.addEventListener("click", () => toggleModal("armament-preview-modal", false));

  document.getElementById("armament-gallery-upload")?.addEventListener("change", (e) => handleUpload(e.target.files, "armament-gallery-upload", galleryDraft, renderGalleryAdmin, setStatus));
  document.getElementById("armament-blueprints-upload")?.addEventListener("change", (e) => handleUpload(e.target.files, "armament-blueprints-upload", blueprintsDraft, renderBlueprintsAdmin, setStatus));
  document.getElementById("armament-videos-upload")?.addEventListener("change", (e) => handleUpload(e.target.files, "armament-videos-upload", videosDraft, renderVideosAdmin, setStatus, true));
  document.getElementById("armament-documents-upload")?.addEventListener("change", (e) => handleUpload(e.target.files, "armament-documents-upload", documentsDraft, renderDocumentsAdmin, setStatus));

  wireSectionActions("armament", "gallery", galleryDraft, renderGalleryAdmin, "image");
  wireSectionActions("armament", "blueprints", blueprintsDraft, renderBlueprintsAdmin, "blueprint");
  wireSectionActions("armament", "videos", videosDraft, renderVideosAdmin, "video");
  wireSectionActions("armament", "documents", documentsDraft, renderDocumentsAdmin, "document");
}

// ── List ──────────────────────────────────────────────────────
async function loadArmaments(page = 1) {
  currentPage = page;
  const container = document.getElementById("armament-list");
  if (!container) return;
  container.innerHTML = loader();

  const category = document.getElementById("armament-filter-category")?.value || "";
  const search = document.getElementById("armament-filter-search")?.value || "";
  const params = new URLSearchParams({ page, limit: 20, ...(category && { category }), ...(search && { search }) });

  try {
    const res = await fetch(`/api/armaments?${params}`, { headers: authHeader() });
    if (!res.ok) throw new Error();
    renderList(container, await res.json());
  } catch (_) {
    container.innerHTML = `<p style="color:var(--text-muted)">Armaments unavailable.</p>`;
  }
}

function renderList(container, { data, total, page, pages }) {
  if (!data.length) {
    container.innerHTML = `<p style="color:var(--text-muted)">No armaments yet. Create one above.</p>`;
    return;
  }
  container.innerHTML = `
    <p style="font-size:var(--text-xs);color:var(--text-muted);margin-bottom:var(--space-4);">${total} armaments · page ${page} of ${pages}</p>
    <table style="width:100%;border-collapse:collapse;font-size:var(--text-sm);">
      <thead>
        <tr style="border-bottom:1px solid var(--border-dim);color:var(--text-muted);text-align:left;">
          <th style="padding:var(--space-3) var(--space-4);">Title</th>
          <th style="padding:var(--space-3) var(--space-4);">Category</th>
          <th style="padding:var(--space-3) var(--space-4);">Nation</th>
          <th style="padding:var(--space-3) var(--space-4);">Status</th>
          <th style="padding:var(--space-3) var(--space-4);text-align:right;">Actions</th>
        </tr>
      </thead>
      <tbody>
        ${data.map((r) => {
          const meta = r.metadata || {};
          return `
          <tr style="border-bottom:1px solid var(--border-dim);">
            <td style="padding:var(--space-3) var(--space-4);color:var(--text-primary);">${escHtml(r.title)}</td>
            <td style="padding:var(--space-3) var(--space-4);"><span class="badge">${escHtml(meta.category || "—")}</span></td>
            <td style="padding:var(--space-3) var(--space-4);color:var(--text-muted);">${escHtml(meta.nation || r.nationality || "—")}</td>
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
  container.querySelectorAll("[data-delete]").forEach((btn) => btn.addEventListener("click", () => deleteArmament(btn.dataset.delete)));
  container.querySelectorAll("[data-page]").forEach((btn) => btn.addEventListener("click", () => loadArmaments(+btn.dataset.page)));
}

async function deleteArmament(id) {
  if (!confirm("Delete this armament? This cannot be undone.")) return;
  try {
    const res = await fetch(`/api/armaments/${id}`, { method: "DELETE", headers: authHeader() });
    if (!res.ok) throw new Error();
    loadArmaments(currentPage);
  } catch (_) {
    alert("Delete failed. Try again.");
  }
}

// ── Form ──────────────────────────────────────────────────────
function openForm(id) {
  editingId = id;
  extraSpecs = []; sourcesDraft = []; relatedDraft = []; mediaDraft = [];
  galleryDraft = []; blueprintsDraft = []; videosDraft = []; documentsDraft = [];
  document.getElementById("armament-form")?.reset();
  document.getElementById("armament-form-title").textContent = id ? "Edit Armament" : "New Armament";
  document.getElementById("armament-form-panel").hidden = false;
  document.getElementById("armament-duplicate-warning").hidden = true;
  renderExtraSpecs(); renderSources(); renderRelated(); renderMedia();
  renderGalleryAdmin(); renderBlueprintsAdmin(); renderVideosAdmin(); renderDocumentsAdmin();
  setStatus("", false);
  if (id) loadArmamentIntoForm(id);
}

function closeForm() {
  document.getElementById("armament-form-panel").hidden = true;
  editingId = null;
}

async function loadArmamentIntoForm(id) {
  try {
    const res = await fetch(`/api/armaments/${id}`, { headers: authHeader() });
    if (!res.ok) throw new Error();
    const r = await res.json();
    const meta = r.metadata || {};
    const form = document.getElementById("armament-form");
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

    const knownKeys = new Set(["category", "nation", "sources", "related_records", "importRunId", "fileNation", "schemaType", "gallery", "blueprints", "videos", "documents", ...SPEC_FIELDS]);
    extraSpecs = Object.entries(meta).filter(([k]) => !knownKeys.has(k)).map(([key, value]) => ({ key, value: typeof value === "object" ? JSON.stringify(value) : String(value) }));
    sourcesDraft = Array.isArray(meta.sources) ? meta.sources.map((s) => ({ ref: s.ref || "", type: s.type || "" })) : [];
    relatedDraft = Array.isArray(meta.related_records) ? [...meta.related_records] : [];
    mediaDraft = Array.isArray(r.media) ? [...r.media] : [];
    galleryDraft = Array.isArray(meta.gallery) ? meta.gallery.map((g) => ({ ...g })) : [];
    blueprintsDraft = Array.isArray(meta.blueprints) ? meta.blueprints.map((b) => ({ ...b })) : [];
    videosDraft = Array.isArray(meta.videos) ? meta.videos.map((v) => ({ ...v })) : [];
    documentsDraft = Array.isArray(meta.documents) ? meta.documents.map((d) => ({ ...d })) : [];

    renderExtraSpecs(); renderSources(); renderRelated(); renderMedia();
    renderGalleryAdmin(); renderBlueprintsAdmin(); renderVideosAdmin(); renderDocumentsAdmin();
  } catch (_) {
    setStatus("Failed to load armament.", true);
  }
}

// ── Armament-specific: extra specs ───────────────────────────
function renderExtraSpecs() {
  const container = document.getElementById("armament-extra-specs");
  if (!container) return;
  container.innerHTML = extraSpecs.map((s, i) => `
    <div style="display:flex;gap:var(--space-2);margin-bottom:var(--space-2);">
      <input class="contact-form__input" placeholder="Field name" value="${escHtml(s.key)}" data-spec-key="${i}" style="flex:1;">
      <input class="contact-form__input" placeholder="Value" value="${escHtml(s.value)}" data-spec-value="${i}" style="flex:1;">
      <button type="button" class="btn btn-secondary" data-spec-remove="${i}" style="font-size:11px;">✕</button>
    </div>`).join("");
  container.querySelectorAll("[data-spec-key]").forEach((el) => el.addEventListener("input", (e) => { extraSpecs[+el.dataset.specKey].key = e.target.value; }));
  container.querySelectorAll("[data-spec-value]").forEach((el) => el.addEventListener("input", (e) => { extraSpecs[+el.dataset.specValue].value = e.target.value; }));
  container.querySelectorAll("[data-spec-remove]").forEach((el) => el.addEventListener("click", () => { extraSpecs.splice(+el.dataset.specRemove, 1); renderExtraSpecs(); }));
}

// ── Armament-specific: legacy media-library attach ───────────
function renderMedia() {
  const container = document.getElementById("armament-media-list");
  if (!container) return;
  if (!mediaDraft.length) {
    container.innerHTML = `<p style="font-size:var(--text-sm);color:var(--text-muted);">No media attached.</p>`;
    return;
  }
  container.innerHTML = `<div style="display:flex;gap:var(--space-3);flex-wrap:wrap;">${mediaDraft.map((m, i) => `
    <div style="position:relative;">
      <img src="${escHtml(m.thumbnailUrl || m.url)}" alt="${escHtml(m.originalName || "")}" style="width:80px;height:60px;object-fit:cover;border-radius:4px;">
      <button type="button" data-media-remove="${i}" style="position:absolute;top:-6px;right:-6px;background:#4a1515;color:#fff;border:none;border-radius:50%;width:18px;height:18px;font-size:10px;cursor:pointer;">✕</button>
    </div>`).join("")}</div>`;
  container.querySelectorAll("[data-media-remove]").forEach((el) => el.addEventListener("click", () => { mediaDraft.splice(+el.dataset.mediaRemove, 1); renderMedia(); }));
}

async function openMediaModal() {
  toggleModal("media-attach-modal", true);
  const grid = document.getElementById("media-attach-grid");
  grid.innerHTML = `<p style="color:var(--text-muted);">Loading…</p>`;
  try {
    const res = await fetch("/api/media?limit=60", { headers: authHeader() });
    if (!res.ok) throw new Error();
    const data = await res.json();
    const assets = data.data || [];
    if (!assets.length) { grid.innerHTML = `<p style="color:var(--text-muted);">No media uploaded yet — use the Media tab first.</p>`; return; }
    grid.innerHTML = assets.map((a, i) => `
      <div data-pick-media="${i}" style="cursor:pointer;border:2px solid transparent;border-radius:4px;">
        <img src="${escHtml(a.thumbnailUrl || a.url)}" alt="${escHtml(a.originalName)}" style="width:100%;height:80px;object-fit:cover;border-radius:4px;">
      </div>`).join("");
    grid.querySelectorAll("[data-pick-media]").forEach((el) => el.addEventListener("click", () => {
      const asset = assets[+el.dataset.pickMedia];
      if (!mediaDraft.some((m) => m.id === asset.id)) mediaDraft.push(asset);
      renderMedia();
      toggleModal("media-attach-modal", false);
    }));
  } catch (_) {
    grid.innerHTML = `<p style="color:var(--text-muted);">Media library unavailable.</p>`;
  }
}

// ── Related-record pick callback ──────────────────────────────
function pickRelated(item) {
  relatedDraft.push(item);
  renderRelated();
}

// ── Preview ───────────────────────────────────────────────────
async function showPreview() {
  if (!editingId) { alert("Save the armament first, then Preview."); return; }
  toggleModal("armament-preview-modal", true);
  const content = document.getElementById("armament-preview-content");
  content.innerHTML = `<p style="color:var(--text-muted);">Loading…</p>`;
  try {
    const res = await fetch(`/api/armaments/${editingId}/preview`, { headers: authHeader() });
    if (!res.ok) throw new Error();
    const { rendered, issues } = await res.json();
    const errors = issues.filter((i) => i.severity === "error");
    content.innerHTML = `
      ${errors.length ? `<div style="background:#3a1515;border:1px solid #6a2020;border-radius:4px;padding:var(--space-3);margin-bottom:var(--space-4);color:#e06060;font-size:var(--text-sm);">
        <strong>Cannot publish — ${errors.length} blocking issue(s):</strong>
        <ul style="margin:var(--space-2) 0 0 var(--space-4);">${errors.map((e) => `<li>${escHtml(e.message)}</li>`).join("")}</ul>
      </div>` : ""}
      <h3 style="font-family:var(--font-display);margin-bottom:var(--space-2);">${escHtml(rendered.name)}</h3>
      <p style="color:var(--text-muted);margin-bottom:var(--space-3);">${escHtml(rendered.nation || "")}</p>
      <p style="margin-bottom:var(--space-4);">${escHtml(rendered.summary || "")}</p>
      <pre style="font-size:11px;background:rgba(255,255,255,0.03);padding:var(--space-3);border-radius:4px;overflow-x:auto;">${escHtml(JSON.stringify(rendered, null, 2))}</pre>`;
  } catch (_) {
    content.innerHTML = `<p style="color:var(--text-muted);">Preview unavailable.</p>`;
  }
}

// ── Submit ────────────────────────────────────────────────────
async function checkDuplicatesLive(category, title) {
  if (!category || !title) return;
  try {
    const params = new URLSearchParams({ category, name: title, ...(editingId && { excludeId: editingId }) });
    const res = await fetch(`/api/armaments/check-duplicates?${params}`, { headers: authHeader() });
    if (!res.ok) return;
    const candidates = await res.json();
    const warningEl = document.getElementById("armament-duplicate-warning");
    if (candidates.length) {
      warningEl.hidden = false;
      warningEl.textContent = `Possible duplicate: ${candidates.length} existing armament(s) in this category share a normalized name (e.g. "${candidates[0].title}"). You can still save as a draft — publish will be blocked until this is resolved.`;
    } else {
      warningEl.hidden = true;
    }
  } catch (_) { /* non-blocking by design */ }
}

async function handleSubmit(e) {
  e.preventDefault();
  const form = e.target;
  const category = form.querySelector("[name='category']").value;
  const title = form.querySelector("[name='title']").value.trim();
  await checkDuplicatesLive(category, title);

  const specs = {};
  for (const field of SPEC_FIELDS) {
    const value = form.querySelector(`[name='spec_${field}']`)?.value;
    if (value) specs[field] = field === "crew" || field === "units_produced" ? Number(value) : value;
  }
  for (const { key, value } of extraSpecs) {
    if (key) specs[key] = value;
  }

  const body = {
    title,
    summary: form.querySelector("[name='summary']").value.trim() || undefined,
    category,
    nation: form.querySelector("[name='nation']").value.trim(),
    specs,
    sources: sourcesDraft.filter((s) => s.ref),
    related_records: relatedDraft,
    gallery: galleryDraft.filter((g) => g.file),
    blueprints: blueprintsDraft.filter((b) => b.file),
    videos: videosDraft.filter((v) => v.file),
    documents: documentsDraft.filter((d) => d.file),
    published: form.querySelector("[name='published']").checked,
  };

  try {
    const res = await fetch(editingId ? `/api/armaments/${editingId}` : "/api/armaments", {
      method: editingId ? "PUT" : "POST",
      headers: { ...authHeader(), "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!res.ok) throw new Error();
    const saved = await res.json();
    editingId = saved.id;
    form.querySelector("[name='id']").value = saved.id;

    if (mediaDraft.length) {
      await fetch(`/api/armaments/${saved.id}/media`, {
        method: "PUT",
        headers: { ...authHeader(), "Content-Type": "application/json" },
        body: JSON.stringify({ attach: mediaDraft.map((m) => m.id), detach: [] }),
      });
    }

    setStatus("Saved.", false);
    loadArmaments(currentPage);

    if (!document.getElementById("armament-preview-modal")?.hidden) showPreview();
  } catch (_) {
    setStatus("Save failed. Try again.", true);
  }
}

init();
