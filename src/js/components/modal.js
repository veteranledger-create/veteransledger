/**
 * MODAL COMPONENT
 * Reusable modal dialog for the VeteranLedger archive.
 *
 * Features:
 * - Open/close with animation
 * - Keyboard trap (Escape to close)
 * - Click-outside-to-close
 * - Focus management
 * - Scroll lock on body
 *
 * Usage:
 *   import { openModal, closeModal, initModals } from '@components/modal';
 *
 *   // Open programmatically
 *   openModal({ title: 'My Title', bodyHTML: '<p>Content</p>' });
 *
 *   // Or use data attributes
 *   <button data-modal="my-data-key">Open</button>
 */

import { loadData } from '@core/data-loader';

let activeModal = null;
let previousFocus = null;

/**
 * Open a modal with the given content.
 * @param {Object} options
 * @param {string} options.title - Modal title
 * @param {string} options.bodyHTML - HTML content for the body
 * @param {string} [options.footerHTML] - Optional footer HTML
 * @param {Function} [options.onClose] - Callback when modal closes
 */
export function openModal({ title, bodyHTML, footerHTML, onClose }) {
  // Close any existing modal first
  if (activeModal) {
    closeModal();
  }

  previousFocus = document.activeElement;

  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';
  overlay.setAttribute('role', 'dialog');
  overlay.setAttribute('aria-modal', 'true');
  overlay.setAttribute('aria-label', title || 'Information');

  overlay.innerHTML = `
    <div class="modal-container">
      <div class="modal-header">
        <h2 class="modal-title">${escapeHTML(title || '')}</h2>
      </div>
      <div class="modal-body">
        ${bodyHTML || ''}
      </div>
      ${footerHTML ? `<div class="modal-footer">${footerHTML}</div>` : ''}
      <button class="modal-close-btn" aria-label="Close modal" style="
        position: absolute; top: 12px; right: 16px;
        background: none; border: none; color: white;
        font-size: 1.5rem; cursor: pointer; opacity: 0.8;
        font-family: var(--font-typewriter);
      ">✕</button>
    </div>
  `;

  document.body.appendChild(overlay);
  activeModal = overlay;

  // Prevent body scroll
  document.body.style.overflow = 'hidden';

  // Trigger animation
  requestAnimationFrame(() => {
    overlay.classList.add('active');
  });

  // Close handlers
  const closeBtn = overlay.querySelector('.modal-close-btn');
  if (closeBtn) {
    closeBtn.addEventListener('click', () => closeModal(onClose));
  }

  // Click outside to close
  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) {
      closeModal(onClose);
    }
  });

  // Escape key to close
  const keyHandler = (e) => {
    if (e.key === 'Escape') {
      closeModal(onClose);
      document.removeEventListener('keydown', keyHandler);
    }
    // Trap focus
    if (e.key === 'Tab') {
      const focusable = overlay.querySelectorAll(
        'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
      );
      if (focusable.length === 0) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    }
  };
  document.addEventListener('keydown', keyHandler);

  // Focus first focusable element
  requestAnimationFrame(() => {
    const firstFocusable = overlay.querySelector(
      'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
    );
    if (firstFocusable) firstFocusable.focus();
  });
}

/**
 * Close the currently active modal.
 * @param {Function} [callback]
 */
export function closeModal(callback) {
  if (!activeModal) return;

  activeModal.classList.remove('active');
  document.body.style.overflow = '';

  setTimeout(() => {
    if (activeModal && activeModal.parentNode) {
      activeModal.parentNode.removeChild(activeModal);
    }
    activeModal = null;

    // Restore focus
    if (previousFocus) {
      previousFocus.focus();
      previousFocus = null;
    }

    if (callback) callback();
  }, 300);
}

/**
 * Get the currently active modal element.
 * @returns {HTMLElement|null}
 */
export function getActiveModal() {
  return activeModal;
}

/**
 * Load modal data from JSON and set up data-attribute triggers.
 * @param {string} dataKey - Dataset key (default: 'modal')
 */
export async function initModals(dataKey = 'modal') {
  const modalData = await loadData(dataKey);
  if (!modalData || typeof modalData !== 'object') return;

  // Set up click handlers for data-modal attributes
  document.querySelectorAll('[data-modal]').forEach(trigger => {
    const key = trigger.getAttribute('data-modal');
    trigger.addEventListener('click', (e) => {
      e.preventDefault();
      const content = modalData[key];
      if (!content) {
        console.warn(`[Modal] No content found for key: "${key}"`);
        return;
      }
      openModal({
        title: content.title || key,
        bodyHTML: content.content || content.description || '',
        footerHTML: content.link
          ? `<a href="${content.link}" class="overlay-btn overlay-btn-primary" target="_blank" rel="noopener noreferrer">Read More</a>
             <button class="overlay-btn overlay-btn-secondary" data-close-modal>Close</button>`
          : `<button class="overlay-btn overlay-btn-secondary" data-close-modal>Close</button>`,
      });
    });
  });

  // Handle close buttons inside modals (event delegation)
  document.addEventListener('click', (e) => {
    const closeBtn = e.target.closest('[data-close-modal]');
    if (closeBtn) {
      closeModal();
    }
  });
}

/**
 * Escape HTML special characters.
 * @param {string} str
 * @returns {string}
 */
function escapeHTML(str) {
  if (!str) return '';
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}
