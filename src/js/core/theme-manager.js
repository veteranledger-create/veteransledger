/**
 * THEME MANAGER MODULE
 * Manages dark/light theme toggling with localStorage persistence.
 *
 * This replaces the duplicated inline theme toggle scripts found in
 * every original HTML page.
 *
 * Usage:
 *   import { initTheme, toggleTheme, getCurrentTheme } from '@core/theme-manager';
 *
 *   initTheme(); // Call on DOMContentLoaded
 */

import { THEME } from "@core/config";

const { storageKey, defaultTheme, darkTheme } = THEME;

/**
 * Get the currently active theme.
 * @returns {'light'|'dark'}
 */
export function getCurrentTheme() {
  const stored = localStorage.getItem(storageKey);
  if (stored === darkTheme) return darkTheme;
  if (stored === "light") return "light";
  return defaultTheme;
}

/**
 * Apply a theme to the document.
 * @param {'light'|'dark'} theme
 */
export function setTheme(theme) {
  if (theme === darkTheme) {
    document.documentElement.setAttribute("data-theme", darkTheme);
  } else {
    document.documentElement.removeAttribute("data-theme");
  }
  localStorage.setItem(storageKey, theme);
}

/**
 * Toggle between light and dark themes.
 * @returns {'light'|'dark'} The new theme
 */
export function toggleTheme() {
  const current = getCurrentTheme();
  const next = current === darkTheme ? "light" : darkTheme;
  setTheme(next);
  return next;
}

/**
 * Initialize theme system.
 * Call this once on page load.
 */
export function initTheme() {
  // Apply saved theme
  const saved = getCurrentTheme();
  setTheme(saved);

  // Handle system preference change
  const mediaQuery = window.matchMedia("(prefers-color-scheme: dark)");
  const handleChange = (e) => {
    const stored = localStorage.getItem(storageKey);
    if (!stored) {
      // Only auto-switch if user hasn't set a preference
      setTheme(e.matches ? darkTheme : "light");
    }
  };
  mediaQuery.addEventListener("change", handleChange);
}
