/**
 * HOME PAGE – ENTRY MODULE
 * VeteranLedger Axis History Archive
 *
 * This module is loaded on index.html via Vite.
 * It sets up shared components and home page interactivity.
 *
 * Usage:
 *   Imported as entry point in Vite config.
 */

import '@css/main.css';

import { initTheme } from '@core/theme-manager';
import { initNavigation, buildNav } from '@components/navigation';
import { buildFooter } from '@components/footer';
import { initModals } from '@components/modal';
import { initReturnToTop } from '@components/return-to-top';

/**
 * Initialize home page.
 */
document.addEventListener('DOMContentLoaded', () => {
  // Core setup
  initTheme();

  // Build shared components if not already in markup
  buildNav();
  buildFooter();

  // Initialize interactive components
  initNavigation();
  initReturnToTop();
  initModals();

  console.log('[Home] Page initialized.');
});
