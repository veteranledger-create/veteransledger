/**
 * VeteransLedger · Admin — Armaments
 * Dedicated workflow for the Armaments content type, separate from the
 * generic Records tab — Armaments' real fields (specs, sources,
 * related_records, category+nation) don't fit a generic title/type/content
 * shape. Reads the same session token admin.js already manages via
 * sessionStorage, without needing any change to admin.js itself.
 */

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

const SPEC_FIELDS = ["designation", "manufacturer", "crew", "weight", "armor", "armament", "engine", "speed", "range", "units_produced"];
const TYPE_LABEL_MAP = { PERSON: "Personnel", LETTER: "Letter", ARTICLE: "Article", CAMPAIGN: "Campaign", ARMAMENT: "Armament" };

let currentPage = 1;
let editingId = null;
let extraSpecs = [];
let sourcesDraft = [];
let relatedDraft = [];
let mediaDraft = [];

function init() {
  document.getElementById("admin-tabs")?.addEventListener("click", (e) => {
    if (e.target.closest('[data-tab="tab-armaments"]')) loadArmaments(1);
  });

  document.getElementById("armament-new-btn")?.addEventListener("click", () => openForm(null));
  document.getElementById("armament-cancel-btn")?.addEventListener("click", closeForm);
  document.getElementById("armament-filter-category")?.addEventListener("change", () => loadArmaments(1));
  document.getElementById("armament-filter-search")?.addEventListener("input", debounce(() => loadArmaments(1), 350));
  document.getElementById("armament-add-spec-btn")?.addEventListener("click", () => { extraSpecs.push({ key: "", value: "" }); renderExtraSpecs(); });
  document.getElementById("armament-add-source-btn")?.addEventListener("click", () => { sourcesDraft.push({ ref: "", type: "" }); renderSources(); });
  document.getElementById("armament-add-related-btn")?.addEventListener("click", openRelatedModal);
  document.getElementById("armament-attach-media-btn")?.addEventListener("click", openMediaModal);
  document.getElementById("armament-preview-btn")?.addEventListener("click", showPreview);
  document.getElementById("armament-form")?.addEventListener("submit", handleSubmit);

  document.getElementById("related-record-modal-close")?.addEventListener("click", () => toggleModal("related-record-modal", false));
  document.getElementById("media-attach-modal-close")?.addEventListener("click", () => toggleModal("media-attach-modal", false));
  document.getElementById("armament-preview-modal-close")?.addEventListener("click", () => toggleModal("armament-preview-modal", false));
  document.getElementById("related-record-search-input")?.addEventListener("input", debounce(runRelatedSearch, 350));
}

function toggleModal(id, show) {
  const el = document.getElementById(id);
  if (el) el.hidden = !show;
}

// ── List ──────────────────────────────────────────────────────
async function loadArmaments(page = 1) {
  currentPage = page;
  const container = document.getElementById("armament-list");
  if (!container) return;
  container.innerHTML = `<div class="loader"><span class="loader__dot"></span><span class="loader__dot"></span><span class="loader__dot"></span></div>`;

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
  extraSpecs = [];
  sourcesDraft = [];
  relatedDraft = [];
  mediaDraft = [];
  document.getElementById("armament-form")?.reset();
  document.getElementById("armament-form-title").textContent = id ? "Edit Armament" : "New Armament";
  document.getElementById("armament-form-panel").hidden = false;
  document.getElementById("armament-duplicate-warning").hidden = true;
  renderExtraSpecs();
  renderSources();
  renderRelated();
  renderMedia();
  setFormStatus("", false);
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

    const knownKeys = new Set(["category", "nation", "sources", "related_records", "importRunId", "fileNation", "schemaType", ...SPEC_FIELDS]);
    extraSpecs = Object.entries(meta)
      .filter(([k]) => !knownKeys.has(k))
      .map(([key, value]) => ({ key, value: typeof value === "object" ? JSON.stringify(value) : String(value) }));
    sourcesDraft = Array.isArray(meta.sources) ? meta.sources.map((s) => ({ ref: s.ref || "", type: s.type || "" })) : [];
    relatedDraft = Array.isArray(meta.related_records) ? [...meta.related_records] : [];
    mediaDraft = Array.isArray(r.media) ? [...r.media] : [];

    renderExtraSpecs();
    renderSources();
    renderRelated();
    renderMedia();
  } catch (_) {
    setFormStatus("Failed to load armament.", true);
  }
}

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

function renderSources() {
  const container = document.getElementById("armament-sources-list");
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

function renderRelated() {
  const container = document.getElementById("armament-related-list");
  if (!container) return;
  if (!relatedDraft.length) {
    container.innerHTML = `<p style="font-size:var(--text-sm);color:var(--text-muted);">None selected.</p>`;
    return;
  }
  container.innerHTML = relatedDraft.map((r, i) => `
    <div style="display:flex;justify-content:space-between;align-items:center;padding:var(--space-2) var(--space-3);background:rgba(255,255,255,0.03);border-radius:4px;margin-bottom:var(--space-2);font-size:var(--text-sm);">
      <span><span class="badge" style="margin-right:var(--space-2);">${escHtml(r.type)}</span>${escHtml(r.title)} <span style="color:var(--text-muted);">(${escHtml(r.url)})</span></span>
      <button type="button" class="btn btn-secondary" data-related-remove="${i}" style="font-size:11px;">✕</button>
    </div>`).join("");
  container.querySelectorAll("[data-related-remove]").forEach((el) => el.addEventListener("click", () => { relatedDraft.splice(+el.dataset.relatedRemove, 1); renderRelated(); }));
}

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

// ── Related-record search-and-select modal ───────────────────
// Selection only — URLs are always resolved server-side via
// resolveRelatedUrl(), never constructed or typed in this UI, so a stale
// or theater-prefixed URL can never be created through Admin.
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
  } catch (_) { /* leave null — surfaced visibly rather than guessed */ }
  relatedDraft.push({ id: slugOrId, title: item.title, type, url });
  renderRelated();
  toggleModal("related-record-modal", false);
}

// ── Media attach modal ────────────────────────────────────────
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

// ── Preview ───────────────────────────────────────────────────
// Renders the literal output of toArmamentJson() — the same function the
// public detail page's data and the publish pipeline both consume — never
// a separate rendering implementation that could drift from either.
async function showPreview() {
  if (!editingId) {
    alert("Save the armament first, then Preview.");
    return;
  }
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
function setFormStatus(msg, isError) {
  const el = document.getElementById("armament-form-status");
  if (el) { el.textContent = msg; el.style.color = isError ? "#e06060" : "#60c060"; }
}

// Non-blocking live check — surfaces a warning while editing, but never
// prevents saving a draft. The real, blocking gate runs server-side at
// publish time (see admin-duplicate-check.ts).
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

    setFormStatus("Saved.", false);
    loadArmaments(currentPage);
  } catch (_) {
    setFormStatus("Save failed. Try again.", true);
  }
}

init();
