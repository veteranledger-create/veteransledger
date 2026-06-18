/**
 * VeteransLedger · Armaments page
 * Category tabs show/hide sections; nation filter + pagination (12 per page).
 */

import { createPaginator } from "/pages/shared/paginator.js";
import { cardImageCandidates, isAiGeneratedImageSrc } from "/pages/shared/media-blocks.js";

const CATEGORIES = [
  { id: "panzer",       path: "panzer" },
  { id: "aircraft",     path: "aircraft" },
  { id: "naval",        path: "naval" },
  { id: "missiles",     path: "missiles" },
  { id: "wunderwaffen", path: "wunderwaffen" },
  { id: "equipment",    path: "equipment" },
];

const NATION_FILES = ["germany", "italy", "japan"];
const FLAG_MAP = {
  germany: "/public/images/flags/germany.svg",
  italy:   "/public/images/flags/italy.svg",
  japan:   "/public/images/flags/japan.svg",
};

const PAGE_SIZE   = 12;
const PLACEHOLDER = "/public/images/covers/placeholder-cards.webp";

let activeCategory = "panzer";
let activeNation   = "all";
const cache        = {};
const paginators   = {};

async function init() {
  // Category tab clicks
  document.getElementById("category-tabs")?.addEventListener("click", (e) => {
    const btn = e.target.closest(".category-tab");
    if (!btn) return;
    const catId = btn.dataset.category;
    if (!catId) return;
    document.querySelectorAll(".category-tab")
      .forEach((b) => b.classList.toggle("is-active", b === btn));
    switchCategory(catId);
  });

  // Nation tab clicks
  document.getElementById("nation-tabs")?.addEventListener("click", (e) => {
    const btn = e.target.closest(".nation-tab");
    if (!btn) return;
    activeNation = btn.dataset.nation || "all";
    document.querySelectorAll(".nation-tab")
      .forEach((b) => b.classList.toggle("is-active", b === btn));
    rerenderCurrent();
  });

  // Handle hash on load (e.g. /armaments#aircraft)
  const hash  = location.hash.replace("#", "");
  const match = CATEGORIES.find((c) => c.id === hash);
  const startCat = match ? match.id : "panzer";

  if (match) {
    document.querySelector(`[data-category="${startCat}"]`)?.classList.add("is-active");
    document.querySelector(`[data-category="panzer"]`)?.classList.remove("is-active");
  }

  await loadCategory(startCat);
  switchCategory(startCat);
}

async function switchCategory(catId) {
  activeCategory = catId;

  // Show only this category section
  document.querySelectorAll(".armaments-category").forEach((sec) => {
    sec.hidden = sec.id !== catId;
  });

  const section = document.getElementById(catId);
  if (!section) return;

  // Ensure grid element exists
  let gridEl = section.querySelector(".armaments-grid") || section.querySelector(`#${catId}-grid`);
  if (!gridEl) {
    gridEl = document.createElement("div");
    gridEl.className = "armaments-grid";
    gridEl.id = `${catId}-grid`;
    section.appendChild(gridEl);
  }

  // Ensure pager element exists
  let pagerEl = section.querySelector(".pagination");
  if (!pagerEl) {
    pagerEl = document.createElement("div");
    pagerEl.className = "pagination";
    section.appendChild(pagerEl);
  }

  // Load data if not cached
  if (!cache[catId]) {
    gridEl.innerHTML = `<div class="loader"><span class="loader__dot"></span><span class="loader__dot"></span><span class="loader__dot"></span></div>`;
    pagerEl.innerHTML = "";
    await loadCategory(catId);
  }

  buildOrUpdatePaginator(catId, gridEl, pagerEl);
}

async function loadCategory(catId) {
  const cat = CATEGORIES.find((c) => c.id === catId);
  if (!cat) { cache[catId] = []; return; }

  const results = await Promise.allSettled(
    NATION_FILES.map((nation) =>
      fetch(`/public/data/armaments/${cat.path}/${nation}.json`)
        .then((r) => (r.ok ? r.json() : null))
        .then((data) => {
          if (!data) return { nation, items: [] };
          const items = Array.isArray(data) ? data : data?.armaments || data?.items || [];
          return { nation, items };
        }),
    ),
  );

  cache[catId] = results
    .filter((r) => r.status === "fulfilled")
    .flatMap(({ value: { nation, items } }) =>
      items.map((item) => ({ ...item, _nation: nation })),
    );
}

function getFiltered(catId) {
  const all = cache[catId] || [];
  if (activeNation === "all") return all;
  return all.filter((item) => item._nation === activeNation);
}

function buildOrUpdatePaginator(catId, gridEl, pagerEl) {
  const filtered = getFiltered(catId);

  if (paginators[catId]) {
    paginators[catId].setItems(filtered);
  } else {
    paginators[catId] = createPaginator({
      items:       filtered,
      pageSize:    PAGE_SIZE,
      renderFn:    (slice) => renderArmaments(gridEl, slice, catId),
      pagerEl,
      scrollTarget: gridEl,
    });
  }
}

function rerenderCurrent() {
  const section = document.getElementById(activeCategory);
  if (!section) return;
  const gridEl  = section.querySelector(".armaments-grid") || section.querySelector(`#${activeCategory}-grid`);
  const pagerEl = section.querySelector(".pagination");
  if (!gridEl || !pagerEl) return;
  buildOrUpdatePaginator(activeCategory, gridEl, pagerEl);
}

function renderArmaments(container, items, catId) {
  if (!container) return;

  if (!items.length) {
    container.innerHTML = `<div class="empty-state">
      <div class="empty-state__icon" aria-hidden="true">✛</div>
      <p class="empty-state__title">Records pending</p>
      <p class="empty-state__text">Content being compiled.</p>
    </div>`;
    return;
  }

  container.innerHTML = "";
  items.forEach((item) => {
    const name        = item.name || item.title || "Unknown";
    const nationKey   = item._nation || "";
    const nationLabel = item.nation || nationKey.replace(/\b\w/g, c => c.toUpperCase()) || "";
    const candidates  = cardImageCandidates(item, PLACEHOLDER);
    const flag        = FLAG_MAP[nationKey] || "";
    const type        = item.type || item.category || catId;

    const card = document.createElement("a");
    card.className = "armament-card";
    card.href = `/armaments/${item.id}`;

    // Build image with DOM method so error handler attaches before src fires.
    // On failure, advance to the next candidate instead of jumping straight
    // to the placeholder, so a broken `image` path still falls through to a
    // real dossier photo before giving up.
    const imageDiv = document.createElement("div");
    imageDiv.className = "armament-card__image";
    const badge = document.createElement("span");
    badge.className = "media-ai-badge";
    badge.textContent = "Digital Reconstruction";
    badge.hidden = true;
    const img = document.createElement("img");
    img.alt = name;
    let candidateIndex = 0;
    const updateBadge = () => {
      badge.hidden = !isAiGeneratedImageSrc(item, img.src.replace(location.origin, ""));
    };
    const tryNextCandidate = () => {
      candidateIndex++;
      if (candidateIndex < candidates.length) { img.src = candidates[candidateIndex]; updateBadge(); }
    };
    img.addEventListener("error", tryNextCandidate);
    img.addEventListener("load", () => { if (!img.naturalWidth) tryNextCandidate(); });
    img.src = candidates[0];
    updateBadge();
    imageDiv.appendChild(badge);
    imageDiv.appendChild(img);

    const body = document.createElement("div");
    body.className = "armament-card__body";
    body.innerHTML = `
      <p class="armament-card__category">${type}</p>
      <h3 class="armament-card__name">${name}</h3>
      <p class="armament-card__nation">
        ${flag ? `<img class="armament-card__flag" src="${flag}" alt="${nationLabel}">` : ""}
        ${nationLabel}
      </p>
      ${item.summary ? `<p class="armament-card__desc">${item.summary}</p>` : ""}`;

    card.appendChild(imageDiv);
    card.appendChild(body);
    container.appendChild(card);
  });
}

init();
