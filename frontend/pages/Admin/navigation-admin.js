import { authHeader, escHtml, makeStatusFn } from "./admin-utils.js";

/**
 * VeteransLedger · Admin — Navigation Editor
 * Reads/writes public/data/navigation.json via the site-content API.
 * The top-level fields (brand, social) are shown as structured form inputs;
 * the nav items array is shown as a pretty-printed JSON textarea for full
 * structural control without building a full nested-list editor.
 */

const KEY = "navigation.json";
const setStatus = makeStatusFn("nav-form-status");
let fullData = null;

function init() {
  document.getElementById("admin-tabs")?.addEventListener("click", (e) => {
    if (e.target.closest('[data-tab="tab-navigation"]')) loadNav();
  });
  document.getElementById("nav-save-btn")?.addEventListener("click", handleSave);
}

async function loadNav() {
  setStatus("Loading…", false);
  try {
    const res = await fetch(`/api/site-content?key=${encodeURIComponent(KEY)}`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    fullData = await res.json();
    populateForm(fullData);
    setStatus("", false);
  } catch (err) {
    setStatus(`Failed to load navigation: ${err.message}`, true);
  }
}

function populateForm(data) {
  const brand = data.brand || {};
  const social = data.social || {};

  const f = (id) => document.getElementById(id);
  if (f("nav-brand-name")) f("nav-brand-name").value = brand.name || "";
  if (f("nav-brand-tagline")) f("nav-brand-tagline").value = brand.tagline || "";
  if (f("nav-social-github")) f("nav-social-github").value = social.github || "";
  if (f("nav-social-twitter")) f("nav-social-twitter").value = social.twitter || "";

  // The items/sections arrays are edited as raw JSON
  const itemsEl = document.getElementById("nav-items-json");
  if (itemsEl) itemsEl.value = JSON.stringify(data.items || data.sections || [], null, 2);
}

async function handleSave() {
  if (!fullData) { setStatus("Load navigation first.", true); return; }

  const f = (id) => document.getElementById(id);
  const itemsEl = document.getElementById("nav-items-json");
  let items;
  try {
    items = JSON.parse(itemsEl?.value || "[]");
  } catch (_) {
    setStatus("Invalid JSON in navigation items — fix syntax before saving.", true);
    return;
  }

  const payload = {
    ...fullData,
    brand: {
      ...(fullData.brand || {}),
      name: f("nav-brand-name")?.value?.trim() || fullData.brand?.name,
      tagline: f("nav-brand-tagline")?.value?.trim() || undefined,
    },
    social: {
      github: f("nav-social-github")?.value?.trim() || undefined,
      twitter: f("nav-social-twitter")?.value?.trim() || undefined,
    },
  };

  // Preserve whichever key the original file uses (items vs sections)
  if ("items" in fullData) payload.items = items;
  else payload.sections = items;

  setStatus("Saving…", false);
  try {
    const res = await fetch(`/api/site-content?key=${encodeURIComponent(KEY)}`, {
      method: "PUT",
      headers: { ...authHeader(), "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    fullData = payload;
    setStatus("Saved.", false);
  } catch (err) {
    setStatus(`Save failed: ${err.message}`, true);
  }
}

init();
