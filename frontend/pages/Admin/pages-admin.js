import { authHeader, escHtml, makeStatusFn } from "./admin-utils.js";

/**
 * VeteransLedger · Admin — Content Page Editor
 * A single editor for all site-content JSON pages: About, Mission, Sources,
 * site-policies, and legal pages. Reads/writes via the site-content API.
 */

const PAGE_FILES = [
  { key: "about/about.json",                    label: "About — Main" },
  { key: "about/mission.json",                  label: "About — Mission" },
  { key: "about/sources.json",                  label: "About — Sources" },
  { key: "site-policies/privacy-policy.json",   label: "Privacy Policy" },
  { key: "site-policies/terms-of-use.json",     label: "Terms of Use" },
  { key: "site-policies/disclaimer.json",       label: "Disclaimer" },
  { key: "site-policies/copyright-policy.json", label: "Copyright Policy" },
  { key: "legal/privacy-policy.json",           label: "Legal: Privacy Policy" },
  { key: "legal/terms-of-use.json",             label: "Legal: Terms of Use" },
  { key: "legal/cookie-policy.json",            label: "Legal: Cookie Policy" },
  { key: "legal/copyright-policy.json",         label: "Legal: Copyright Policy" },
];

let currentKey = null;
const setStatus = makeStatusFn("pages-form-status");

function init() {
  document.getElementById("admin-tabs")?.addEventListener("click", (e) => {
    if (e.target.closest('[data-tab="tab-pages"]')) renderSidebar();
  });
  document.getElementById("pages-save-btn")?.addEventListener("click", handleSave);
}

function renderSidebar() {
  const sidebar = document.getElementById("pages-file-list");
  if (!sidebar) return;
  sidebar.innerHTML = PAGE_FILES.map((f) => `
    <div class="sidebar-item${currentKey === f.key ? " sidebar-item--active" : ""}" data-key="${escHtml(f.key)}" style="cursor:pointer;padding:var(--space-2) var(--space-3);border-radius:4px;font-size:var(--text-sm);${currentKey === f.key ? "background:rgba(255,255,255,0.08);" : ""}">
      ${escHtml(f.label)}
    </div>`).join("");
  sidebar.querySelectorAll("[data-key]").forEach((el) => el.addEventListener("click", () => loadFile(el.dataset.key)));
}

async function loadFile(key) {
  currentKey = key;
  renderSidebar();
  setStatus("Loading…", false);
  const editor = document.getElementById("pages-editor");
  const titleEl = document.getElementById("pages-editor-title");
  const label = PAGE_FILES.find((f) => f.key === key)?.label || key;
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
  if (!currentKey) { setStatus("Select a page first.", true); return; }
  const editor = document.getElementById("pages-editor");
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
