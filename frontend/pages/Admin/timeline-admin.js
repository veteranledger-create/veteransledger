import { authHeader, escHtml, debounce, loader, toggleModal, makeStatusFn } from "./admin-utils.js";

/**
 * VeteransLedger · Admin — Timeline Events
 * Uses the existing /api/timeline REST endpoint (prisma.timelineEvent model).
 */

const CATEGORIES = ["political", "military", "economic", "social", "diplomatic", "other"];

let currentPage = 1;
let editingId = null;
const setStatus = makeStatusFn("timeline-form-status");

function init() {
  document.getElementById("admin-tabs")?.addEventListener("click", (e) => {
    if (e.target.closest('[data-tab="tab-timeline"]')) loadTimeline(1);
  });

  document.getElementById("timeline-new-btn")?.addEventListener("click", () => openForm(null));
  document.getElementById("timeline-cancel-btn")?.addEventListener("click", closeForm);
  document.getElementById("timeline-filter-year")?.addEventListener("input", debounce(() => loadTimeline(1), 350));
  document.getElementById("timeline-filter-category")?.addEventListener("change", () => loadTimeline(1));
  document.getElementById("timeline-form")?.addEventListener("submit", handleSubmit);
  document.getElementById("timeline-delete-btn")?.addEventListener("click", handleDelete);
}

// ── List ──────────────────────────────────────────────────────
async function loadTimeline(page = 1) {
  currentPage = page;
  const container = document.getElementById("timeline-list");
  if (!container) return;
  container.innerHTML = loader();

  const year = document.getElementById("timeline-filter-year")?.value || "";
  const category = document.getElementById("timeline-filter-category")?.value || "";
  const params = new URLSearchParams({ ...(year && { year }), ...(category && { category }) });

  try {
    const res = await fetch(`/api/timeline?${params}`, { headers: authHeader() });
    if (!res.ok) throw new Error();
    const events = await res.json();
    renderList(container, events);
  } catch (_) {
    container.innerHTML = `<p style="color:var(--text-muted)">Timeline unavailable.</p>`;
  }
}

function renderList(container, events) {
  if (!events.length) {
    container.innerHTML = `<p style="color:var(--text-muted)">No timeline events yet. Create one above.</p>`;
    return;
  }
  container.innerHTML = `
    <p style="font-size:var(--text-xs);color:var(--text-muted);margin-bottom:var(--space-4);">${events.length} event(s)</p>
    <table style="width:100%;border-collapse:collapse;font-size:var(--text-sm);">
      <thead>
        <tr style="border-bottom:1px solid var(--border-dim);color:var(--text-muted);text-align:left;">
          <th style="padding:var(--space-3) var(--space-4);">Year</th>
          <th style="padding:var(--space-3) var(--space-4);">Date</th>
          <th style="padding:var(--space-3) var(--space-4);">Category</th>
          <th style="padding:var(--space-3) var(--space-4);">Title</th>
          <th style="padding:var(--space-3) var(--space-4);text-align:right;">Actions</th>
        </tr>
      </thead>
      <tbody>
        ${events.map((ev) => `
          <tr style="border-bottom:1px solid var(--border-dim);">
            <td style="padding:var(--space-3) var(--space-4);color:var(--text-muted);">${escHtml(String(ev.year || "—"))}</td>
            <td style="padding:var(--space-3) var(--space-4);color:var(--text-muted);">${escHtml(ev.date || "—")}</td>
            <td style="padding:var(--space-3) var(--space-4);"><span class="badge">${escHtml(ev.category || "—")}</span></td>
            <td style="padding:var(--space-3) var(--space-4);color:var(--text-primary);">${escHtml(ev.title)}</td>
            <td style="padding:var(--space-3) var(--space-4);text-align:right;">
              <button class="btn btn-secondary" style="padding:4px var(--space-3);font-size:11px;" data-edit="${ev.id}">Edit</button>
            </td>
          </tr>`).join("")}
      </tbody>
    </table>`;
  container.querySelectorAll("[data-edit]").forEach((btn) => btn.addEventListener("click", () => openForm(btn.dataset.edit)));
}

// ── Form ──────────────────────────────────────────────────────
function openForm(id) {
  editingId = id;
  document.getElementById("timeline-form")?.reset();
  document.getElementById("timeline-form-title").textContent = id ? "Edit Event" : "New Event";
  document.getElementById("timeline-form-panel").hidden = false;
  document.getElementById("timeline-delete-btn").hidden = !id;
  setStatus("", false);
  if (id) loadEventIntoForm(id);
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
    form.querySelector("[name='year']").value = ev.year || "";
    form.querySelector("[name='date']").value = ev.date || "";
    form.querySelector("[name='category']").value = ev.category || "";
    form.querySelector("[name='title']").value = ev.title || "";
    form.querySelector("[name='summary']").value = ev.summary || "";
    form.querySelector("[name='location']").value = ev.location || "";
  } catch (_) {
    setStatus("Failed to load event.", true);
  }
}

async function handleDelete() {
  if (!editingId) return;
  if (!confirm("Delete this timeline event? This cannot be undone.")) return;
  try {
    const res = await fetch(`/api/timeline/${editingId}`, { method: "DELETE", headers: authHeader() });
    if (!res.ok) throw new Error();
    closeForm();
    loadTimeline(1);
  } catch (_) {
    setStatus("Delete failed.", true);
  }
}

async function handleSubmit(e) {
  e.preventDefault();
  const form = e.target;
  const yearVal = form.querySelector("[name='year']").value.trim();
  const body = {
    year: yearVal ? Number(yearVal) : undefined,
    date: form.querySelector("[name='date']").value.trim() || undefined,
    category: form.querySelector("[name='category']").value || undefined,
    title: form.querySelector("[name='title']").value.trim(),
    summary: form.querySelector("[name='summary']").value.trim() || undefined,
    location: form.querySelector("[name='location']").value.trim() || undefined,
  };

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
    loadTimeline(1);
  } catch (_) {
    setStatus("Save failed. Try again.", true);
  }
}

init();
