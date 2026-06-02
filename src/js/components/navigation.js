/**
 * NAVIGATION COMPONENT
 * Shared navigation logic for the VeteranLedger archive.
 *
 * Features:
 * - Desktop nav bar with highlight for active page
 * - Mobile hamburger menu with slide-in drawer
 * - Theme toggle integration
 * - Dynamic active page detection
 *
 * Usage:
 *   import { initNavigation } from '@components/navigation';
 *   initNavigation();
 */

import { NAVIGATION, SITE, LEGAL_LINKS } from '@core/config';
import { getCurrentTheme, setTheme, toggleTheme } from '@core/theme-manager';

/**
 * Build and inject the navigation HTML into the page.
 * Targets .nav-container if it exists, otherwise creates one.
 */
export function buildNav() {
  const existing = document.querySelector('.nav-container');
  if (existing) return; // Already has nav markup

  const nav = document.createElement('div');
  nav.className = 'nav-container';
  nav.innerHTML = getNavHTML();
  document.body.prepend(nav);
}

/**
 * Generate the full navigation HTML string.
 * @returns {string}
 */
function getNavHTML() {
  const currentPath = window.location.pathname;
  const theme = getCurrentTheme();
  const themeLabel = theme === 'dark' ? '☀︎ LIGHT' : '☽ DARK';

  return `
    <nav class="nav-container" role="navigation" aria-label="Main navigation">
      <div class="nav-inner">
        <div class="nav-logo">
          <a href="/" class="logo-link" aria-label="Home page">
            <div class="eagle-logo"></div>
          </a>
        </div>

        <div class="desktop-nav">
          ${NAVIGATION.map(item => `
            <a href="${item.path}" class="nav-item ${isActive(item.path, currentPath) ? 'active' : ''}">
              ${item.label}
            </a>
          `).join('')}
        </div>

        <div class="nav-actions" style="display:flex;align-items:center;gap:12px;">
          <button class="theme-toggle" id="theme-toggle" aria-label="Toggle theme">
            <span class="theme-text">${themeLabel}</span>
          </button>
          <button class="mobile-menu-button" id="mobile-menu-button" aria-label="Toggle mobile menu" aria-expanded="false">
            <span>☰ MENU</span>
          </button>
        </div>
      </div>

      <div class="mobile-menu hidden" id="mobile-menu" role="dialog" aria-label="Mobile navigation">
        <div class="mobile-nav-content">
          ${NAVIGATION.map(item => `
            <a href="${item.path}" class="mobile-nav-item ${isActive(item.path, currentPath) ? 'active' : ''}">
              ${item.label}
            </a>
          `).join('')}
          ${LEGAL_LINKS.map(item => `
            <a href="${item.path}" class="mobile-nav-item" style="font-size:0.8rem;opacity:0.7;">
              ${item.label}
            </a>
          `).join('')}
        </div>
      </div>
    </nav>
  `;
}

/**
 * Check if a navigation path matches the current page.
 * @param {string} navPath
 * @param {string} currentPath
 * @returns {boolean}
 */
function isActive(navPath, currentPath) {
  if (navPath === '/') {
    return currentPath === '/' || currentPath === '/index.html' || currentPath === '';
  }
  return currentPath.includes(navPath);
}

/**
 * Initialize navigation event handlers.
 */
export function initNavigation() {
  // Theme toggle
  const themeBtn = document.getElementById('theme-toggle');
  if (themeBtn) {
    themeBtn.addEventListener('click', () => {
      const next = toggleTheme();
      themeBtn.querySelector('.theme-text').textContent =
        next === 'dark' ? '☀︎ LIGHT' : '☽ DARK';
    });
  }

  // Mobile menu toggle
  const menuBtn = document.getElementById('mobile-menu-button');
  const mobileMenu = document.getElementById('mobile-menu');
  if (menuBtn && mobileMenu) {
    menuBtn.addEventListener('click', () => {
      const isOpen = !mobileMenu.classList.contains('hidden');
      mobileMenu.classList.toggle('hidden', isOpen);
      menuBtn.setAttribute('aria-expanded', !isOpen);
      menuBtn.querySelector('span').textContent = isOpen ? '☰ MENU' : '✕ CLOSE';
    });

    // Close menu on link click
    mobileMenu.querySelectorAll('.mobile-nav-item').forEach(link => {
      link.addEventListener('click', () => {
        mobileMenu.classList.add('hidden');
        menuBtn.setAttribute('aria-expanded', 'false');
        menuBtn.querySelector('span').textContent = '☰ MENU';
      });
    });

    // Close menu on click outside
    document.addEventListener('click', (e) => {
      if (!mobileMenu.classList.contains('hidden') &&
          !menuBtn.contains(e.target) &&
          !mobileMenu.contains(e.target)) {
        mobileMenu.classList.add('hidden');
        menuBtn.setAttribute('aria-expanded', 'false');
        menuBtn.querySelector('span').textContent = '☰ MENU';
      }
    });
  }
}
