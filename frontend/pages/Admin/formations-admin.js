import { authHeader, escHtml, makeStatusFn } from "./admin-utils.js";

/**
 * VeteransLedger · Admin — Units & Formations Content
 * Reads and writes public/data/formations/** via the site-content API.
 */

const FORMATIONS_FILES = [
  { key: "formations/index.json",                    label: "Formations Index" },
  { key: "formations/volunteer-formations.json",     label: "Volunteer Formations" },
  { key: "formations/allies/allies.json",            label: "Allied Formations" },
  { key: "formations/germany/army-groups.json",      label: "Germany: Army Groups" },
  { key: "formations/germany/armies.json",           label: "Germany: Armies" },
  { key: "formations/germany/corps.json",            label: "Germany: Corps" },
  { key: "formations/germany/divisions.json",        label: "Germany: Divisions" },
  { key: "formations/germany/brigades.json",         label: "Germany: Brigades" },
  { key: "formations/germany/regiments.json",        label: "Germany: Regiments" },
  { key: "formations/germany/battalions.json",       label: "Germany: Battalions" },
  { key: "formations/germany/companies.json",        label: "Germany: Companies" },
  { key: "formations/germany/ss.json",               label: "Germany: SS Units" },
  { key: "formations/germany/luftflotte.json",       label: "Germany: Luftflotte" },
  { key: "formations/germany/naval.json",            label: "Germany: Naval" },
];

let currentKey = null;
const setStatus = makeStatusFn("formations-form-status");

function init() {
  document.getElementById("admin-tabs")?.addEventListener("click", (e) => {
    if (e.target.closest('[data-tab="tab-formations"]')) renderSidebar();
  });
  document.getElementById("formations-save-btn")?.addEventListener("click", handleSave);
}

function renderSidebar() {
  const sidebar = document.getElementById("formations-file-list");
  if (!sidebar) return;
  sidebar.innerHTML = FORMATIONS_FILES.map((f) => `
    <div class="sidebar-item${currentKey === f.key ? " sidebar-item--active" : ""}" data-key="${escHtml(f.key)}" style="cursor:pointer;padding:var(--space-2) var(--space-3);border-radius:4px;font-size:var(--text-sm);${currentKey === f.key ? "background:rgba(255,255,255,0.08);" : ""}">
      ${escHtml(f.label)}
    </div>`).join("");
  sidebar.querySelectorAll("[data-key]").forEach((el) => el.addEventListener("click", () => loadFile(el.dataset.key)));
}

async function loadFile(key) {
  currentKey = key;
  renderSidebar();
  setStatus("Loading…", false);
  const editor = document.getElementById("formations-editor");
  const titleEl = document.getElementById("formations-editor-title");
  const label = FORMATIONS_FILES.find((f) => f.key === key)?.label || key;
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
  const editor = document.getElementById("formations-editor");
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
