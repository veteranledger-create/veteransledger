/**
 * VeteransLedger · Admin — Personnel
 * Dedicated workflow for the Personnel content type. Personnel use the Entity
 * model (not Record), so fields differ from other content types: name,
 * nationality, birthDate, deathDate, biography, summary at the top level;
 * rank, branch, service, birthplace, portrait, commands, awards, campaigns,
 * gallery, documents in metadata.
 */

import {
  initMediaAdmin, registerCallbacks, mediaItemControls, updateSectionCount,
  wireMediaItemControls, clearSectionAttribution, validateMediaUrls, DOC_TYPE_OPTIONS,
} from "./admin-media.js";

function authHeader() {
  const token = sessionStorage.getItem("vl_admin_token");
  return token ? { Authorization: `Bearer ${token}` } : {};
}

function escHtml(str = "") {
  return String(str).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

function debounce(fn, ms) {
  let t;
  return (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), ms); };
}

const BRANCH_OPTIONS = [
  { value: "army",        label: "Army" },
  { value: "kriegsmarine", label: "Kriegsmarine" },
  { value: "luftwaffe",   label: "Luftwaffe" },
  { value: "waffen-ss",   label: "Waffen-SS" },
  { value: "foreign",     label: "Foreign / Other" },
];

const TYPE_LABEL_MAP = { PERSON: "Personnel", LETTER: "Letter", ARTICLE: "Article", CAMPAIGN: "Campaign", ARMAMENT: "Armament" };

let currentPage = 1;
let editingId = null;
let commandsDraft = [];
let awardsDraft = [];
let campaignsDraft = [];
let sourcesDraft = [];
let relatedDraft = [];
let galleryDraft = [];
let documentsDraft = [];

function init() {
  initMediaAdmin();
  registerCallbacks(uploadMediaFile, setFormStatus);

  document.getElementById("admin-tabs")?.addEventListener("click", (e) => {
    if (e.target.closest('[data-tab="tab-personnel"]')) {
      registerCallbacks(uploadMediaFile, setFormStatus);
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
  document.getElementById("personnel-add-related-btn")?.addEventListener("click", openRelatedModal);
  document.getElementById("related-record-modal-close")?.addEventListener("click", () => toggleModal("related-record-modal", false));
  document.getElementById("related-record-search-input")?.addEventListener("input", debounce(runRelatedSearch, 350));

  document.getElementById("personnel-portrait-upload")?.addEventListener("change", async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    setFormStatus("Uploading portrait…", false);
    try {
      const asset = await uploadMediaFile(file);
      document.getElementById("personnel-portrait-url").value = asset.url;
      e.target.value = "";
      setFormStatus("Portrait uploaded. Save to persist.", false);
    } catch (_) {
      setFormStatus("Portrait upload failed.", true);
    }
  });

  document.getElementById("personnel-gallery-upload")?.addEventListener("change", (e) => handleMediaUpload(e.target.files, "gallery"));
  document.getElementById("personnel-documents-upload")?.addEventListener("change", (e) => handleMediaUpload(e.target.files, "documents"));

  document.getElementById("personnel-gallery-check-urls")?.addEventListener("click", () => validateMediaUrls(galleryDraft, renderGalleryAdmin));
  document.getElementById("personnel-gallery-clear-attr")?.addEventListener("click", () => clearSectionAttribution(galleryDraft, renderGalleryAdmin, "image"));
  document.getElementById("personnel-gallery-delete-all")?.addEventListener("click", () => {
    if (!galleryDraft.length) return;
    if (!confirm(`Remove all ${galleryDraft.length} gallery image(s)?`)) return;
    galleryDraft.length = 0; renderGalleryAdmin();
  });

  document.getElementById("personnel-documents-check-urls")?.addEventListener("click", () => validateMediaUrls(documentsDraft, renderDocumentsAdmin));
  document.getElementById("personnel-documents-clear-attr")?.addEventListener("click", () => clearSectionAttribution(documentsDraft, renderDocumentsAdmin, "document"));
  document.getElementById("personnel-documents-delete-all")?.addEventListener("click", () => {
    if (!documentsDraft.length) return;
    if (!confirm(`Remove all ${documentsDraft.length} document(s)?`)) return;
    documentsDraft.length = 0; renderDocumentsAdmin();
  });
}

function toggleModal(id, show) {
  const el = document.getElementById(id);
  if (el) el.hidden = !show;
}

// ── List ──────────────────────────────────────────────────────
async function loadPersonnel(page = 1) {
  currentPage = page;
  const container = document.getElementById("personnel-list");
  if (!container) return;
  container.innerHTML = `<div class="loader"><span class="loader__dot"></span><span class="loader__dot"></span><span class="loader__dot"></span></div>`;

  const branch = document.getElementById("personnel-filter-branch")?.value || "";
  const search = document.getElementById("personnel-filter-search")?.value || "";
  const params = new URLSearchParams({ page, limit: 20, ...(branch && { branch }), ...(search && { search }) });

  try {
    const res = await fetch(`/api/personnel?${params}`, { headers: authHeader() });
    if (!res.ok) throw new Error();
    renderList(container, await res.json());
  } catch (_) {
    container.innerHTML = `<p style="color:var(--text-muted)">Personnel unavailable.</p>`;
  }
}

function renderList(container, { data, total, page, pages }) {
  if (!data.length) {
    container.innerHTML = `<p style="color:var(--text-muted)">No personnel records yet. Create one above.</p>`;
    return;
  }
  container.innerHTML = `
    <p style="font-size:var(--text-xs);color:var(--text-muted);margin-bottom:var(--space-4);">${total} records · page ${page} of ${pages}</p>
    <table style="width:100%;border-collapse:collapse;font-size:var(--text-sm);">
      <thead>
        <tr style="border-bottom:1px solid var(--border-dim);color:var(--text-muted);text-align:left;">
          <th style="padding:var(--space-3) var(--space-4);">Name</th>
          <th style="padding:var(--space-3) var(--space-4);">Branch</th>
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
            <td style="padding:var(--space-3) var(--space-4);color:var(--text-primary);">${escHtml(r.name)}</td>
            <td style="padding:var(--space-3) var(--space-4);"><span class="badge">${escHtml(meta.branch || "—")}</span></td>
            <td style="padding:var(--space-3) var(--space-4);color:var(--text-muted);">${escHtml(r.nationality || "—")}</td>
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
  commandsDraft = [];
  awardsDraft = [];
  campaignsDraft = [];
  sourcesDraft = [];
  relatedDraft = [];
  galleryDraft = [];
  documentsDraft = [];
  document.getElementById("personnel-form")?.reset();
  document.getElementById("personnel-form-title").textContent = id ? "Edit Personnel Record" : "New Personnel Record";
  document.getElementById("personnel-form-panel").hidden = false;
  renderCommands(); renderAwards(); renderCampaigns();
  renderSources(); renderRelated();
  renderGalleryAdmin(); renderDocumentsAdmin();
  setFormStatus("", false);
  if (id) loadPersonnelIntoForm(id);
}

function closeForm() {
  document.getElementById("personnel-form-panel").hidden = true;
  editingId = null;
}

async function loadPersonnelIntoForm(id) {
  try {
    const res = await fetch(`/api/personnel/${id}`, { headers: authHeader() });
    if (!res.ok) throw new Error();
    const r = await res.json();
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
    form.querySelector("[name='biography']").value = r.biography || "";
    form.querySelector("[name='published']").checked = !!r.published;
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
    setFormStatus("Failed to load personnel record.", true);
  }
}

// ── Dynamic string lists (commands / awards / campaigns) ──────
function renderStringList(containerId, draft, dataAttr, label) {
  const container = document.getElementById(containerId);
  if (!container) return;
  container.innerHTML = draft.map((val, i) => `
    <div style="display:flex;gap:var(--space-2);margin-bottom:var(--space-2);">
      <input class="contact-form__input" placeholder="${escHtml(label)}" value="${escHtml(val)}" data-${dataAttr}="${i}" style="flex:1;">
      <button type="button" class="btn btn-secondary" data-${dataAttr}-remove="${i}" style="font-size:11px;">✕</button>
    </div>`).join("");
  container.querySelectorAll(`[data-${dataAttr}]`).forEach((el) => el.addEventListener("input", (e) => { draft[+el.dataset[dataAttr]] = e.target.value; }));
  container.querySelectorAll(`[data-${dataAttr}-remove]`).forEach((el) => el.addEventListener("click", () => { draft.splice(+el.dataset[`${dataAttr}Remove`], 1); renderStringList(containerId, draft, dataAttr, label); }));
}

function renderCommands() { renderStringList("personnel-commands-list", commandsDraft, "cmd", "Command / unit"); }
function renderAwards() { renderStringList("personnel-awards-list", awardsDraft, "award", "Award / decoration"); }
function renderCampaigns() { renderStringList("personnel-campaigns-list", campaignsDraft, "campaign", "Campaign / theatre"); }

// ── Sources ───────────────────────────────────────────────────
function renderSources() {
  const container = document.getElementById("personnel-sources-list");
  if (!container) return;
  container.innerHTML = sourcesDraft.map((s, i) => `
    <div style="display:flex;gap:var(--space-2);margin-bottom:var(--space-2);">
      <input class="contact-form__input" placeholder="Reference" value="${escHtml(s.ref)}" data-source-ref="${i}" style="flex:2;">
      <input class="contact-form__input" placeholder="Type (e.g. primary)" value="${escHtml(s.type)}" data-source-type="${i}" style="flex:1;">
      <button type="button" class="btn btn-secondary" data-source-remove="${i}" style="font-size:11px;">✕</button>
    </div>`).join("");
  container.querySelectorAll("[data-source-ref]").forEach((el) => el.addEventListener("input", (e) => { sourcesDraft[+el.dataset.sourceRef].ref = e.target.value; }));
  container.querySelectorAll("[data-source-type]").forEach((el) => el.addEventListener("input", (e) => { sourcesDraft[+el.dataset.sourceType].type = e.target.value; }));
  container.querySelectorAll("[data-source-remove]").forEach((el) => el.addEventListener("click", () => { sourcesDraft.splice(+el.dataset.sourceRemove, 1); renderSources(); }));
}

// ── Related records ───────────────────────────────────────────
function renderRelated() {
  const container = document.getElementById("personnel-related-list");
  if (!container) return;
  if (!relatedDraft.length) {
    container.innerHTML = `<p style="font-size:var(--text-sm);color:var(--text-muted);">None selected.</p>`;
    return;
  }
  container.innerHTML = relatedDraft.map((r, i) => `
    <div style="display:flex;justify-content:space-between;align-items:center;padding:var(--space-2) var(--space-3);background:rgba(255,255,255,0.03);border-radius:4px;margin-bottom:var(--space-2);font-size:var(--text-sm);">
      <span><span class="badge" style="margin-right:var(--space-2);">${escHtml(r.type)}</span>${escHtml(r.title)} <span style="color:var(--text-muted);">(${escHtml(r.url || r.id)})</span></span>
      <button type="button" class="btn btn-secondary" data-related-remove="${i}" style="font-size:11px;">✕</button>
    </div>`).join("");
  container.querySelectorAll("[data-related-remove]").forEach((el) => el.addEventListener("click", () => { relatedDraft.splice(+el.dataset.relatedRemove, 1); renderRelated(); }));
}

function openRelatedModal() {
  toggleModal("related-record-modal", true);
  document.getElementById("related-record-search-input").value = "";
  document.getElementById("related-record-search-results").innerHTML = "";
}

async function runRelatedSearch(e) {
  const query = e.target.value.trim();
  const resultsEl = document.getElementById("related-record-search-results");
  if (query.length < 2) { resultsEl.innerHTML = ""; return; }
  resultsEl.innerHTML = `<p style="color:var(--text-muted);">Searching…</p>`;
  try {
    const res = await fetch(`/api/search?q=${encodeURIComponent(query)}`, { headers: authHeader() });
    if (!res.ok) throw new Error();
    const data = await res.json();
    const items = [
      ...(data.entities || []).map((p) => ({ id: p.id, slug: p.slug, title: p.name, type: "PERSON" })),
      ...(data.records || []).map((r) => ({ id: r.id, slug: r.slug, title: r.title, type: r.type })),
    ];
    if (!items.length) { resultsEl.innerHTML = `<p style="color:var(--text-muted);">No results.</p>`; return; }
    resultsEl.innerHTML = items.map((item, i) => `
      <div style="display:flex;justify-content:space-between;align-items:center;padding:var(--space-2) var(--space-3);border-bottom:1px solid var(--border-dim);cursor:pointer;" data-pick="${i}">
        <span><span class="badge" style="margin-right:var(--space-2);">${escHtml(item.type)}</span>${escHtml(item.title)}</span>
      </div>`).join("");
    resultsEl.querySelectorAll("[data-pick]").forEach((el) => el.addEventListener("click", () => pickRelated(items[+el.dataset.pick])));
  } catch (_) {
    resultsEl.innerHTML = `<p style="color:var(--text-muted);">Search failed.</p>`;
  }
}

async function pickRelated(item) {
  const type = TYPE_LABEL_MAP[item.type] || item.type;
  const slugOrId = item.slug || item.id;
  let url = null;
  try {
    const res = await fetch(`/api/armaments/resolve-url?type=${encodeURIComponent(type)}&id=${encodeURIComponent(slugOrId)}`, { headers: authHeader() });
    url = (await res.json()).url;
  } catch (_) {}
  relatedDraft.push({ id: slugOrId, title: item.title, type, url });
  renderRelated();
  toggleModal("related-record-modal", false);
}

// ── Media upload ──────────────────────────────────────────────
async function uploadMediaFile(file) {
  const fd = new FormData();
  fd.append("file", file);
  const res = await fetch("/api/media/upload", { method: "POST", headers: authHeader(), body: fd });
  if (!res.ok) throw new Error(`Upload failed (${res.status})`);
  return await res.json();
}

async function handleMediaUpload(files, section) {
  if (!files || !files.length) return;
  const draft = section === "gallery" ? galleryDraft : documentsDraft;
  const renderFn = section === "gallery" ? renderGalleryAdmin : renderDocumentsAdmin;
  setFormStatus(`Uploading ${files.length} file(s)…`, false);

  const errors = [];
  for (const file of files) {
    try {
      const asset = await uploadMediaFile(file);
      const item = { file: asset.url, title: file.name.replace(/\.[^.]+$/, "").replace(/[-_]/g, " "), caption: "", source: "" };
      draft.push(item);
    } catch (_) {
      errors.push(file.name);
    }
  }

  const input = document.getElementById(`personnel-${section}-upload`);
  if (input) input.value = "";
  renderFn();
  if (errors.length) setFormStatus(`Upload failed for: ${errors.join(", ")}. Others saved.`, true);
  else setFormStatus(`${files.length} file(s) uploaded. Save the form to persist.`, false);
}

// ── Gallery ───────────────────────────────────────────────────
function renderGalleryAdmin() {
  const container = document.getElementById("personnel-gallery-list");
  if (!container) return;
  updateSectionCount("personnel-gallery-count", galleryDraft.length, "image", "images");
  if (!galleryDraft.length) {
    container.innerHTML = `<p class="media-empty-state">No gallery images yet.</p>`;
    return;
  }
  container.innerHTML = galleryDraft.map((g, i) => `
    <div class="media-card">
      <div class="media-card__body">
        <img class="media-card__thumb" src="${escHtml(g.file)}" alt="" onerror="this.style.opacity='0.25'">
        <div class="media-card__fields">
          <input class="contact-form__input" placeholder="Title" value="${escHtml(g.title || "")}" data-gallery-title="${i}">
          <div class="media-card__row2">
            <input class="contact-form__input" placeholder="Caption" value="${escHtml(g.caption || "")}" data-gallery-caption="${i}">
            <input class="contact-form__input" placeholder="Source / citation" value="${escHtml(g.source || "")}" data-gallery-source="${i}">
          </div>
          <div class="media-card__url">${escHtml(g.file)}</div>
        </div>
      </div>
      ${mediaItemControls(galleryDraft, i, renderGalleryAdmin, "image")}
    </div>`).join("");
  container.querySelectorAll("[data-gallery-title]").forEach((el) => el.addEventListener("input", () => { galleryDraft[+el.dataset.galleryTitle].title = el.value; }));
  container.querySelectorAll("[data-gallery-caption]").forEach((el) => el.addEventListener("input", () => { galleryDraft[+el.dataset.galleryCaption].caption = el.value; }));
  container.querySelectorAll("[data-gallery-source]").forEach((el) => el.addEventListener("input", () => { galleryDraft[+el.dataset.gallerySource].source = el.value; }));
  wireMediaItemControls(container, galleryDraft, renderGalleryAdmin, "image");
}

// ── Documents ─────────────────────────────────────────────────
function renderDocumentsAdmin() {
  const container = document.getElementById("personnel-documents-list");
  if (!container) return;
  updateSectionCount("personnel-documents-count", documentsDraft.length, "document", "documents");
  if (!documentsDraft.length) {
    container.innerHTML = `<p class="media-empty-state">No documents yet.</p>`;
    return;
  }
  container.innerHTML = documentsDraft.map((d, i) => `
    <div class="media-card">
      <div class="media-card__body">
        <div class="media-card__icon" title="${escHtml(d.file)}">
          <img src="/public/images/icons/ui/file.svg" alt="" width="28" height="28" style="opacity:0.7;" onerror="this.parentElement.textContent='📄'">
        </div>
        <div class="media-card__fields">
          <input class="contact-form__input" placeholder="Title" value="${escHtml(d.title || "")}" data-doc-title="${i}">
          <div class="media-card__row2">
            <select class="contact-form__input" data-doc-type="${i}">
              ${DOC_TYPE_OPTIONS.map((o) => `<option value="${o.value}"${d.type === o.value ? " selected" : ""}>${o.label}</option>`).join("")}
            </select>
            <input class="contact-form__input" placeholder="Caption / description" value="${escHtml(d.caption || "")}" data-doc-caption="${i}">
          </div>
          <div class="media-card__url">${escHtml(d.file)}</div>
        </div>
      </div>
      ${mediaItemControls(documentsDraft, i, renderDocumentsAdmin, "document")}
    </div>`).join("");
  container.querySelectorAll("[data-doc-title]").forEach((el) => el.addEventListener("input", () => { documentsDraft[+el.dataset.docTitle].title = el.value; }));
  container.querySelectorAll("[data-doc-type]").forEach((el) => el.addEventListener("change", () => { documentsDraft[+el.dataset.docType].type = el.value; }));
  container.querySelectorAll("[data-doc-caption]").forEach((el) => el.addEventListener("input", () => { documentsDraft[+el.dataset.docCaption].caption = el.value; }));
  wireMediaItemControls(container, documentsDraft, renderDocumentsAdmin, "document");
}

// ── Preview ───────────────────────────────────────────────────
async function showPreview() {
  if (!editingId) { alert("Save the record first, then Preview."); return; }
  toggleModal("personnel-preview-modal", true);
  const content = document.getElementById("personnel-preview-content");
  content.innerHTML = `<p style="color:var(--text-muted);">Loading…</p>`;
  try {
    const res = await fetch(`/api/personnel/${editingId}/preview`, { headers: authHeader() });
    if (!res.ok) throw new Error();
    const { rendered, issues } = await res.json();
    const errors = issues.filter((i) => i.severity === "error");
    content.innerHTML = `
      ${errors.length ? `<div style="background:#3a1515;border:1px solid #6a2020;border-radius:4px;padding:var(--space-3);margin-bottom:var(--space-4);color:#e06060;font-size:var(--text-sm);">
        <strong>Cannot publish — ${errors.length} blocking issue(s):</strong>
        <ul style="margin:var(--space-2) 0 0 var(--space-4);">${errors.map((e) => `<li>${escHtml(e.message)}</li>`).join("")}</ul>
      </div>` : ""}
      <h3 style="font-family:var(--font-display);margin-bottom:var(--space-2);">${escHtml(rendered.name)}</h3>
      <p style="color:var(--text-muted);margin-bottom:var(--space-1);">${escHtml(rendered.rank || "")}${rendered.rank && rendered.branch ? " · " : ""}${escHtml(rendered.branch || "")}</p>
      <p style="color:var(--text-muted);margin-bottom:var(--space-3);">${escHtml(rendered.nation || "")}</p>
      <p style="margin-bottom:var(--space-4);">${escHtml(rendered.biography?.slice(0, 200) || "")}${(rendered.biography?.length || 0) > 200 ? "…" : ""}</p>
      <pre style="font-size:11px;background:rgba(255,255,255,0.03);padding:var(--space-3);border-radius:4px;overflow-x:auto;">${escHtml(JSON.stringify(rendered, null, 2))}</pre>`;
  } catch (_) {
    content.innerHTML = `<p style="color:var(--text-muted);">Preview unavailable.</p>`;
  }
}

// ── Submit ────────────────────────────────────────────────────
function setFormStatus(msg, isError) {
  const el = document.getElementById("personnel-form-status");
  if (el) { el.textContent = msg; el.style.color = isError ? "#e06060" : "#60c060"; }
}

async function handleSubmit(e) {
  e.preventDefault();
  const form = e.target;

  const body = {
    name: form.querySelector("[name='name']").value.trim(),
    nationality: form.querySelector("[name='nationality']").value.trim() || undefined,
    biography: form.querySelector("[name='biography']").value.trim() || undefined,
    summary: form.querySelector("[name='summary']").value.trim() || undefined,
    published: form.querySelector("[name='published']").checked,
    metadata: {
      branch: form.querySelector("[name='branch']").value || undefined,
      rank: form.querySelector("[name='rank']").value.trim() || undefined,
      service: form.querySelector("[name='service']").value.trim() || undefined,
      birthplace: form.querySelector("[name='birthplace']").value.trim() || undefined,
      portrait: document.getElementById("personnel-portrait-url").value.trim() || undefined,
      commands: commandsDraft.filter(Boolean),
      awards: awardsDraft.filter(Boolean),
      campaigns: campaignsDraft.filter(Boolean),
      sources: sourcesDraft.filter((s) => s.ref),
      related_records: relatedDraft,
      gallery: galleryDraft.filter((g) => g.file),
      documents: documentsDraft.filter((d) => d.file),
    },
  };

  // Include date fields only when non-empty so Prisma doesn't try to parse ""
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
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error || "Save failed.");
    }
    const saved = await res.json();
    editingId = saved.id;
    setFormStatus("Saved.", false);
    loadPersonnel(currentPage);

    if (!document.getElementById("personnel-preview-modal")?.hidden) showPreview();
  } catch (err) {
    setFormStatus(err.message || "Save failed. Try again.", true);
  }
}

init();
