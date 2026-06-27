import { authHeader, escHtml, makeStatusFn } from "./admin-utils.js";

/**
 * VeteransLedger · Admin — NSDAP Content
 * Reads and writes public/data/nsdap/** via the site-content API.
 * Uses a sidebar to select which file to edit; content is shown as a
 * pretty-printed JSON textarea for structured editing.
 */

const NSDAP_FILES = [
  { key: "nsdap/overview.json",              label: "Overview" },
  { key: "nsdap/glossary.json",              label: "Glossary" },
  { key: "nsdap/index.json",                 label: "Index / Navigation" },
  { key: "nsdap/timeline.json",              label: "NSDAP Timeline" },
  { key: "nsdap/sources.json",               label: "Sources" },
  { key: "nsdap/party/formation.json",       label: "Party: Formation" },
  { key: "nsdap/party/structure.json",       label: "Party: Structure" },
  { key: "nsdap/party/leadership.json",      label: "Party: Leadership" },
  { key: "nsdap/party/organizations.json",   label: "Party: Organizations" },
  { key: "nsdap/party/departments.json",     label: "Party: Departments" },
  { key: "nsdap/party/economy.json",         label: "Party: Economy" },
  { key: "nsdap/party/foreign-policy.json",  label: "Party: Foreign Policy" },
  { key: "nsdap/party/religion.json",        label: "Party: Religion" },
  { key: "nsdap/party/state-relations.json", label: "Party: State Relations" },
  { key: "nsdap/party/programme.json",       label: "Party: Programme" },
  { key: "nsdap/party/dissolution.json",     label: "Party: Dissolution" },
  { key: "nsdap/hitler/bio.json",            label: "Hitler: Biography" },
  { key: "nsdap/hitler/rise.json",           label: "Hitler: Rise to Power" },
  { key: "nsdap/hitler/chancellorship.json", label: "Hitler: Chancellorship" },
  { key: "nsdap/hitler/rule.json",           label: "Hitler: Rule" },
  { key: "nsdap/hitler/wartime.json",        label: "Hitler: Wartime" },
  { key: "nsdap/hitler/end.json",            label: "Hitler: End" },
  { key: "nsdap/hitler/family.json",         label: "Hitler: Family" },
];

let currentKey = null;
const setStatus = makeStatusFn("nsdap-form-status");

function init() {
  document.getElementById("admin-tabs")?.addEventListener("click", (e) => {
    if (e.target.closest('[data-tab="tab-nsdap"]')) renderSidebar();
  });
  document.getElementById("nsdap-save-btn")?.addEventListener("click", handleSave);
}

function renderSidebar() {
  const sidebar = document.getElementById("nsdap-file-list");
  if (!sidebar) return;
  sidebar.innerHTML = NSDAP_FILES.map((f) => `
    <div class="sidebar-item${currentKey === f.key ? " sidebar-item--active" : ""}" data-key="${escHtml(f.key)}" style="cursor:pointer;padding:var(--space-2) var(--space-3);border-radius:4px;font-size:var(--text-sm);${currentKey === f.key ? "background:rgba(255,255,255,0.08);" : ""}">
      ${escHtml(f.label)}
    </div>`).join("");
  sidebar.querySelectorAll("[data-key]").forEach((el) => el.addEventListener("click", () => loadFile(el.dataset.key)));
}

async function loadFile(key) {
  currentKey = key;
  renderSidebar();
  setStatus("Loading…", false);
  const editor = document.getElementById("nsdap-editor");
  const titleEl = document.getElementById("nsdap-editor-title");
  const label = NSDAP_FILES.find((f) => f.key === key)?.label || key;
  if (titleEl) titleEl.textContent = label;
  editor.value = "";
  editor.disabled = true;

  try {
    const res = await fetch(`/api/site-content?key=${encodeURIComponent(key)}`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    editor.value = JSON.stringify(data, null, 2);
    editor.disabled = false;
    setStatus("", false);
  } catch (err) {
    editor.value = "";
    setStatus(`Failed to load: ${err.message}`, true);
  }
}

async function handleSave() {
  if (!currentKey) { setStatus("Select a file first.", true); return; }
  const editor = document.getElementById("nsdap-editor");
  let parsed;
  try {
    parsed = JSON.parse(editor.value);
  } catch (_) {
    setStatus("Invalid JSON — fix syntax errors before saving.", true);
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

init();
