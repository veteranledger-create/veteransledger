/**
 * LETTERS PAGE – ENTRY MODULE
 * Historical Correspondence Archive
 *
 * Usage:
 *   Imported as entry point in Vite config.
 */

import '@css/main.css';

import { initTheme } from '@core/theme-manager';
import { initNavigation, buildNav } from '@components/navigation';
import { buildFooter } from '@components/footer';
import { initReturnToTop } from '@components/return-to-top';
import { initModals, openModal } from '@components/modal';
import { loadData } from '@core/data-loader';
import { createElement, clearChildren, getEl, escapeHTML } from '@utils/dom';
import { nl2br } from '@utils/format';

/**
 * Render the letters page.
 */
async function renderLettersPage() {
  const data = await loadData('letters');
  const grid = getEl('#letters-grid');

  if (!grid) {
    console.warn('[Letters] #letters-grid not found on page');
    return;
  }

  clearChildren(grid);

  if (!data || data.length === 0) {
    grid.innerHTML = '<div class="integrity-card" style="text-align:center;padding:48px;"><p>No letters loaded.</p></div>';
    return;
  }

  data.forEach((letter, index) => {
    const card = createLetterCard(letter, index);
    grid.appendChild(card);
  });
}

/**
 * Create a letter card.
 * @param {Object} letter - Letter data
 * @param {number} index
 * @returns {HTMLElement}
 */
function createLetterCard(letter, index) {
  const card = createElement('div', {
    className: 'archival-card card-stagger',
    dataset: { id: letter.id },
  });

  const badge = createElement('span', { className: 'card-category' }, 'LETTER');
  card.appendChild(badge);

  // Author
  const authorText = letter.author || 'Unknown Author';
  const titleEl = createElement('h3', { className: 'card-title' }, authorText);
  card.appendChild(titleEl);

  // Meta: year, recipient
  let metaParts = [];
  if (letter.year) metaParts.push(letter.year);
  if (letter.recipient) metaParts.push(`To: ${letter.recipient}`);
  if (metaParts.length > 0) {
    const metaEl = createElement('div', {
      style: {
        fontSize: '0.85rem',
        color: 'var(--doc-accent)',
        fontFamily: 'var(--font-typewriter)',
        marginBottom: '14px',
        fontWeight: '600',
        letterSpacing: '1px',
      },
    }, metaParts.join(' · '));
    card.appendChild(metaEl);
  }

  // Description excerpt
  if (letter.description) {
    const descEl = createElement('div', {
      className: 'card-excerpt',
    },
      letter.description.length > 200
        ? letter.description.substring(0, 200) + '…'
        : letter.description
    );
    card.appendChild(descEl);
  }

  const btn = createElement('button', {
    className: 'card-button',
    onClick: () => openLetterModal(letter),
  }, 'READ LETTER');

  card.appendChild(btn);

  return card;
}

/**
 * Open letter detail modal.
 * @param {Object} letter
 */
function openLetterModal(letter) {
  let bodyHTML = '';

  // Full content
  const content = letter.longContent || letter.content || letter.description || '';
  if (content) {
    bodyHTML += `<div style="font-style:italic;">${nl2br(escapeHTML(content))}</div>`;
  }

  if (!bodyHTML) {
    bodyHTML = '<p>Letter content not available.</p>';
  }

  const metaParts = [];
  if (letter.author) metaParts.push(`Author: ${escapeHTML(letter.author)}`);
  if (letter.year) metaParts.push(`Year: ${escapeHTML(letter.year)}`);
  if (letter.recipient) metaParts.push(`Recipient: ${escapeHTML(letter.recipient)}`);

  const metaHTML = metaParts.length > 0 ? `
    <p style="font-size:0.85rem;color:var(--doc-text-muted);margin-bottom:16px;">
      ${metaParts.join(' · ')}
    </p>
  ` : '';

  openModal({
    title: letter.author ? `Letter: ${escapeHTML(letter.author)}` : 'Historical Letter',
    bodyHTML: metaHTML + bodyHTML,
  });
}

/**
 * Initialize letters page.
 */
document.addEventListener('DOMContentLoaded', () => {
  initTheme();
  buildNav();
  buildFooter();
  initNavigation();
  initReturnToTop();
  initModals();

  renderLettersPage();

  console.log('[Letters] Page initialized.');
});
