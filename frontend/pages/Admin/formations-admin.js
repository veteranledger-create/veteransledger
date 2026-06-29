import { authHeader, escHtml, debounce, loader, toggleModal, makeStatusFn } from "./admin-utils.js";
import { initRelatedModal, openRelatedModal } from "./admin-related.js";
import { renderSources as renderSourcesFn, renderRelated as renderRelatedFn } from "./admin-form.js";

/**
 * VeteransLedger · Admin — Formations
 * Full CRUD against /api/formations; structured form fields replace the old
 * raw-JSON textarea. Each formation maps to a DB record (type=FORMATION).
 */

const SECTIONS = [
  { value: "army-groups",  label: "Army Groups" },
  { value: "armies",       label: "Armies" },
  { value: "corps",        label: "Corps" },
  { value: "divisions",    label: "Divisions" },
  { value: "waffen-ss",    label: "Waffen-SS" },
  { value: "luftwaffe",    label: "Luftwaffe" },
  { value: "kriegsmarine", label: "Kriegsmarine" },
  { value: "brigades",     label: "Brigades" },
  { value: "regiments",    label: "Regiments" },
  { value: "battalions",   label: "Battalions" },
  { value: "companies",    label: "Companies" },
  { value: "volunteers",   label: "Volunteer Formations" },
  { value: "allies",       label: "Axis Allies" },
];

let currentPage = 1;
let editingId = null;
let sourcesDraft = [];
let relatedDraft = [];
let commandersDraft = [];

const setStatus = makeStatusFn("formation-form-status");
function renderSources() { renderSourcesFn("formation-sources-list", sourcesDraft, renderSources); }
function renderRelated() { renderRelatedFn("formation-related-list", relatedDraft, renderRelated); }

function renderCommanders() {
  const list = document.getElementById("formation-commanders-list");
  if (!list) return;
  if (!commandersDraft.length) {
    list.innerHTML = `<p style="color:var(--text-muted);font-size:var(--text-xs);">No commanders added yet.</p>`;
    return;
  }
  list.innerHTML = commandersDraft.map((c, i) => `
    <div style="display:grid;grid-template-columns:1fr 1fr auto;gap:var(--space-2);margin-bottom:var(--space-2);align-items:center;">
      <input class="input" placeholder="Name" value="${escHtml(c.name || "")}" data-ci="${i}" data-field="name">
      <input class="input" placeholder="Period (e.g. Jun 1941–Jan 1942)" value="${escHtml(c.period || "")}" data-ci="${i}" data-field="period">
      <button type="button" class="btn btn-secondary" style="padding:4px 8px;color:#e06060;border-color:#4a1515;" data-rm-cmd="${i}">✕</button>
    </div>`).join("");

  list.querySelectorAll("[data-ci]").forEach((inp) => {
    inp.addEventListener("input", (e) => {
      const { ci, field } = e.target.dataset;
      commandersDraft[+ci][field] = e.target.value;
    });
  });
  list.querySelectorAll("[data-rm-cmd]").forEach((btn) => {
    btn.addEventListener("click", () => {
      commandersDraft.splice(+btn.dataset.rmCmd, 1);
      renderCommanders();
    });
  });
}

function init() {
  initRelatedModal();

  document.getElementById("admin-tabs")?.addEventListener("click", (e) => {
    if (e.target.closest('[data-tab="tab-formations"]')) {
      loadFormations(1);
    }
  });

  document.getElementById("formation-new-btn")?.addEventListener("click", () => openForm(null));
  document.getElementById("formation-cancel-btn")?.addEventListener("click", closeForm);
  document.getElementById("formation-filter-section")?.addEventListener("change", () => loadFormations(1));
  document.getElementById("formation-filter-search")?.addEventListener("input", debounce(() => loadFormations(1), 350));
  document.getElementById("formation-form")?.addEventListener("submit", handleSubmit);
  document.getElementById("formation-preview-btn")?.addEventListener("click", showPreview);
  document.getElementById("formation-preview-modal-close")?.addEventListener("click", () => toggleModal("formation-preview-modal", false));

  document.getElementById("formation-add-commander-btn")?.addEventListener("click", () => {
    commandersDraft.push({ name: "", period: "" });
    renderCommanders();
  });
  document.getElementById("formation-add-source-btn")?.addEventListener("click", () => {
    sourcesDraft.push({ ref: "", type: "" });
    renderSources();
  });
  document.getElementById("formation-add-related-btn")?.addEventListener("click", () =>
    openRelatedModal((item) => { relatedDraft.push(item); renderRelated(); })
  );
}

async function loadFormations(page = 1) {
  currentPage = page;
  const container = document.getElementById("formation-list");
  if (!container) return;
  container.innerHTML = loader();

  const section = document.getElementById("formation-filter-section")?.value || "";
  const search = document.getElementById("formation-filter-search")?.value || "";
  const params = new URLSearchParams({ page, limit: 50, ...(section && { section }), ...(search && { search }) });

  try {
    const res = await fetch(`/api/formations?${params}`, { headers: authHeader() });
    if (!res.ok) throw new Error();
    renderList(container, await res.json());
  } catch (_) {
    container.innerHTML = `<p style="color:var(--text-muted)">Formations unavailable.</p>`;
  }
}

function renderList(container, { data, total, page, pages }) {
  if (!data.length) {
    container.innerHTML = `<p style="color:var(--text-muted)">No formations yet. Create one above or run the data import.</p>`;
    return;
  }
  container.innerHTML = `
    <p style="font-size:var(--text-xs);color:var(--text-muted);margin-bottom:var(--space-4);">${total} formations · page ${page} of ${pages}</p>
    <table style="width:100%;border-collapse:collapse;font-size:var(--text-sm);">
      <thead><tr style="border-bottom:1px solid var(--border-dim);color:var(--text-muted);text-align:left;">
        <th style="padding:var(--space-2) var(--space-3);">Name</th>
        <th style="padding:var(--space-2) var(--space-3);">Section</th>
        <th style="padding:var(--space-2) var(--space-3);">Nation</th>
        <th style="padding:var(--space-2) var(--space-3);">Status</th>
        <th style="padding:var(--space-2) var(--space-3);text-align:right;">Actions</th>
      </tr></thead>
      <tbody>
        ${data.map((r) => {
          const meta = r.metadata || {};
          const sectionLabel = SECTIONS.find((s) => s.value === meta.section)?.label || meta.section || "—";
          return `
          <tr style="border-bottom:1px solid var(--border-dim);">
            <td style="padding:var(--space-2) var(--space-3);color:var(--text-primary);">${escHtml(r.title)}</td>
            <td style="padding:var(--space-2) var(--space-3);color:var(--text-muted);">${escHtml(sectionLabel)}</td>
            <td style="padding:var(--space-2) var(--space-3);color:var(--text-muted);">${escHtml(r.nationality || "—")}</td>
            <td style="padding:var(--space-2) var(--space-3);">${r.published ? '<span style="color:#60c060;">Published</span>' : '<span style="color:var(--text-muted);">Draft</span>'}</td>
            <td style="padding:var(--space-2) var(--space-3);text-align:right;display:flex;gap:var(--space-2);justify-content:flex-end;">
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
  container.querySelectorAll("[data-delete]").forEach((btn) => btn.addEventListener("click", () => deleteFormation(btn.dataset.delete)));
  container.querySelectorAll("[data-page]").forEach((btn) => btn.addEventListener("click", () => loadFormations(+btn.dataset.page)));
}

async function deleteFormation(id) {
  if (!confirm("Delete this formation? This cannot be undone.")) return;
  try {
    const res = await fetch(`/api/formations/${id}`, { method: "DELETE", headers: authHeader() });
    if (!res.ok) throw new Error();
    loadFormations(currentPage);
  } catch (_) { alert("Delete failed. Try again."); }
}

function openForm(id) {
  editingId = id;
  sourcesDraft = []; relatedDraft = []; commandersDraft = [];
  document.getElementById("formation-form")?.reset();
  document.getElementById("formation-form-title").textContent = id ? "Edit Formation" : "New Formation";
  document.getElementById("formation-form-panel").hidden = false;
  renderSources(); renderRelated(); renderCommanders();
  setStatus("", false);
  if (id) loadIntoForm(id);
}

function closeForm() {
  document.getElementById("formation-form-panel").hidden = true;
  editingId = null;
}

async function loadIntoForm(id) {
  try {
    const res = await fetch(`/api/formations/${id}`, { headers: authHeader() });
    if (!res.ok) throw new Error();
    const r = await res.json();
    const meta = r.metadata || {};
    const form = document.getElementById("formation-form");

    form.querySelector("[name='title']").value = r.title || "";
    form.querySelector("[name='slug']").value = r.slug || "";
    form.querySelector("[name='section']").value = meta.section || "";
    form.querySelector("[name='formation_type']").value = meta.formation_type || "";
    form.querySelector("[name='nation']").value = r.nationality || "Germany";
    form.querySelector("[name='service']").value = meta.service || "";
    form.querySelector("[name='theater']").value = meta.theater || "";
    form.querySelector("[name='active_from']").value = meta.active?.from || "";
    form.querySelector("[name='active_to']").value = meta.active?.to || "";
    form.querySelector("[name='peak_strength']").value = meta.peak_strength || "";
    form.querySelector("[name='summary']").value = r.summary || "";
    form.querySelector("[name='context']").value = meta.context || "";
    form.querySelector("[name='published']").checked = !!r.published;

    commandersDraft = Array.isArray(meta.commanders)
      ? meta.commanders.map((c) => ({ name: c.name || "", period: c.period || "" }))
      : [];
    sourcesDraft = Array.isArray(meta.sources)
      ? meta.sources.map((s) => ({ ref: s.ref || "", type: s.type || "" }))
      : [];
    relatedDraft = Array.isArray(meta.related_records) ? [...meta.related_records] : [];

    renderCommanders(); renderSources(); renderRelated();
  } catch (_) { setStatus("Failed to load formation.", true); }
}

async function showPreview() {
  if (!editingId) { alert("Save the formation first, then Preview."); return; }
  toggleModal("formation-preview-modal", true);
  const content = document.getElementById("formation-preview-content");
  content.innerHTML = `<p style="color:var(--text-muted);">Loading…</p>`;
  try {
    const res = await fetch(`/api/formations/${editingId}/preview`, { headers: authHeader() });
    if (!res.ok) throw new Error();
    const { rendered, issues } = await res.json();
    const errors = issues.filter((i) => i.severity === "error");
    content.innerHTML = `
      ${errors.length ? `<div style="background:#3a1515;border:1px solid #6a2020;border-radius:4px;padding:var(--space-3);margin-bottom:var(--space-4);color:#e06060;font-size:var(--text-sm);">
        <strong>Cannot publish — ${errors.length} blocking issue(s):</strong>
        <ul style="margin:var(--space-2) 0 0 var(--space-4);">${errors.map((e) => `<li>${escHtml(e.message)}</li>`).join("")}</ul>
      </div>` : ""}
      <h3 style="font-family:var(--font-display);margin-bottom:var(--space-2);">${escHtml(rendered.name || "—")}</h3>
      ${rendered.type ? `<p style="color:var(--gold-dim);margin-bottom:var(--space-1);">${escHtml(rendered.type)}</p>` : ""}
      ${rendered.nation ? `<p style="color:var(--text-muted);margin-bottom:var(--space-1);">Nation: ${escHtml(rendered.nation)}</p>` : ""}
      ${rendered.summary ? `<p style="margin-bottom:var(--space-4);">${escHtml(String(rendered.summary).slice(0, 300))}</p>` : ""}
      <pre style="font-size:11px;background:rgba(255,255,255,0.03);padding:var(--space-3);border-radius:4px;overflow-x:auto;">${escHtml(JSON.stringify(rendered, null, 2))}</pre>`;
  } catch (_) {
    content.innerHTML = `<p style="color:var(--text-muted);">Preview unavailable.</p>`;
  }
}

async function handleSubmit(e) {
  e.preventDefault();
  const form = e.target;
  const activeFrom = form.querySelector("[name='active_from']").value.trim();
  const activeTo   = form.querySelector("[name='active_to']").value.trim();
  const contextText = form.querySelector("[name='context']").value.trim();

  const body = {
    title:       form.querySelector("[name='title']").value.trim(),
    slug:        form.querySelector("[name='slug']").value.trim() || undefined,
    nationality: form.querySelector("[name='nation']").value.trim() || "Germany",
    summary:     form.querySelector("[name='summary']").value.trim() || undefined,
    published:   form.querySelector("[name='published']").checked,
    metadata: {
      section:        form.querySelector("[name='section']").value,
      formation_type: form.querySelector("[name='formation_type']").value.trim() || undefined,
      service:        form.querySelector("[name='service']").value.trim() || undefined,
      theater:        form.querySelector("[name='theater']").value.trim() || undefined,
      active: (activeFrom || activeTo) ? { from: activeFrom || undefined, to: activeTo || undefined } : undefined,
      peak_strength:  form.querySelector("[name='peak_strength']").value.trim() || undefined,
      context:        contextText || undefined,
      commanders:     commandersDraft.filter((c) => c.name),
      sources:        sourcesDraft.filter((s) => s.ref),
      related_records: relatedDraft,
    },
  };

  setStatus("Saving…", false);
  try {
    const res = await fetch(editingId ? `/api/formations/${editingId}` : "/api/formations", {
      method: editingId ? "PUT" : "POST",
      headers: { ...authHeader(), "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!res.ok) throw new Error();
    const saved = await res.json();
    editingId = saved.id;
    setStatus("Saved.", false);
    loadFormations(currentPage);
    if (!document.getElementById("formation-preview-modal")?.hidden) showPreview();
  } catch (_) { setStatus("Save failed. Try again.", true); }
}

init();
