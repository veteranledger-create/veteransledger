/**
 * VeteransLedger · Political Documents listing page
 * Loads political-docs/index.json and renders a card list ordered by date.
 */

import { applyRecordTranslation } from "/pages/shared/translation-loader.js";
import { onLocaleChange } from "/pages/shared/i18n.js";

async function loadIndex() {
  try {
    const res = await fetch("/public/data/political-docs/index.json");
    if (!res.ok) return [];
    const data = await res.json();
    return Array.isArray(data.records) ? data.records : [];
  } catch { return []; }
}

function formatDate(dateStr) {
  if (!dateStr) return "";
  const d = new Date(dateStr);
  return isNaN(d.getTime()) ? dateStr : d.toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" });
}

function renderCard(r) {
  const dateFmt = formatDate(r.date);
  return `
    <a href="/political-documents/${r.id}" class="archive-card archive-card--list">
      <div class="archive-card__content">
        ${dateFmt ? `<div class="archive-card__meta">${dateFmt}</div>` : ""}
        <h3 class="archive-card__title">${r.title || "Untitled"}</h3>
        ${r.summary ? `<p class="archive-card__excerpt">${r.summary}</p>` : ""}
      </div>
    </a>`;
}

function applyCardTranslations(gridEl, records) {
  const cards = gridEl.querySelectorAll(".archive-card");
  records.forEach((r, i) => {
    const id = r.recordId || r.id;
    if (!id || !cards[i]) return;
    applyRecordTranslation(cards[i], "record", id, {
      titleSelector: ".archive-card__title",
      summarySelector: ".archive-card__excerpt",
      noticeAnchor: ".archive-card__content",
    });
  });
}

async function init() {
  const loaderEl = document.getElementById("poldocs-loader");
  const gridEl   = document.getElementById("poldocs-grid");
  const emptyEl  = document.getElementById("poldocs-empty");

  const records = await loadIndex();

  loaderEl?.remove();

  if (!records.length) {
    if (emptyEl) emptyEl.hidden = false;
    return;
  }

  if (gridEl) {
    gridEl.innerHTML = records.map(renderCard).join("");
    gridEl.hidden = false;
    applyCardTranslations(gridEl, records);
    onLocaleChange(() => applyCardTranslations(gridEl, records));
  }
}

init();
