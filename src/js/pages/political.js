/**
 * POLITICAL PAGE – ENTRY MODULE
 * Leadership & Regimes Archive
 *
 * Usage:
 *   Imported as entry point in Vite config.
 */

import '@css/main.css';

import { initTheme } from '@core/theme-manager';
import { initNavigation, buildNav } from '@components/navigation';
import { buildFooter } from '@components/footer';
import { initReturnToTop } from '@components/return-to-top';
import { initModals } from '@components/modal';
import { loadData } from '@core/data-loader';
import { createElement, clearChildren, getEl, escapeHTML } from '@utils/dom';

/**
 * Render political page.
 */
async function renderPoliticalPage() {
  const data = await loadData('topics');
  const grid = getEl('#political-grid');

  if (!grid) {
    console.warn('[Political] #political-grid not found on page');
    return;
  }

  clearChildren(grid);

  if (!data || data.length === 0) {
    grid.innerHTML = '<div class="integrity-card" style="text-align:center;padding:48px;"><p>No political data loaded.</p></div>';
    return;
  }

  // Filter for political-related topics, or show all
  const politicalData = data.filter(t =>
    (t.title || '').toLowerCase().includes('political') ||
    (t.category || '').toLowerCase().includes('political') ||
    (t.tags || []).some(tag => tag.toLowerCase().includes('political'))
  );

  const items = politicalData.length > 0 ? politicalData : data;

  items.forEach((topic, index) => {
    const card = createPoliticalCard(topic, index);
    grid.appendChild(card);
  });
}

/**
 * Create a political topic card.
 * @param {Object} topic
 * @param {number} index
 * @returns {HTMLElement}
 */
function createPoliticalCard(topic, index) {
  const card = createElement('div', {
    className: 'archival-card card-stagger',
    dataset: { id: topic.id },
  });

  const badge = createElement('span', { className: 'card-category' }, 'POLITICAL');
  card.appendChild(badge);

  const titleEl = createElement('h3', { className: 'card-title' }, topic.title || 'Untitled');
  card.appendChild(titleEl);

  if (topic.year) {
    const yearEl = createElement('div', {
      style: {
        fontSize: '0.85rem',
        color: 'var(--doc-accent)',
        fontFamily: 'var(--font-typewriter)',
        marginBottom: '14px',
        fontWeight: '600',
      },
    }, topic.year);
    card.appendChild(yearEl);
  }

  if (topic.description) {
    const descEl = createElement('div', {
      className: 'card-excerpt',
    },
      topic.description.length > 200
        ? topic.description.substring(0, 200) + '…'
        : topic.description
    );
    card.appendChild(descEl);
  }

  const btn = createElement('button', {
    className: 'card-button',
    onClick: () => {
      const bodyHTML = topic.longContent
        ? `<p>${escapeHTML(topic.description || '')}</p><div style="margin-top:20px;padding-top:20px;border-top:1px dashed var(--doc-border);">${escapeHTML(topic.longContent)}</div>`
        : `<p>${escapeHTML(topic.description || 'Content not available.')}</p>`;
      import('@components/modal').then(({ openModal }) => {
        openModal({ title: topic.title || 'Political Topic', bodyHTML });
      });
    },
  }, 'READ MORE');

  card.appendChild(btn);

  return card;
}

/**
 * Initialize political page.
 */
document.addEventListener('DOMContentLoaded', () => {
  initTheme();
  buildNav();
  buildFooter();
  initNavigation();
  initReturnToTop();
  initModals();

  renderPoliticalPage();

  console.log('[Political] Page initialized.');
});
