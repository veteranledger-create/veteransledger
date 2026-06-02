/**
 * Archival Cookie Notice
 *
 * Minimal, non-blocking bottom banner.
 * - Dismissible via button click
 * - localStorage persistence (1 year)
 * - Keyboard accessible
 * - No tracking or consent management — purely informational
 * - Archival/museum aesthetic
 */

const COOKIE_DISMISSED_KEY = 'veteranledger_cookie_notice_dismissed';
const COOKIE_DISMISSED_EXPIRY = 365 * 24 * 60 * 60 * 1000; // 1 year

export function initCookieNotice() {
  // Check if already dismissed
  const dismissed = localStorage.getItem(COOKIE_DISMISSED_KEY);
  if (dismissed) {
    try {
      const timestamp = parseInt(dismissed, 10);
      if (Date.now() - timestamp < COOKIE_DISMISSED_EXPIRY) {
        return; // Still within validity period
      }
    } catch {
      // Invalid timestamp, re-show
    }
  }

  // Create notice element
  const notice = document.createElement('div');
  notice.className = 'archival-cookie-notice';
  notice.setAttribute('role', 'dialog');
  notice.setAttribute('aria-label', 'Cookie notice');

  notice.innerHTML = `
    <span class="archival-cookie-notice-text">
      This archival website uses minimal cookies for functional purposes only.
      <a href="/privacy-policy.html" target="_blank" rel="noopener">Privacy Policy</a>
    </span>
    <button class="archival-cookie-notice-btn" type="button" aria-label="Dismiss cookie notice">
      Acknowledge
    </button>
  `;

  document.body.appendChild(notice);

  // Dismiss handler
  const dismissBtn = notice.querySelector('.archival-cookie-notice-btn');
  const dismiss = () => {
    notice.classList.add('hidden');
    localStorage.setItem(COOKIE_DISMISSED_KEY, String(Date.now()));
    // Remove from DOM after transition
    setTimeout(() => {
      if (notice.parentNode) {
        notice.parentNode.removeChild(notice);
      }
    }, 350);
  };

  dismissBtn.addEventListener('click', dismiss);
  dismissBtn.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      dismiss();
    }
  });

  // Allow Escape to dismiss
  notice.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      dismiss();
    }
  });

  // Focus the dismiss button on mount
  requestAnimationFrame(() => {
    dismissBtn.focus();
  });
}
