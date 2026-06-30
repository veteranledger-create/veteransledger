/**
 * VeteransLedger · Personnel page
 * Loads branch JSON files and renders person cards grouped by branch.
 * Branch definitions loaded from personnel/index.json — no hardcoded arrays.
 * Branch icons: SVG assets for military branches; country flags for foreign volunteers.
 * Pagination: 12 cards per page per branch.
 */

import { createPaginator } from "/pages/shared/paginator.js";
import { resolveRelatedUrl } from "/pages/shared/related-url-resolver.js";
import { applyRecordTranslation } from "/pages/shared/translation-loader.js";
import { onLocaleChange } from "/pages/shared/i18n.js";

let BRANCHES = [];

const BRANCH_SVG = {
  army:         "/public/images/icons/branches/iron-cross.svg",
  luftwaffe:    "/public/images/icons/branches/luftwaffe.svg",
  kriegsmarine: "/public/images/icons/branches/marine.svg",
  "waffen-ss":  "/public/images/icons/branches/ss.svg",
};

const FLAG_BY_NATION = {
  Japan:    "japan",    Italy:    "italy",   Finland:  "finland",
  Bulgaria: "bulgaria", Croatia:  "croatia", Hungary:  "hungary",
  Romania:  "romania",  Slovakia: "slovakia", Germany:  "germany",
};

const PAGE_SIZE  = 12;
const PLACEHOLDER = "/public/images/covers/placeholder-cards.webp";

let activeBranch = "all";

function branchIconHtml(branchId, person) {
  if (branchId === "foreign") {
    const nation  = person.nation || person.nationality || "";
    const flagKey = FLAG_BY_NATION[nation];
    const src     = flagKey
      ? `/public/images/flags/${flagKey}.svg`
      : "/public/images/icons/branches/iron-cross.svg";
    const cls     = flagKey ? "branch-icon--flag" : "branch-icon--svg";
    return `<img class="branch-icon ${cls}" src="${src}" alt="${nation}" loading="lazy">`;
  }
  const svgSrc = BRANCH_SVG[branchId];
  if (!svgSrc) return "";
  return `<img class="branch-icon branch-icon--svg" src="${svgSrc}" alt="${branchId}" loading="lazy">`;
}

async function loadManifest() {
  try {
    const res = await fetch("/public/data/personnel/index.json");
    const data = res.ok ? await res.json() : null;
    BRANCHES = (data?.branches ?? []).map((b) => ({
      id:   b.id,
      label: b.label,
      file: b.file.replace("/public/data/personnel/", ""),
    }));
  } catch (_) {}
  if (!BRANCHES.length) {
    BRANCHES = [
      { id: "army",         label: "Heer (Army)",        file: "army.json" },
      { id: "luftwaffe",    label: "Luftwaffe",           file: "luftwaffe.json" },
      { id: "kriegsmarine", label: "Kriegsmarine",        file: "kriegsmarine.json" },
      { id: "waffen-ss",    label: "Waffen-SS",           file: "waffen-ss.json" },
      { id: "foreign",      label: "Foreign Volunteers",  file: "foreign.json" },
    ];
  }
}

function renderBranchFilter() {
  const bar = document.querySelector(".filter-bar");
  if (!bar || !BRANCHES.length) return;
  bar.innerHTML =
    `<button type="button" class="filter-btn is-active" data-branch="all">All</button>` +
    BRANCHES.map((b) => `<button type="button" class="filter-btn" data-branch="${b.id}">${b.label}</button>`).join("");
}

async function init() {
  await loadManifest();
  renderBranchFilter();

  document.querySelector(".filter-bar")?.addEventListener("click", (e) => {
    const btn = e.target.closest(".filter-btn");
    if (!btn) return;
    activeBranch = btn.dataset.branch || "all";
    document.querySelectorAll(".filter-btn")
      .forEach((b) => b.classList.toggle("is-active", b === btn));
    toggleBranchVisibility();
  });

  await Promise.allSettled(BRANCHES.map((b) => loadBranch(b)));
  toggleBranchVisibility();
}

async function loadBranch({ id, label, file }) {
  const gridId = `${id.replace("-", "")}-grid`;
  const gridEl = document.getElementById(gridId) || document.getElementById(`${id}-grid`);
  const countEl = document.getElementById(`${id.replace("-", "")}-count`)
               || document.getElementById(`${id}-count`);

  if (!gridEl) return;

  // Pager element inserted after grid
  let pagerEl = document.getElementById(`${id}-pager`);
  if (!pagerEl) {
    pagerEl = document.createElement("div");
    pagerEl.id = `${id}-pager`;
    pagerEl.className = "pagination";
    gridEl.parentNode.insertBefore(pagerEl, gridEl.nextSibling);
  }

  try {
    const res  = await fetch(`/public/data/personnel/${file}`);
    const data = res.ok ? await res.json() : null;
    const people = Array.isArray(data) ? data : data?.personnel || data?.people || [];

    if (countEl) countEl.textContent = `${people.length} records`;

    createPaginator({
      items:       people,
      pageSize:    PAGE_SIZE,
      renderFn:    (slice) => renderPeople(gridEl, slice, id),
      pagerEl,
      scrollTarget: gridEl,
    });
  } catch (_) {
    gridEl.innerHTML = renderEmpty("Data pending compilation.");
  }
}

function renderPeople(container, people, branchId = "") {
  if (!people.length) {
    container.innerHTML = renderEmpty("No records available yet.");
    return;
  }

  container.innerHTML = "";
  people.forEach((p) => {
    const el = document.createElement("a");
    el.className = "person-card";
    el.href = resolveRelatedUrl("Personnel", p.id);
    if (branchId) el.dataset.branch = branchId;

    const imgSrc = p.portrait || p.image || p.photo || PLACEHOLDER;
    const rank   = p.rank || p.title || "";
    const name   = p.name || p.fullName || "Unknown";
    const meta   = [
      p.born && `b. ${p.born}`,
      p.died && `d. ${p.died}`,
      p.nation || p.nationality,
    ].filter(Boolean).join(" · ");

    // Build portrait img via DOM so error handler attaches before src fires
    const portraitDiv = document.createElement("div");
    portraitDiv.className = "person-card__portrait";
    const portrait = document.createElement("img");
    portrait.alt = name;
    portrait.loading = "lazy";
    portrait.addEventListener("error", () => { portrait.src = PLACEHOLDER; }, { once: true });
    portrait.addEventListener("load", () => { if (!portrait.naturalWidth) portrait.src = PLACEHOLDER; }, { once: true });
    portrait.src = imgSrc;
    portraitDiv.appendChild(portrait);

    const iconHtml = branchIconHtml(branchId, p);

    const body = document.createElement("div");
    body.className = "person-card__body";
    body.innerHTML = `
      <div class="person-card__header">
        <span class="person-card__rank">${rank}</span>
        ${iconHtml ? `<span class="person-card__branch-icon" aria-hidden="true">${iconHtml}</span>` : ""}
      </div>
      <h3 class="person-card__name">${name}</h3>
      ${meta ? `<p class="person-card__meta">${meta}</p>` : ""}
      ${p.summary ? `<p class="person-card__excerpt">${p.summary}</p>` : ""}`;

    el.appendChild(portraitDiv);
    el.appendChild(body);
    container.appendChild(el);

    const translateId = p.recordId || p.id;
    if (translateId) {
      el.dataset.translateId = translateId;
      applyRecordTranslation(el, "entity", translateId, {
        titleSelector: ".person-card__name",
        summarySelector: ".person-card__excerpt",
        noticeAnchor: ".person-card__body",
      });
    }
  });
}

onLocaleChange(() => {
  document.querySelectorAll(".person-card[data-translate-id]").forEach((card) => {
    applyRecordTranslation(card, "entity", card.dataset.translateId, {
      titleSelector: ".person-card__name",
      summarySelector: ".person-card__excerpt",
      noticeAnchor: ".person-card__body",
    });
  });
});

function toggleBranchVisibility() {
  BRANCHES.forEach(({ id }) => {
    const section = document.getElementById(id);
    if (!section) return;
    const gridId = `${id.replace("-", "")}-grid`;
    const grid = document.getElementById(gridId) || document.getElementById(`${id}-grid`);
    section.hidden = activeBranch !== "all" && activeBranch !== id;
    if (grid) grid.closest(".branch-section").hidden = section.hidden;
  });
}

function renderEmpty(msg) {
  return `<div class="empty-state"><div class="empty-state__icon" aria-hidden="true">✛</div><p class="empty-state__title">${msg}</p></div>`;
}

init();
