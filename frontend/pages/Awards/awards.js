/**
 * VeteransLedger · Awards & Decorations listing page
 * Loads awards/index.json and renders a card grid.
 */

const PLACEHOLDER = "/public/images/covers/placeholder-cards.webp";

async function loadIndex() {
  try {
    const res = await fetch("/public/data/awards/index.json");
    if (!res.ok) return [];
    const data = await res.json();
    return Array.isArray(data.records) ? data.records : [];
  } catch { return []; }
}

function renderCard(r) {
  const img = r.image || PLACEHOLDER;
  return `
    <a href="/awards/${r.id}" class="archive-card">
      <div class="archive-card__image-wrap">
        <img class="archive-card__image" src="${img}" alt="${r.title || ""}" loading="lazy"
          onerror="this.onerror=null;this.src='${PLACEHOLDER}'">
      </div>
      <div class="archive-card__content">
        ${r.nation ? `<div class="archive-card__meta">${r.nation}</div>` : ""}
        <h3 class="archive-card__title">${r.title || "Untitled"}</h3>
        ${r.summary ? `<p class="archive-card__excerpt">${r.summary}</p>` : ""}
      </div>
    </a>`;
}

async function init() {
  const loaderEl = document.getElementById("awards-loader");
  const gridEl   = document.getElementById("awards-grid");
  const emptyEl  = document.getElementById("awards-empty");

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
