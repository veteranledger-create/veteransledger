/**
 * VeteransLedger · Admin shell bootstrap
 *
 * Deliberately independent of the public site's layout (/layouts/MainLayout/
 * layout.js): no fetch of header.html/sidebar.html/mobile-menu.html/
 * footer.html/cookie-banner.html/contact-modal.html, no navigation.json/
 * site-settings.json/ui-strings.json, no i18n.js/language-switcher.js. The
 * Admin topbar in index.html is static, English-only markup — there is no
 * locale system here at all, so the Admin's language can never be affected
 * by whatever language a visitor last selected on the public site (Phase 2
 * of the Admin restructuring plan; see storage/admin-restructure/).
 *
 * Theme (dark/light) is intentionally still shared with the public site —
 * only *locale* was the problem, not the visual theme preference — via the
 * same "theme" localStorage key navigation.js already uses.
 */

const THEME_KEY = "theme";

function currentTheme() {
  return document.documentElement.getAttribute("data-theme") === "dark" ? "dark" : "light";
}

function applyTheme(theme) {
  if (theme === "dark") document.documentElement.setAttribute("data-theme", "dark");
  else document.documentElement.removeAttribute("data-theme");
}

function updateThemeButton() {
  const btn = document.getElementById("admin-theme-toggle");
  if (!btn) return;
  const dark = currentTheme() === "dark";
  btn.textContent = dark ? "Light" : "Dark";
  btn.setAttribute("aria-pressed", String(dark));
}

function toggleTheme() {
  const next = currentTheme() === "dark" ? "light" : "dark";
  applyTheme(next);
  try { localStorage.setItem(THEME_KEY, next); } catch (_) { /* storage unavailable — theme still applies for this load */ }
  updateThemeButton();
}

function initTheme() {
  let saved = null;
  try { saved = localStorage.getItem(THEME_KEY); } catch (_) { /* storage unavailable */ }
  applyTheme(saved === "dark" ? "dark" : "light");
  updateThemeButton();
}

function initShell() {
  document.documentElement.setAttribute("data-layout-ready", "");
  initTheme();
  document.getElementById("admin-theme-toggle")?.addEventListener("click", toggleTheme);
}

// Applied as early as possible (module scripts run once parsed, before
// DOMContentLoaded) rather than waiting on any network request — the old
// shared layout only finished this after 6 component/JSON fetches resolved.
if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", initShell, { once: true });
} else {
  initShell();
}
