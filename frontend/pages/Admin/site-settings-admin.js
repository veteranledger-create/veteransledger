import { authHeader, makeStatusFn, safeJson } from "./admin-utils.js";
import { TranslationsPanel } from "./translations-panel.js";

/**
 * VeteransLedger · Admin — Site Settings Editor
 * Reads/writes public/data/site-settings.json via the site-content API.
 * Structured fields cover: general site info, contact modal text,
 * cookie banner text. Advanced raw-JSON textarea for everything else.
 */

const KEY = "site-settings.json";
const setStatus = makeStatusFn("settings-form-status");
const translationsPanel = new TranslationsPanel("settings-translations-panel", "site_content");
let fullData = null;

function f(id) { return document.getElementById(id); }

function init() {
  document.getElementById("admin-tabs")?.addEventListener("click", (e) => {
    if (e.target.closest('[data-tab="tab-settings"]')) loadSettings();
  });
  f("settings-save-btn")?.addEventListener("click", handleSave);
}

async function loadSettings() {
  setStatus("Loading…", false);
  try {
    const res = await fetch(`/api/site-content?key=${encodeURIComponent(KEY)}`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    fullData = await safeJson(res);
    populateForm(fullData);
    setStatus("", false);
    translationsPanel.load(KEY);
  } catch (err) {
    setStatus(`Failed to load settings: ${err.message}`, true);
  }
}

function populateForm(data) {
  const site    = data.site       ?? {};
  const contact = data.contact    ?? {};
  const cookie  = data.cookieBanner ?? {};

  // General
  if (f("settings-site-name"))     f("settings-site-name").value     = site.name          ?? data.siteName ?? "";
  if (f("settings-tagline"))       f("settings-tagline").value       = site.tagline        ?? data.tagline  ?? "";
  if (f("settings-description"))   f("settings-description").value   = site.description    ?? data.description ?? "";
  if (f("settings-disclaimer"))    f("settings-disclaimer").value    = data.disclaimer?.text ?? data.disclaimer ?? "";
  if (f("settings-contact-email")) f("settings-contact-email").value = site.contact_email  ?? data.contactEmail ?? "";

  // Contact modal
  if (f("settings-contact-modal-title"))  f("settings-contact-modal-title").value  = contact.modalTitle   ?? "";
  if (f("settings-contact-to"))           f("settings-contact-to").value           = contact.toDisplay    ?? "";
  if (f("settings-contact-email-addr"))   f("settings-contact-email-addr").value   = contact.email        ?? "";
  if (f("settings-contact-email-label"))  f("settings-contact-email-label").value  = contact.emailLabel   ?? "";
  if (f("settings-contact-info-heading")) f("settings-contact-info-heading").value = contact.infoHeading  ?? "";
  if (f("settings-contact-info-text"))    f("settings-contact-info-text").value    = contact.infoText     ?? "";
  if (f("settings-contact-guidance"))     f("settings-contact-guidance").value     = contact.guidanceText ?? "";

  // Cookie banner
  if (f("settings-cookie-text"))          f("settings-cookie-text").value          = cookie.text          ?? "";
  if (f("settings-cookie-privacy-label")) f("settings-cookie-privacy-label").value = cookie.privacyLabel  ?? "";
  if (f("settings-cookie-privacy-href"))  f("settings-cookie-privacy-href").value  = cookie.privacyHref   ?? "";
  if (f("settings-cookie-accept"))        f("settings-cookie-accept").value        = cookie.acceptLabel   ?? "";
  if (f("settings-cookie-dismiss"))       f("settings-cookie-dismiss").value       = cookie.dismissLabel  ?? "";

  // Advanced JSON (full file)
  if (f("settings-raw-json")) f("settings-raw-json").value = JSON.stringify(data, null, 2);
}

async function handleSave() {
  if (!fullData) { setStatus("Load settings first.", true); return; }

  // Parse the raw JSON textarea as the base (allows arbitrary field edits)
  const rawEl = f("settings-raw-json");
  let base = fullData;
  if (rawEl?.value.trim()) {
    try { base = JSON.parse(rawEl.value); }
    catch (_) { setStatus("Invalid JSON in advanced field — fix syntax before saving.", true); return; }
  }

  // Merge structured fields over the base
  base.site = {
    ...(base.site ?? {}),
    name:          f("settings-site-name")?.value.trim()     || base.site?.name,
    tagline:       f("settings-tagline")?.value.trim()       || undefined,
    description:   f("settings-description")?.value.trim()   || undefined,
    contact_email: f("settings-contact-email")?.value.trim() || undefined,
  };

  base.contact = {
    ...(base.contact ?? {}),
    modalTitle:   f("settings-contact-modal-title")?.value.trim()  || undefined,
    toDisplay:    f("settings-contact-to")?.value.trim()           || undefined,
    email:        f("settings-contact-email-addr")?.value.trim()   || undefined,
    emailLabel:   f("settings-contact-email-label")?.value.trim()  || undefined,
    infoHeading:  f("settings-contact-info-heading")?.value.trim() || undefined,
    infoText:     f("settings-contact-info-text")?.value.trim()    || undefined,
    guidanceText: f("settings-contact-guidance")?.value.trim()     || undefined,
  };

  base.cookieBanner = {
    ...(base.cookieBanner ?? {}),
    text:         f("settings-cookie-text")?.value.trim()          || undefined,
    privacyLabel: f("settings-cookie-privacy-label")?.value.trim() || undefined,
    privacyHref:  f("settings-cookie-privacy-href")?.value.trim()  || undefined,
    acceptLabel:  f("settings-cookie-accept")?.value.trim()        || undefined,
    dismissLabel: f("settings-cookie-dismiss")?.value.trim()       || undefined,
  };

  // Preserve disclaimer shape
  const disclaimerText = f("settings-disclaimer")?.value.trim();
  if (disclaimerText) {
    if (typeof base.disclaimer === "object" && base.disclaimer !== null) {
      base.disclaimer.text = disclaimerText;
    } else {
      base.disclaimer = { ...(fullData.disclaimer ?? {}), text: disclaimerText };
    }
  }

  fullData = base;

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
