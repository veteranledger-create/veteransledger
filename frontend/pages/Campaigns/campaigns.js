/**
 * VeteransLedger · Campaigns page
 * Theater-tab switching with pagination (10 per page).
 */

import { createPaginator } from "/pages/shared/paginator.js";

const THEATERS = [
  { id: "eastern-front", label: "Eastern Front",  path: "eastern-front" },
  { id: "western-front", label: "Western Front",  path: "western-front" },
  { id: "africa",        label: "North Africa",   path: "africa" },
  { id: "italy",         label: "Italy",          path: "italy" },
  { id: "atlantic",      label: "Atlantic",       path: "atlantic" },
];

const FILE_MAP = {
  "eastern-front": ["barbarossa.json","blue.json","caucasus.json","kharkov.json",
                    "kiev.json","leningrad.json","moscow.json","stalingrad.json"],
  "western-front": ["britain.json","bulge.json","bzura.json","dieppe.json","dunkirk.json",
                    "france.json","market-garden.json","normandy.json","norway.json",
                    "poland.json","warsaw.json"],
  africa:          ["alamein-1.json","alamein-2.json","gazala.json","sonnenblume.json","tobruk.json"],
  italy:           ["cassino.json","crete.json","gothic-line.json","sicily.json","taranto.json"],
  atlantic:        ["altmark.json","atlantic.json","convoy-war.json","rheinubung.json",
                    "river-plate.json","uboat-campaing.json"],
};

const PAGE_SIZE   = 10;
const PLACEHOLDER = "/public/images/covers/placeholder-cards.webp";

let activeTheater = "eastern-front";
const cache       = {};
let paginator     = null;

const grid    = document.getElementById("campaigns-grid");
const pagerEl = (() => {
  const el = document.createElement("div");
  el.className = "pagination";
  grid?.parentNode?.insertBefore(el, grid.nextSibling);
  return el;
})();

document.getElementById("theater-nav")?.addEventListener("click", (e) => {
  const btn = e.target.closest(".nation-tab");
  if (!btn) return;
  const theater = btn.dataset.theater;
  if (!theater) return;
  document.querySelectorAll(".nation-tab")
    .forEach((b) => b.classList.toggle("is-active", b === btn));
  switchTheater(theater);
});

async function switchTheater(theaterId) {
  activeTheater = theaterId;
  if (!grid) return;

  if (!cache[theaterId]) {
    grid.innerHTML = `<div class="loader"><span class="loader__dot"></span><span class="loader__dot"></span><span class="loader__dot"></span></div>`;
    pagerEl.innerHTML = "";
    cache[theaterId] = await loadTheaterData(theaterId);
  }

  const theater = THEATERS.find((t) => t.id === theaterId);
  const sectionLabel = document.querySelector(".section-label");
  if (sectionLabel) sectionLabel.textContent = theater?.label || theaterId;

  paginator = createPaginator({
    items:       cache[theaterId],
    pageSize:    PAGE_SIZE,
    renderFn:    (slice) => renderCampaigns(grid, slice),
    pagerEl,
    scrollTarget: grid,
  });
}

async function loadTheaterData(theaterId) {
  const files = FILE_MAP[theaterId] || [];
  const results = await Promise.allSettled(
    files.map((file) =>
      fetch(`/public/data/campaigns/${theaterId}/${file}`).then((r) => r.ok ? r.json() : null),
    ),
  );
  return results.filter((r) => r.status === "fulfilled" && r.value).map((r) => r.value);
}

function renderCampaigns(container, campaigns) {
  if (!campaigns.length) {
    container.innerHTML = `<div class="empty-state">
      <div class="empty-state__icon" aria-hidden="true">✛</div>
      <p class="empty-state__title">Records pending</p>
      <p class="empty-state__text">Content for this theater is being compiled.</p>
    </div>`;
    return;
  }

  container.innerHTML = "";
  campaigns.forEach((c) => {
    const card = document.createElement("a");
    card.className = "record-card";
    card.href = `/campaigns/${c.id}`;

    const imgSrc  = c.image || PLACEHOLDER;
    const dateStr = c.startDate || c.date || c.year || "";
    const theater = c.theater || "";

    // Build image via DOM so error handler attaches before src fires
    const imageDiv = document.createElement("div");
    imageDiv.className = "record-card__image";
    const img = document.createElement("img");
    img.alt = c.title || "";
    img.loading = "lazy";
    img.addEventListener("error", () => { img.src = PLACEHOLDER; }, { once: true });
    img.addEventListener("load", () => { if (!img.naturalWidth) img.src = PLACEHOLDER; }, { once: true });
    img.src = imgSrc;
    imageDiv.appendChild(img);

    const body = document.createElement("div");
    body.className = "record-card__body";
    body.innerHTML = `
      <div class="record-card__header">
        ${theater ? `<span class="record-card__badge">${theater}</span>` : ""}
        ${dateStr ? `<span class="record-card__year">${dateStr}</span>` : ""}
      </div>
      <h3 class="record-card__title">${c.title || "Untitled"}</h3>
      ${c.summary ? `<p class="record-card__summary">${c.summary}</p>` : ""}`;

    const footer = document.createElement("div");
    footer.className = "record-card__footer";
    footer.innerHTML = `<span class="record-card__read-more">Read more →</span>`;

    card.appendChild(imageDiv);
    card.appendChild(body);
    card.appendChild(footer);
    container.appendChild(card);
  });
}

// Boot
(function initFromHash() {
  const hash  = location.hash.replace("#", "");
  const match = THEATERS.find((t) => t.id === hash);
  if (match) {
    activeTheater = match.id;
    document.querySelectorAll(".nation-tab")
      .forEach((b) => b.classList.toggle("is-active", b.dataset.theater === match.id));
  } else {
    document.querySelector(`[data-theater="${activeTheater}"]`)?.classList.add("is-active");
  }
  switchTheater(activeTheater);
})();
