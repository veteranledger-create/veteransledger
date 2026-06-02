/**
 * VETERANS PAGE – ENTRY MODULE
 * German Military Commanders Archive
 *
 * Loads veteran profiles, renders cards, and handles filtering/search.
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
import { branchLabel, branchClass, formatLifespan } from '@utils/format';

/**
 * Render the veterans page.
 */
async function renderVeteransPage() {
  const data = await loadData('veterans');
  const grid = getEl('#veterans-grid');

  if (!grid) {
    console.warn('[Veterans] #veterans-grid not found on page');
    return;
  }

  clearChildren(grid);

  if (!data || data.length === 0) {
    grid.innerHTML = '<div class="integrity-card" style="text-align:center;padding:48px;"><p>No veteran profiles loaded.</p></div>';
    return;
  }

  data.forEach((veteran, index) => {
    const card = createVeteranCard(veteran, index);
    grid.appendChild(card);
  });
}

/**
 * Create a veteran profile card element.
 * @param {Object} vet - Veteran data
 * @param {number} index - Index for stagger animation
 * @returns {HTMLElement}
 */
function createVeteranCard(vet, index) {
  const card = createElement('div', {
    className: 'archival-card card-stagger',
    dataset: { id: vet.id },
  });

  // Branch badge
  const badge = createElement('span', { className: 'card-category' }, branchLabel(vet.branch));
  card.appendChild(badge);

  // Name
  const nameEl = createElement('h3', { className: 'card-title' }, vet.name || 'Unknown');
  card.appendChild(nameEl);

  // Rank and lifespan
  const meta = createElement('div', {
    style: {
      fontSize: '0.8rem',
      color: 'var(--doc-text-muted)',
      marginBottom: '12px',
      fontFamily: 'var(--font-typewriter)',
    },
  });

  if (vet.rank) {
    meta.appendChild(document.createTextNode(vet.rank));
  }
  if (vet.life) {
    meta.appendChild(document.createTextNode(` · ${vet.life}`));
  }
  card.appendChild(meta);

  // Nickname
  if (vet.nickname) {
    const nick = createElement('div', {
      style: {
        fontSize: '0.85rem',
        fontStyle: 'italic',
        color: 'var(--doc-text-secondary)',
        marginBottom: '12px',
      },
    }, `"${vet.nickname}"`);
    card.appendChild(nick);
  }

  // Commands
  if (vet.commands) {
    const cmds = createElement('div', {
      style: {
        fontSize: '0.75rem',
        color: 'var(--doc-text-muted)',
        marginBottom: '12px',
        fontFamily: 'var(--font-typewriter)',
      },
    }, `Commands: ${vet.commands}`);
    card.appendChild(cmds);
  }

  // Excerpt from fullBio
  const bio = vet.fullBio;
  let excerpt = '';
  if (bio) {
    excerpt = bio.earlyLife || bio.militaryCareer || '';
  }
  if (excerpt) {
    const excerptEl = createElement('div', {
      className: 'card-excerpt',
    },
      excerpt.length > 200 ? excerpt.substring(0, 200) + '…' : excerpt
    );
    card.appendChild(excerptEl);
  }

  // Read more button
  const btn = createElement('button', {
    className: 'card-button',
    onClick: () => openVeteranModal(vet),
  }, 'READ BIOGRAPHY');

  card.appendChild(btn);

  return card;
}

/**
 * Open a modal with full veteran biography.
 * @param {Object} vet - Veteran data
 */
function openVeteranModal(vet) {
  const bio = vet.fullBio || {};

  let bodyHTML = '';

  if (bio.earlyLife) {
    bodyHTML += `<h3 style="margin:20px 0 10px;text-transform:uppercase;letter-spacing:1px;font-size:1rem;">Early Life</h3><p>${escapeHTML(bio.earlyLife)}</p>`;
  }

  if (bio.militaryCareer) {
    bodyHTML += `<h3 style="margin:20px 0 10px;text-transform:uppercase;letter-spacing:1px;font-size:1rem;">Military Career</h3><p>${escapeHTML(bio.militaryCareer)}</p>`;
  }

  if (bio.achievements) {
    bodyHTML += `<h3 style="margin:20px 0 10px;text-transform:uppercase;letter-spacing:1px;font-size:1rem;">Achievements</h3><p>${escapeHTML(bio.achievements)}</p>`;
  }

  if (bio.laterLife) {
    bodyHTML += `<h3 style="margin:20px 0 10px;text-transform:uppercase;letter-spacing:1px;font-size:1rem;">Later Life</h3><p>${escapeHTML(bio.laterLife)}</p>`;
  }

  if (bodyHTML === '') {
    bodyHTML = '<p>Full biography not available.</p>';
  }

  // Header metadata
  const metaHTML = `
    <p style="font-size:0.85rem;color:var(--doc-text-muted);margin-bottom:8px;">
      ${escapeHTML(vet.rank || '')} · ${escapeHTML(vet.life || '')}
      ${vet.nickname ? ` · "${escapeHTML(vet.nickname)}"` : ''}
    </p>
    ${vet.commands ? `<p style="font-size:0.85rem;color:var(--doc-text-muted);margin-bottom:16px;">Commands: ${escapeHTML(vet.commands)}</p>` : ''}
  `;

  openModal({
    title: vet.name || 'Veteran Profile',
    bodyHTML: metaHTML + bodyHTML,
  });
}

/**
 * Initialize veterans page.
 */
document.addEventListener('DOMContentLoaded', () => {
  initTheme();
  buildNav();
  buildFooter();
  initNavigation();
  initReturnToTop();
  initModals();

  renderVeteransPage();

  console.log('[Veterans] Page initialized.');
});
