/**
 * VeteransLedger · Maps listing page
 * Loads maps/index.json and renders a card grid.
 */

const PLACEHOLDER = "/public/images/covers/placeholder-cards.webp";

async function loadIndex() {
  try {
    const res = await fetch("/public/data/maps/index.json");
    if (!res.ok) return [];
    const data = await res.json();
    return Array.isArray(data.records) ? data.records : [];
  } catch { return []; }
}

function renderCard(r) {
  const img = r.image || PLACEHOLDER;
  const meta = [r.theater?.replace(/-/g, " "), r.year].filter(Boolean).join(" · ");
  return `
    <a href="/maps/${r.id}" class="archive-card">
      <div class="archive-card__image-wrap">
        <img class="archive-card__image" src="${img}" alt="${r.title || ""}" loading="lazy"
          onerror="this.onerror=null;this.src='${PLACEHOLDER}'">
      </div>
      <div class="archive-card__content">
        ${meta ? `<div class="archive-card__meta">${meta}</div>` : ""}
        <h3 class="archive-card__title">${r.title || "Untitled"}</h3>
      </div>
    </a>`;
}

async function init() {
  const loaderEl = document.getElementById("maps-loader");
  const gridEl   = document.getElementById("maps-grid");
  const emptyEl  = document.getElementById("maps-empty");

  const records = await loadIndex();

  loaderEl?.remove();

  if (!records.length) {
    if (emptyEl) emptyEl.hidden = false;
    return;
  }

  if (gridEl) {
    gridEl.innerHTML = records.map(renderCard).join("");
    gridEl.hidden = false;
  }
}

init();
