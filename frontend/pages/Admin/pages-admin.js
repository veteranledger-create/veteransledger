import { TranslationsPanel } from "./translations-panel.js";
import { authHeader, escHtml, makeStatusFn, safeJson } from "./admin-utils.js";
import { createStructuredEditor } from "./admin-structured-editor.js";

/**
 * VeteransLedger · Admin — Content Page Editor
 * A single editor for all site-content JSON pages: About, Mission, Sources,
 * site-policies, and legal pages. Reads/writes via the site-content API.
 *
 * Default experience is the structured field/block editor
 * (admin-structured-editor.js). Raw JSON is available only behind the
 * "Developer mode" toggle — it is never the normal editing surface.
 */

const PAGE_FILES = [
  { key: "homepage.json",                        label: "Homepage" },
  { key: "about/about.json",                    label: "About — Main" },
  { key: "about/mission.json",                  label: "About — Mission" },
  { key: "about/sources.json",                  label: "About — Sources" },
  { key: "site-policies/privacy-policy.json",   label: "Privacy Policy" },
  { key: "site-policies/terms-of-use.json",     label: "Terms of Use" },
  { key: "site-policies/disclaimer.json",       label: "Disclaimer" },
  { key: "site-policies/copyright-policy.json", label: "Copyright Policy" },
  { key: "site-policies/removal-requests.json", label: "Removal Requests" },
  { key: "legal/privacy-policy.json",           label: "Legal: Privacy Policy" },
  { key: "legal/terms-of-use.json",             label: "Legal: Terms of Use" },
  { key: "legal/cookie-policy.json",            label: "Legal: Cookie Policy" },
  { key: "legal/copyright-policy.json",         label: "Legal: Copyright Policy" },
];

let currentKey = null;
let structured = null;   // handle returned by createStructuredEditor
let currentData = null;  // last-parsed JSON for the loaded file
const setStatus = makeStatusFn("pages-form-status");
const translationsPanel = new TranslationsPanel("pages-translations-panel", "site_content");

function el(id) { return document.getElementById(id); }

function init() {
  document.getElementById("admin-tabs")?.addEventListener("click", (e) => {
    if (e.target.closest('[data-tab="tab-pages"]')) renderSidebar();
  });
  el("pages-save-btn")?.addEventListener("click", handleSave);
  el("pages-dev-mode")?.addEventListener("change", toggleDevMode);
}

function devMode() { return !!el("pages-dev-mode")?.checked; }

function toggleDevMode() {
  const editor = el("pages-editor");
  const structuredEl = el("pages-structured");
  if (!currentKey) { editor.hidden = !devMode(); structuredEl.hidden = devMode(); return; }

  if (devMode()) {
    // Entering dev mode: serialize the structured state into the textarea
    try { currentData = structured ? structured.read() : currentData; }
    catch (_) { /* invalid Advanced JSON — fall back to last good data */ }
    editor.value = JSON.stringify(currentData, null, 2);
    editor.disabled = false;
    editor.hidden = false;
    structuredEl.hidden = true;
  } else {
    // Leaving dev mode: re-parse the textarea back into the structured editor
    try {
      currentData = JSON.parse(editor.value);
      setStatus("", false);
    } catch (_) {
      setStatus("Invalid JSON in Developer mode — reverting to last valid state.", true);
    }
    structured = createStructuredEditor(structuredEl, currentData);
    editor.hidden = true;
    structuredEl.hidden = false;
  }
}

function renderSidebar() {
  const sidebar = el("pages-file-list");
  if (!sidebar) return;
  sidebar.innerHTML = PAGE_FILES.map((f) => `
    <div class="sidebar-item${currentKey === f.key ? " sidebar-item--active" : ""}" data-key="${escHtml(f.key)}">
      ${escHtml(f.label)}
    </div>`).join("");
  sidebar.querySelectorAll("[data-key]").forEach((div) => div.addEventListener("click", () => loadFile(div.dataset.key)));
}

async function loadFile(key) {
  currentKey = key;
  renderSidebar();
  setStatus("Loading…", false);
  const editor = el("pages-editor");
  const structuredEl = el("pages-structured");
  const titleEl = el("pages-editor-title");
  const label = PAGE_FILES.find((f) => f.key === key)?.label || key;
  if (titleEl) titleEl.textContent = label;

  try {
    const res = await fetch(`/api/site-content?key=${encodeURIComponent(key)}`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    currentData = await safeJson(res);
    structured = createStructuredEditor(structuredEl, currentData);
    editor.value = JSON.stringify(currentData, null, 2);
    editor.disabled = false;
    editor.hidden = !devMode();
    structuredEl.hidden = devMode();
    setStatus("", false);
    translationsPanel.load(key);
  } catch (err) {
    structuredEl.innerHTML = "";
    editor.value = "";
    setStatus(`Failed to load: ${err.message}`, true);
  }
}

async function handleSave() {
  if (!currentKey) { setStatus("Select a page first.", true); return; }

  let parsed;
  if (devMode()) {
    try {
      parsed = JSON.parse(el("pages-editor").value);
    } catch (_) {
      setStatus("Invalid JSON — fix syntax errors before saving.", true);
      return;
    }
  } else {
    try {
      parsed = structured.read();
    } catch (err) {
      setStatus(`Invalid JSON in an Advanced field: ${err.message}`, true);
      return;
    }
  }

  setStatus("Saving…", false);
  try {
    const res = await fetch(`/api/site-content?key=${encodeURIComponent(currentKey)}`, {
      method: "PUT",
      headers: { ...authHeader(), "Content-Type": "application/json" },
      body: JSON.stringify(parsed),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    currentData = parsed;
    setStatus("Saved.", false);
  } catch (err) {
    setStatus(`Save failed: ${err.message}`, true);
  }
}

init();
