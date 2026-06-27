import { authHeader, escHtml, makeStatusFn } from "./admin-utils.js";

/**
 * VeteransLedger · Admin — Site Settings Editor
 * Reads/writes public/data/site-settings.json via the site-content API.
 */

const KEY = "site-settings.json";
const setStatus = makeStatusFn("settings-form-status");
let fullData = null;

function init() {
  document.getElementById("admin-tabs")?.addEventListener("click", (e) => {
    if (e.target.closest('[data-tab="tab-settings"]')) loadSettings();
  });
  document.getElementById("settings-save-btn")?.addEventListener("click", handleSave);
}

async function loadSettings() {
  setStatus("Loading…", false);
  try {
    const res = await fetch(`/api/site-content?key=${encodeURIComponent(KEY)}`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    fullData = await res.json();
    populateForm(fullData);
    setStatus("", false);
  } catch (err) {
    setStatus(`Failed to load settings: ${err.message}`, true);
  }
}

function populateForm(data) {
  const f = (id) => document.getElementById(id);
  if (f("settings-site-name")) f("settings-site-name").value = data.siteName || data.name || "";
  if (f("settings-tagline")) f("settings-tagline").value = data.tagline || "";
  if (f("settings-description")) f("settings-description").value = data.description || "";
  if (f("settings-disclaimer")) f("settings-disclaimer").value = data.disclaimer || "";
  if (f("settings-contact-email")) f("settings-contact-email").value = data.contact?.email || data.contactEmail || "";
  // Advanced: show full JSON for anything not captured in simple fields
  const rawEl = document.getElementById("settings-raw-json");
  if (rawEl) rawEl.value = JSON.stringify(data, null, 2);
}

async function handleSave() {
  if (!fullData) { setStatus("Load settings first.", true); return; }

  const rawEl = document.getElementById("settings-raw-json");
  if (rawEl && rawEl.value.trim()) {
    let parsed;
    try { parsed = JSON.parse(rawEl.value); } catch (_) {
      setStatus("Invalid JSON — fix syntax before saving.", true); return;
    }
    // Merge structured field values over the raw JSON so explicit edits win
    const f = (id) => document.getElementById(id);
    if (f("settings-site-name")?.value) parsed.siteName = f("settings-site-name").value.trim();
    if (f("settings-tagline")?.value !== undefined) parsed.tagline = f("settings-tagline").value.trim() || undefined;
    if (f("settings-description")?.value !== undefined) parsed.description = f("settings-description").value.trim() || undefined;
    if (f("settings-disclaimer")?.value !== undefined) parsed.disclaimer = f("settings-disclaimer").value.trim() || undefined;
    fullData = parsed;
  }

  setStatus("Saving…", false);
  try {
    const res = await fetch(`/api/site-content?key=${encodeURIComponent(KEY)}`, {
      method: "PUT",
      headers: { ...authHeader(), "Content-Type": "application/json" },
      body: JSON.stringify(fullData),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    setStatus("Saved.", false);
  } catch (err) {
    setStatus(`Save failed: ${err.message}`, true);
  }
}

init();
