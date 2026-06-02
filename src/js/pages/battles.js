/**
 * BATTLES PAGE – ENTRY MODULE
 * Major WWII Engagements Archive
 *
 * Loads battles data, renders cards, and handles detail view.
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
import { renderAttribution } from '@core/image-attribution';
import { createElement, clearChildren, getEl, escapeHTML } from '@utils/dom';

/**
 * Render the battles page.
 */
async function renderBattlesPage() {
  const data = await loadData('battles');
  const grid = getEl('#battles-grid');

  if (!grid) {
    console.warn('[Battles] #battles-grid not found on page');
    return;
  }

  clearChildren(grid);

  if (!data || data.length === 0) {
    grid.innerHTML = '<div class="integrity-card" style="text-align:center;padding:48px;"><p>No battle data loaded.</p></div>';
    return;
  }

  data.forEach((battle, index) => {
    const card = createBattleCard(battle, index);
    grid.appendChild(card);
  });
}

/**
 * Create a battle card element.
 * @param {Object} battle - Battle data
 * @param {number} index - Index for stagger animation
 * @returns {HTMLElement}
 */
function createBattleCard(battle, index) {
  const card = createElement('div', {
    className: 'archival-card card-stagger',
    dataset: { id: battle.id },
  });

  // Category badge
  const badge = createElement('span', { className: 'card-category' }, 'BATTLE');
  card.appendChild(badge);

  // Title
  const titleEl = createElement('h3', { className: 'card-title' }, battle.title || 'Unknown Battle');
  card.appendChild(titleEl);

  // Year
  if (battle.year) {
    const yearEl = createElement('div', {
      style: {
        fontSize: '0.85rem',
        color: 'var(--doc-accent)',
        fontFamily: 'var(--font-typewriter)',
        marginBottom: '14px',
        fontWeight: '600',
        letterSpacing: '1px',
      },
    }, battle.year);
    card.appendChild(yearEl);
  }

  // Description excerpt
  if (battle.description) {
    const descEl = createElement('div', {
      className: 'card-excerpt',
    },
      battle.description.length > 200
        ? battle.description.substring(0, 200) + '…'
        : battle.description
    );
    card.appendChild(descEl);
  }

  // Read more button
  const btn = createElement('button', {
    className: 'card-button',
    onClick: () => openBattleModal(battle),
  }, 'READ DETAILS');

  card.appendChild(btn);

  return card;
}

/**
 * Open a modal with full battle details.
 * @param {Object} battle - Battle data
 */
function openBattleModal(battle) {
  let bodyHTML = '';

  if (battle.description) {
    bodyHTML += `<p>${escapeHTML(battle.description)}</p>`;
  }

  if (battle.longContent) {
    bodyHTML += `<div style="margin-top:20px;padding-top:20px;border-top:1px dashed var(--doc-border);">${escapeHTML(battle.longContent)}</div>`;
  }

  if (!bodyHTML) {
    bodyHTML = '<p>Details not available.</p>';
  }

  const metaHTML = battle.year ? `
    <p style="font-size:0.85rem;color:var(--doc-text-muted);margin-bottom:16px;letter-spacing:1px;">
      Year: ${escapeHTML(battle.year)}
    </p>
  ` : '';

  openModal({
    title: battle.title || 'Battle Details',
    bodyHTML: metaHTML + bodyHTML,
  });
}

/**
 * Initialize battles page.
 */
document.addEventListener('DOMContentLoaded', () => {
  initTheme();
  buildNav();
  buildFooter();
  initNavigation();
  initReturnToTop();
  initModals();

  renderBattlesPage();

  console.log('[Battles] Page initialized.');
});
