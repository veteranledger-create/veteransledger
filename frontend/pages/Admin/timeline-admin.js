import { authHeader, escHtml, debounce, loader, makeStatusFn } from "./admin-utils.js";
import { initRelatedModal, openRelatedModal } from "./admin-related.js";
import { renderSources as renderSourcesFn, renderRelated as renderRelatedFn } from "./admin-form.js";

/**
 * VeteransLedger · Admin — Timeline Events
 * Full CRUD for /api/timeline with sources, related records,
 * significance/notes, year, start/end date, category, location.
 */

const CATEGORIES = ["political", "military", "economic", "social", "diplomatic", "other"];

let editingId = null;
let sourcesDraft = [];
let relatedDraft = [];

const setStatus = makeStatusFn("timeline-form-status");

function renderSources() { renderSourcesFn("timeline-sources-list", sourcesDraft, renderSources); }
function renderRelated() { renderRelatedFn("timeline-related-list", relatedDraft, renderRelated); }

function init() {
  initRelatedModal();

  document.getElementById("admin-tabs")?.addEventListener("click", (e) => {
    if (e.target.closest('[data-tab="tab-timeline"]')) loadTimeline();
  });

  document.getElementById("timeline-new-btn")?.addEventListener("click", () => openForm(null));
  document.getElementById("timeline-cancel-btn")?.addEventListener("click", closeForm);
  document.getElementById("timeline-delete-btn")?.addEventListener("click", handleDelete);
  document.getElementById("timeline-form")?.addEventListener("submit", handleSubmit);

  document.getElementById("timeline-filter-year")?.addEventListener("input", debounce(loadTimeline, 350));
  document.getElementById("timeline-filter-category")?.addEventListener("change", loadTimeline);

  document.getElementById("timeline-add-source-btn")?.addEventListener("click", () => {
    sourcesDraft.push({ ref: "", type: "" });
    renderSources();
  });

  document.getElementById("timeline-add-related-btn")?.addEventListener("click", () => {
    openRelatedModal((item) => { relatedDraft.push(item); renderRelated(); });
  });
}

// ── List ──────────────────────────────────────────────────────────────────────

async function loadTimeline() {
  const container = document.getElementById("timeline-list");
  if (!container) return;
  container.innerHTML = loader();

  const year = document.getElementById("timeline-filter-year")?.value?.trim() || "";
  const category = document.getElementById("timeline-filter-category")?.value || "";
  const params = new URLSearchParams({ ...(year && { year }), ...(category && { category }) });

  try {
    const res = await fetch(`/api/timeline?${params}`, { headers: authHeader() });
    if (!res.ok) throw new Error();
    renderList(container, await res.json());
  } catch (_) {
    container.innerHTML = `<p style="color:var(--text-muted)">Timeline unavailable.</p>`;
  }
}

function renderList(container, events) {
  if (!events.length) {
    container.innerHTML = `<p style="color:var(--text-muted)">No timeline events yet. Click "+ New Event" to create one.</p>`;
    return;
  }
  container.innerHTML = `
    <p style="font-size:var(--text-xs);color:var(--text-muted);margin-bottom:var(--space-4);">${events.length} event(s)</p>
    <table style="width:100%;border-collapse:collapse;font-size:var(--text-sm);">
      <thead>
        <tr style="border-bottom:1px solid var(--border-dim);color:var(--text-muted);text-align:left;">
          <th style="padding:var(--space-3) var(--space-4);width:60px;">Year</th>
          <th style="padding:var(--space-3) var(--space-4);width:100px;">Date</th>
          <th style="padding:var(--space-3) var(--space-4);width:90px;">Category</th>
          <th style="padding:var(--space-3) var(--space-4);">Title</th>
          <th style="padding:var(--space-3) var(--space-4);">Location</th>
          <th style="padding:var(--space-3) var(--space-4);width:80px;">Status</th>
          <th style="padding:var(--space-3) var(--space-4);text-align:right;">Actions</th>
        </tr>
      </thead>
      <tbody>
        ${events.map((ev) => `
          <tr style="border-bottom:1px solid var(--border-dim);">
            <td style="padding:var(--space-3) var(--space-4);color:var(--text-muted);">${escHtml(String(ev.year ?? "—"))}</td>
            <td style="padding:var(--space-3) var(--space-4);color:var(--text-muted);font-size:11px;">${ev.date ? escHtml(ev.date.slice(0, 10)) : "—"}</td>
            <td style="padding:var(--space-3) var(--space-4);">${ev.category ? `<span class="badge">${escHtml(ev.category)}</span>` : "—"}</td>
            <td style="padding:var(--space-3) var(--space-4);color:var(--text-primary);">${escHtml(ev.title)}</td>
            <td style="padding:var(--space-3) var(--space-4);color:var(--text-muted);font-size:11px;">${ev.location ? escHtml(ev.location) : "—"}</td>
            <td style="padding:var(--space-3) var(--space-4);">${ev.published
              ? '<span style="color:#60c060;font-size:11px;">Published</span>'
              : '<span style="color:var(--text-muted);font-size:11px;">Draft</span>'}</td>
            <td style="padding:var(--space-3) var(--space-4);text-align:right;display:flex;gap:var(--space-2);justify-content:flex-end;">
              <button class="btn btn-secondary" style="padding:4px var(--space-3);font-size:11px;" data-edit="${ev.id}">Edit</button>
              <button class="btn btn-secondary" style="padding:4px var(--space-3);font-size:11px;color:#e06060;border-color:#4a1515;" data-delete="${ev.id}">Delete</button>
            </td>
          </tr>`).join("")}
      </tbody>
    </table>`;

  container.querySelectorAll("[data-edit]").forEach((btn) =>
    btn.addEventListener("click", () => openForm(btn.dataset.edit)));
  container.querySelectorAll("[data-delete]").forEach((btn) =>
    btn.addEventListener("click", () => deleteEvent(btn.dataset.delete)));
}

// ── Form ──────────────────────────────────────────────────────────────────────

function openForm(id) {
  editingId = id;
  sourcesDraft = [];
  relatedDraft = [];
  document.getElementById("timeline-form")?.reset();
  // Default published to checked for new events
  const pubCheck = document.querySelector("#timeline-form [name='published']");
  if (pubCheck) pubCheck.checked = true;
  document.getElementById("timeline-form-title").textContent = id ? "Edit Event" : "New Event";
  document.getElementById("timeline-form-panel").hidden = false;
  document.getElementById("timeline-delete-btn").hidden = !id;
  setStatus("", false);
  renderSources();
  renderRelated();
  if (id) loadEventIntoForm(id);
  // Scroll form into view
  document.getElementById("timeline-form-panel")?.scrollIntoView({ behavior: "smooth", block: "start" });
}

function closeForm() {
  document.getElementById("timeline-form-panel").hidden = true;
  editingId = null;
}

async function loadEventIntoForm(id) {
  try {
    const res = await fetch(`/api/timeline/${id}`, { headers: authHeader() });
    if (!res.ok) throw new Error();
    const ev = await res.json();
    const form = document.getElementById("timeline-form");
    const meta = ev.metadata || {};

    form.querySelector("[name='year']").value = ev.year ?? "";
    form.querySelector("[name='date']").value = ev.date ? ev.date.slice(0, 10) : "";
    form.querySelector("[name='endDate']").value = ev.endDate ? ev.endDate.slice(0, 10) : "";
    form.querySelector("[name='category']").value = ev.category || "";
    form.querySelector("[name='title']").value = ev.title || "";
    form.querySelector("[name='location']").value = ev.location || "";
    form.querySelector("[name='summary']").value = ev.summary || "";
    form.querySelector("[name='significance']").value = ev.significance || "";
    form.querySelector("[name='published']").checked = !!ev.published;

    sourcesDraft = Array.isArray(meta.sources)
      ? meta.sources.map((s) => ({ ref: s.ref || "", type: s.type || "" }))
      : [];
    relatedDraft = Array.isArray(meta.related_records) ? [...meta.related_records] : [];

    renderSources();
    renderRelated();
  } catch (_) {
    setStatus("Failed to load event.", true);
  }
}

// ── Save ──────────────────────────────────────────────────────────────────────

async function handleSubmit(e) {
  e.preventDefault();
  const form = e.target;

  const yearRaw = form.querySelector("[name='year']").value.trim();
  const dateRaw = form.querySelector("[name='date']").value.trim();
  const title = form.querySelector("[name='title']").value.trim();

  if (!title) { setStatus("Title is required.", true); return; }
  if (!yearRaw && !dateRaw) { setStatus("At least a Year or Start Date is required.", true); return; }

  const body = {
    year: yearRaw ? Number(yearRaw) : (dateRaw ? new Date(dateRaw).getFullYear() : null),
    date: dateRaw || null,
    endDate: form.querySelector("[name='endDate']").value.trim() || null,
    category: form.querySelector("[name='category']").value || null,
    title,
    location: form.querySelector("[name='location']").value.trim() || null,
    summary: form.querySelector("[name='summary']").value.trim() || null,
    significance: form.querySelector("[name='significance']").value.trim() || null,
    published: form.querySelector("[name='published']").checked,
    metadata: {
      sources: sourcesDraft.filter((s) => s.ref),
      related_records: relatedDraft,
    },
  };

  setStatus("Saving…", false);
  try {
    const res = await fetch(editingId ? `/api/timeline/${editingId}` : "/api/timeline", {
      method: editingId ? "PUT" : "POST",
      headers: { ...authHeader(), "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!res.ok) throw new Error();
    const saved = await res.json();
    editingId = saved.id;
    document.getElementById("timeline-delete-btn").hidden = false;
    setStatus("Saved.", false);
    loadTimeline();
  } catch (_) {
    setStatus("Save failed. Try again.", true);
  }
}

// ── Delete ────────────────────────────────────────────────────────────────────

async function handleDelete() {
  if (!editingId || !confirm("Delete this timeline event? This cannot be undone.")) return;
  try {
    const res = await fetch(`/api/timeline/${editingId}`, { method: "DELETE", headers: authHeader() });
    if (!res.ok) throw new Error();
    closeForm();
    loadTimeline();
  } catch (_) {
    setStatus("Delete failed.", true);
  }
}

async function deleteEvent(id) {
  if (!confirm("Delete this timeline event? This cannot be undone.")) return;
  try {
    const res = await fetch(`/api/timeline/${id}`, { method: "DELETE", headers: authHeader() });
    if (!res.ok) throw new Error();
    if (editingId === id) closeForm();
    loadTimeline();
  } catch (_) {
    alert("Delete failed. Try again.");
  }
}

init();
