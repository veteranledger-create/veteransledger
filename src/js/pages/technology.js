/**
 * TECHNOLOGY PAGE – ENTRY MODULE
 * Weapons & Equipment Archive
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
 * Render the technology page.
 */
async function renderTechnologyPage() {
  const data = await loadData('weapons');
  const grid = getEl('#weapons-grid');

  if (!grid) {
    // Fallback target IDs
    const altGrid = getEl('#technology-grid');
    if (!altGrid) {
      console.warn('[Technology] No grid container found on page');
      return;
    }
    renderCards(data, altGrid);
    return;
  }

  renderCards(data, grid);
}

/**
 * Render weapon cards into a grid.
 * @param {Array} data - Weapons data
 * @param {HTMLElement} grid - Grid container
 */
function renderCards(data, grid) {
  clearChildren(grid);

  if (!data || data.length === 0) {
    grid.innerHTML = '<div class="integrity-card" style="text-align:center;padding:48px;"><p>No technology data loaded.</p></div>';
    return;
  }

  data.forEach((weapon, index) => {
    const card = createWeaponCard(weapon, index);
    grid.appendChild(card);
  });
}

/**
 * Create a weapon/technology card.
 * @param {Object} weapon - Weapon data
 * @param {number} index
 * @returns {HTMLElement}
 */
function createWeaponCard(weapon, index) {
  const card = createElement('div', {
    className: 'archival-card card-stagger',
    dataset: { id: weapon.id },
  });

  const badge = createElement('span', { className: 'card-category' }, 'WEAPON');
  card.appendChild(badge);

  const titleEl = createElement('h3', { className: 'card-title' }, weapon.name || 'Unknown Weapon');
  card.appendChild(titleEl);

  if (weapon.year) {
    const yearEl = createElement('div', {
      style: {
        fontSize: '0.85rem',
        color: 'var(--doc-accent)',
        fontFamily: 'var(--font-typewriter)',
        marginBottom: '14px',
        fontWeight: '600',
        letterSpacing: '1px',
      },
    }, weapon.year);
    card.appendChild(yearEl);
  }

  if (weapon.description) {
    const descEl = createElement('div', {
      className: 'card-excerpt',
    },
      weapon.description.length > 200
        ? weapon.description.substring(0, 200) + '…'
        : weapon.description
    );
    card.appendChild(descEl);
  }

  const btn = createElement('button', {
    className: 'card-button',
    onClick: () => openWeaponModal(weapon),
  }, 'READ DETAILS');

  card.appendChild(btn);

  return card;
}

/**
 * Open modal with full weapon details.
 * @param {Object} weapon
 */
function openWeaponModal(weapon) {
  let bodyHTML = '';

  if (weapon.description) {
    bodyHTML += `<p>${escapeHTML(weapon.description)}</p>`;
  }

  if (weapon.longContent) {
    bodyHTML += `<div style="margin-top:20px;padding-top:20px;border-top:1px dashed var(--doc-border);">${escapeHTML(weapon.longContent)}</div>`;
  }

  if (!bodyHTML) {
    bodyHTML = '<p>Details not available.</p>';
  }

  const metaHTML = weapon.year ? `
    <p style="font-size:0.85rem;color:var(--doc-text-muted);margin-bottom:16px;letter-spacing:1px;">
      Year: ${escapeHTML(weapon.year)}
    </p>
  ` : '';

  openModal({
    title: weapon.name || 'Weapon Details',
    bodyHTML: metaHTML + bodyHTML,
  });
}

/**
 * Initialize technology page.
 */
document.addEventListener('DOMContentLoaded', () => {
  initTheme();
  buildNav();
  buildFooter();
  initNavigation();
  initReturnToTop();
  initModals();

  renderTechnologyPage();

  console.log('[Technology] Page initialized.');
});
