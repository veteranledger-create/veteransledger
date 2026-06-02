/**
 * ARTICLES PAGE – ENTRY MODULE
 * Historical Analysis Articles
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

/**
 * Render the articles page.
 */
async function renderArticlesPage() {
  const data = await loadData('topics');
  const grid = getEl('#articles-grid');

  if (!grid) {
    console.warn('[Articles] #articles-grid not found on page');
    return;
  }

  clearChildren(grid);

  if (!data || data.length === 0) {
    grid.innerHTML = '<div class="integrity-card" style="text-align:center;padding:48px;"><p>No articles loaded.</p></div>';
    return;
  }

  data.forEach((topic, index) => {
    const card = createArticleCard(topic, index);
    grid.appendChild(card);
  });
}

/**
 * Create an article card.
 * @param {Object} topic - Topic/article data
 * @param {number} index
 * @returns {HTMLElement}
 */
function createArticleCard(topic, index) {
  const card = createElement('div', {
    className: 'archival-card card-stagger',
    dataset: { id: topic.id },
  });

  const badge = createElement('span', { className: 'card-category' }, 'ARTICLE');
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
    onClick: () => openArticleModal(topic),
  }, 'READ ARTICLE');

  card.appendChild(btn);

  return card;
}

/**
 * Open article detail modal.
 * @param {Object} topic
 */
function openArticleModal(topic) {
  let bodyHTML = '';

  if (topic.description) {
    bodyHTML += `<p>${escapeHTML(topic.description)}</p>`;
  }

  if (topic.longContent) {
    bodyHTML += `<div style="margin-top:20px;padding-top:20px;border-top:1px dashed var(--doc-border);">${escapeHTML(topic.longContent)}</div>`;
  }

  if (!bodyHTML) {
    bodyHTML = '<p>Content not available.</p>';
  }

  const metaHTML = topic.year ? `
    <p style="font-size:0.85rem;color:var(--doc-text-muted);margin-bottom:16px;">
      ${escapeHTML(topic.year)}
    </p>
  ` : '';

  openModal({
    title: topic.title || 'Article',
    bodyHTML: metaHTML + bodyHTML,
  });
}

/**
 * Initialize articles page.
 */
document.addEventListener('DOMContentLoaded', () => {
  initTheme();
  buildNav();
  buildFooter();
  initNavigation();
  initReturnToTop();
  initModals();

  renderArticlesPage();

  console.log('[Articles] Page initialized.');
});
