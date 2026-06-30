import { TranslationsPanel } from "./translations-panel.js";
import { authHeader, escHtml, makeStatusFn, safeJson } from "./admin-utils.js";

/**
 * VeteransLedger · Admin — NSDAP Content
 * Structured editors for overview, timeline, and glossary.
 * Raw JSON textarea for all other files (with pre-save validation).
 */

const NSDAP_FILES = [
  { key: "nsdap/overview.json",              label: "Overview",             structured: "overview"  },
  { key: "nsdap/timeline.json",              label: "Chronology",           structured: "timeline"  },
  { key: "nsdap/glossary.json",              label: "Glossary",             structured: "glossary"  },
  { key: "nsdap/index.json",                 label: "Index / Navigation",   structured: null },
  { key: "nsdap/sources.json",               label: "Sources",              structured: null },
  { key: "nsdap/party/formation.json",       label: "Party: Formation",     structured: null },
  { key: "nsdap/party/structure.json",       label: "Party: Structure",     structured: null },
  { key: "nsdap/party/leadership.json",      label: "Party: Leadership",    structured: null },
  { key: "nsdap/party/organizations.json",   label: "Party: Organizations", structured: null },
  { key: "nsdap/party/departments.json",     label: "Party: Departments",   structured: null },
  { key: "nsdap/party/economy.json",         label: "Party: Economy",       structured: null },
  { key: "nsdap/party/foreign-policy.json",  label: "Party: Foreign Policy",structured: null },
  { key: "nsdap/party/religion.json",        label: "Party: Religion",      structured: null },
  { key: "nsdap/party/state-relations.json", label: "Party: State Relations",structured: null },
  { key: "nsdap/party/programme.json",       label: "Party: Programme",     structured: null },
  { key: "nsdap/party/dissolution.json",     label: "Party: Dissolution",   structured: null },
  { key: "nsdap/hitler/bio.json",            label: "Hitler: Biography",    structured: null },
  { key: "nsdap/hitler/rise.json",           label: "Hitler: Rise to Power",structured: null },
  { key: "nsdap/hitler/chancellorship.json", label: "Hitler: Chancellorship",structured: null },
  { key: "nsdap/hitler/rule.json",           label: "Hitler: Rule",         structured: null },
  { key: "nsdap/hitler/wartime.json",        label: "Hitler: Wartime",      structured: null },
  { key: "nsdap/hitler/end.json",            label: "Hitler: End",          structured: null },
  { key: "nsdap/hitler/family.json",         label: "Hitler: Family",       structured: null },
];

let currentKey = null;
let currentStructured = null;   // "overview" | "timeline" | "glossary" | null
let timelineEvents = [];        // draft array for timeline editor
let glossaryEntries = [];       // draft array for glossary editor

const translationsPanel = new TranslationsPanel("nsdap-translations-panel", "site_content");

const setStatus = makeStatusFn("nsdap-form-status");

// ── DOM helpers ───────────────────────────────────────────────────────────────

function el(id) { return document.getElementById(id); }

function showPanel(structured) {
  el("nsdap-editor").hidden               = !!structured;
  el("nsdap-structured-overview").hidden  = structured !== "overview";
  el("nsdap-structured-timeline").hidden  = structured !== "timeline";
  el("nsdap-structured-glossary").hidden  = structured !== "glossary";
  currentStructured = structured;
}

// ── Init ──────────────────────────────────────────────────────────────────────

function init() {
  document.getElementById("admin-tabs")?.addEventListener("click", (e) => {
    if (e.target.closest('[data-tab="tab-nsdap"]')) renderSidebar();
  });

  el("nsdap-save-btn")?.addEventListener("click", handleSave);
  el("nsdap-timeline-add-btn")?.addEventListener("click", addTimelineEvent);
  el("nsdap-glossary-add-btn")?.addEventListener("click", addGlossaryEntry);
}

// ── Sidebar ───────────────────────────────────────────────────────────────────

function renderSidebar() {
  const sidebar = el("nsdap-file-list");
  if (!sidebar) return;
  sidebar.innerHTML = NSDAP_FILES.map((f) => `
    <div class="sidebar-item${currentKey === f.key ? " sidebar-item--active" : ""}" data-key="${escHtml(f.key)}">
      ${f.structured ? `<span style="color:var(--gold-dim);font-size:10px;margin-right:4px;">✦</span>` : ""}${escHtml(f.label)}
    </div>`).join("");
  sidebar.querySelectorAll("[data-key]").forEach((div) =>
    div.addEventListener("click", () => loadFile(div.dataset.key))
  );
}

// ── Load file ─────────────────────────────────────────────────────────────────

async function loadFile(key) {
  currentKey = key;
  renderSidebar();
  setStatus("Loading…", false);

  const fileInfo = NSDAP_FILES.find((f) => f.key === key);
  el("nsdap-editor-title").textContent = fileInfo?.label || key;

  // Reset all panels first
  el("nsdap-editor").value = "";
  el("nsdap-editor").disabled = true;
  showPanel(null);

  try {
    const res = await fetch(`/api/site-content?key=${encodeURIComponent(key)}`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await safeJson(res);
    setStatus("", false);
    translationsPanel.load(key);

    if (fileInfo?.structured === "overview") {
      populateOverview(data);
      showPanel("overview");
    } else if (fileInfo?.structured === "timeline") {
      populateTimeline(data);
      showPanel("timeline");
    } else if (fileInfo?.structured === "glossary") {
      populateGlossary(data);
      showPanel("glossary");
    } else {
      el("nsdap-editor").value = JSON.stringify(data, null, 2);
      el("nsdap-editor").disabled = false;
      showPanel(null);
    }
  } catch (err) {
    setStatus(`Failed to load: ${err.message}`, true);
    el("nsdap-editor").disabled = false;
    showPanel(null);
  }
}

// ── Save ──────────────────────────────────────────────────────────────────────

async function handleSave() {
  if (!currentKey) { setStatus("Select a file first.", true); return; }

  let parsed;
  try {
    parsed = readCurrentPanel();
  } catch (err) {
    setStatus(err.message, true);
    return;
  }

  setStatus("Saving…", false);
  try {
    const res = await fetch(`/api/site-content?key=${encodeURIComponent(currentKey)}`, {
      method: "PUT",
      headers: { ...authHeader(), "Content-Type": "application/json" },
      body: JSON.stringify(parsed),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    setStatus("Saved.", false);
  } catch (err) {
    setStatus(`Save failed: ${err.message}`, true);
  }
}

function readCurrentPanel() {
  if (currentStructured === "overview")  return readOverview();
  if (currentStructured === "timeline")  return readTimeline();
  if (currentStructured === "glossary")  return readGlossary();

  // Raw textarea — validate JSON before returning
  const raw = el("nsdap-editor").value;
  try {
    return JSON.parse(raw);
  } catch (_) {
    throw new Error("Invalid JSON — fix syntax errors before saving.");
  }
}

// ── Overview structured editor ────────────────────────────────────────────────

function populateOverview(data) {
  el("nsdap-ov-name").value        = data.name || "";
  el("nsdap-ov-name-en").value     = data.name_english || "";
  el("nsdap-ov-abbr").value        = data.abbreviation || "";
  el("nsdap-ov-founded").value     = data.founded || "";
  el("nsdap-ov-dissolved").value   = data.dissolved || "";
  el("nsdap-ov-leader").value      = data.leader || "";
  el("nsdap-ov-membership").value  = data.peakMembership || "";
  el("nsdap-ov-ideology").value    = data.ideology || "";
  el("nsdap-ov-hq").value          = data.headquarters || "";
  el("nsdap-ov-description").value = data.description || "";
  el("nsdap-ov-note").value        = data.note || "";
}

function readOverview() {
  return {
    name:           el("nsdap-ov-name").value.trim(),
    name_english:   el("nsdap-ov-name-en").value.trim() || undefined,
    abbreviation:   el("nsdap-ov-abbr").value.trim() || undefined,
    founded:        el("nsdap-ov-founded").value.trim() || undefined,
    dissolved:      el("nsdap-ov-dissolved").value.trim() || undefined,
    leader:         el("nsdap-ov-leader").value.trim() || undefined,
    peakMembership: el("nsdap-ov-membership").value.trim() || undefined,
    ideology:       el("nsdap-ov-ideology").value.trim() || undefined,
    headquarters:   el("nsdap-ov-hq").value.trim() || undefined,
    description:    el("nsdap-ov-description").value.trim() || undefined,
    note:           el("nsdap-ov-note").value.trim() || undefined,
  };
}

// ── Timeline structured editor ────────────────────────────────────────────────

function populateTimeline(data) {
  timelineEvents = Array.isArray(data.events)
    ? data.events.map((e) => ({ year: e.year ?? "", date: e.date || "", title: e.title || "", description: e.description || "" }))
    : [];
  renderTimeline();
}

function readTimeline() {
  // Sync from DOM before reading
  el("nsdap-timeline-list").querySelectorAll("[data-ti]").forEach((row) => {
    const i = +row.dataset.ti;
    if (!timelineEvents[i]) return;
    timelineEvents[i].year        = row.querySelector("[data-field='year']")?.value?.trim() || "";
    timelineEvents[i].date        = row.querySelector("[data-field='date']")?.value?.trim() || "";
    timelineEvents[i].title       = row.querySelector("[data-field='title']")?.value?.trim() || "";
    timelineEvents[i].description = row.querySelector("[data-field='description']")?.value?.trim() || "";
  });
  return {
    events: timelineEvents.map((e) => ({
      year:        e.year !== "" ? (isNaN(+e.year) ? e.year : +e.year) : undefined,
      date:        e.date || undefined,
      title:       e.title || "",
      description: e.description || "",
    })).filter((e) => e.title),
  };
}

function addTimelineEvent() {
  timelineEvents.push({ year: "", date: "", title: "", description: "" });
  renderTimeline();
  el("nsdap-timeline-list").lastElementChild?.scrollIntoView({ behavior: "smooth", block: "nearest" });
}

function renderTimeline() {
  const list = el("nsdap-timeline-list");
  if (!list) return;
  list.innerHTML = timelineEvents.map((ev, i) => `
    <div data-ti="${i}" class="admin-card">
      <div style="display:grid;grid-template-columns:80px 1fr auto;gap:var(--space-2);margin-bottom:var(--space-2);">
        <input class="input" data-field="year" placeholder="Year" value="${escHtml(String(ev.year || ""))}">
        <input class="input" data-field="date" placeholder="Full date (e.g. 24 February 1920)" value="${escHtml(ev.date || "")}">
        <button type="button" class="btn btn-secondary btn--xs btn--danger" data-rm-ti="${i}"><svg class="icon-inline" width="10" height="10" viewBox="0 0 24 24" aria-hidden="true" xmlns="http://www.w3.org/2000/svg"><path fill="currentColor" fill-rule="evenodd" clip-rule="evenodd" d="M5.29289 5.29289C5.68342 4.90237 6.31658 4.90237 6.70711 5.29289L12 10.5858L17.2929 5.29289C17.6834 4.90237 18.3166 4.90237 18.7071 5.29289C19.0976 5.68342 19.0976 6.31658 18.7071 6.70711L13.4142 12L18.7071 17.2929C19.0976 17.6834 19.0976 18.3166 18.7071 18.7071C18.3166 19.0976 17.6834 19.0976 17.2929 18.7071L12 13.4142L6.70711 18.7071C6.31658 19.0976 5.68342 19.0976 5.29289 18.7071C4.90237 18.3166 4.90237 17.6834 5.29289 17.2929L10.5858 12L5.29289 6.70711C4.90237 6.31658 4.90237 5.68342 5.29289 5.29289Z"/></svg></button>
      </div>
      <input class="input mb-2" data-field="title" placeholder="Event title" value="${escHtml(ev.title || "")}">
      <textarea class="input" data-field="description" rows="3" placeholder="Description…">${escHtml(ev.description || "")}</textarea>
    </div>`).join("");

  list.querySelectorAll("[data-rm-ti]").forEach((btn) => {
    btn.addEventListener("click", () => {
      timelineEvents.splice(+btn.dataset.rmTi, 1);
      renderTimeline();
    });
  });
}

// ── Glossary structured editor ────────────────────────────────────────────────

function populateGlossary(data) {
  glossaryEntries = Array.isArray(data.entries)
    ? data.entries.map((e) => ({ term: e.term || "", definition: e.definition || "", category: e.category || "" }))
    : [];
  renderGlossary();
}

function readGlossary() {
  el("nsdap-glossary-list").querySelectorAll("[data-gi]").forEach((row) => {
    const i = +row.dataset.gi;
    if (!glossaryEntries[i]) return;
    glossaryEntries[i].term       = row.querySelector("[data-field='term']")?.value?.trim() || "";
    glossaryEntries[i].definition = row.querySelector("[data-field='definition']")?.value?.trim() || "";
    glossaryEntries[i].category   = row.querySelector("[data-field='category']")?.value?.trim() || "";
  });
  return {
    entries: glossaryEntries
      .filter((e) => e.term)
      .map((e) => ({
        term:       e.term,
        definition: e.definition || "",
        ...(e.category ? { category: e.category } : {}),
      })),
  };
}

function addGlossaryEntry() {
  glossaryEntries.push({ term: "", definition: "", category: "" });
  renderGlossary();
  el("nsdap-glossary-list").lastElementChild?.scrollIntoView({ behavior: "smooth", block: "nearest" });
}

function renderGlossary() {
  const list = el("nsdap-glossary-list");
  if (!list) return;
  list.innerHTML = glossaryEntries.map((entry, i) => `
    <div data-gi="${i}" class="admin-card">
      <div style="display:grid;grid-template-columns:1fr 160px auto;gap:var(--space-2);margin-bottom:var(--space-2);">
        <input class="input" data-field="term" placeholder="Term" value="${escHtml(entry.term || "")}">
        <input class="input" data-field="category" placeholder="Category (optional)" value="${escHtml(entry.category || "")}">
        <button type="button" class="btn btn-secondary btn--xs btn--danger" data-rm-gi="${i}"><svg class="icon-inline" width="10" height="10" viewBox="0 0 24 24" aria-hidden="true" xmlns="http://www.w3.org/2000/svg"><path fill="currentColor" fill-rule="evenodd" clip-rule="evenodd" d="M5.29289 5.29289C5.68342 4.90237 6.31658 4.90237 6.70711 5.29289L12 10.5858L17.2929 5.29289C17.6834 4.90237 18.3166 4.90237 18.7071 5.29289C19.0976 5.68342 19.0976 6.31658 18.7071 6.70711L13.4142 12L18.7071 17.2929C19.0976 17.6834 19.0976 18.3166 18.7071 18.7071C18.3166 19.0976 17.6834 19.0976 17.2929 18.7071L12 13.4142L6.70711 18.7071C6.31658 19.0976 5.68342 19.0976 5.29289 18.7071C4.90237 18.3166 4.90237 17.6834 5.29289 17.2929L10.5858 12L5.29289 6.70711C4.90237 6.31658 4.90237 5.68342 5.29289 5.29289Z"/></svg></button>
      </div>
      <textarea class="input" data-field="definition" rows="2" placeholder="Definition…">${escHtml(entry.definition || "")}</textarea>
    </div>`).join("");

  list.querySelectorAll("[data-rm-gi]").forEach((btn) => {
    btn.addEventListener("click", () => {
      glossaryEntries.splice(+btn.dataset.rmGi, 1);
      renderGlossary();
    });
  });
}

init();
