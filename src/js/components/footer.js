/**
 * FOOTER COMPONENT
 * Shared footer logic for the VeteranLedger archive.
 *
 * Usage:
 *   import { buildFooter } from '@components/footer';
 *   buildFooter();
 */

import { SITE, LEGAL_LINKS } from '@core/config';

/**
 * Build and inject the footer HTML.
 */
export function buildFooter() {
  const existing = document.querySelector('.footer');
  if (existing) return; // Already has footer markup

  const footer = document.createElement('footer');
  footer.className = 'footer';
  footer.innerHTML = getFooterHTML();
  document.body.appendChild(footer);
}

/**
 * Generate footer HTML.
 * @returns {string}
 */
function getFooterHTML() {
  return `
    <div class="footer-content">
      <div class="footer-logo">
        <div class="eagle-logo"></div>
        <span class="footer-logo-text">${SITE.name}</span>
      </div>
      <div class="footer-tagline">${SITE.tagline}</div>
      <div class="footer-copyright">© ${new Date().getFullYear()} ${SITE.copyright}</div>
      <div class="footer-disclaimer">
        ${LEGAL_LINKS.map(link =>
          `<a href="${link.path}" class="footer-disclaimer-link">${link.label}</a>`
        ).join(' · ')}
      </div>
    </div>
  `;
}
