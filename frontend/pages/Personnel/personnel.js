/**
 * VeteransLedger · Personnel page
 * Loads branch JSON files and renders person cards grouped by branch.
 * Branch definitions loaded from personnel/index.json — no hardcoded arrays.
 * Branch icons: SVG assets for military branches; country flags for foreign volunteers.
 * Pagination: 12 cards per page per branch.
 */

import { createPaginator } from "/pages/shared/paginator.js";
import { resolveRelatedUrl } from "/pages/shared/related-url-resolver.js";
import { applyRecordTranslation, loadManifestTranslatedVersioned } from "/pages/shared/translation-loader.js";
import { createContentSession, renderContentError } from "/pages/shared/content-fetch.js";
import { onLocaleChange } from "/pages/shared/i18n.js";
import { t } from "/pages/shared/ui-strings.js";

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

// One session per page load: the index is fetched once and every branch file
// is pinned to the version that index came from. The manifest still goes
// through the translation loader, so translated labels apply; the version
// pinned is the English source's, which is what the server served.
const content = createContentSession("/public/data/personnel/index.json", {
  loadIndex: (url) => loadManifestTranslatedVersioned(url, "personnel/index.json"),
});

/** Branches as one particular manifest describes them, or null if it has none. */
function branchesFrom(manifest) {
  const list = (manifest?.branches ?? []).map((b) => ({
    id:   b.id,
    label: b.label,
    file: String(b.file ?? "").replace("/public/data/personnel/", ""),
  }));
  return list.length ? list : null;
}

async function loadManifest() {
  const parsed = branchesFrom((await content.index()).data);
  if (parsed) { BRANCHES = parsed; return; }
  {
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
    `<button type="button" class="filter-btn${activeBranch === "all" ? " is-active" : ""}" data-branch="all">${t("search.filter.all", null, "All")}</button>` +
    BRANCHES.map((b) => `<button type="button" class="filter-btn${activeBranch === b.id ? " is-active" : ""}" data-branch="${b.id}">${b.label}</button>`).join("");
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

  // Every branch loads against one version, so the page can never show one
  // branch from v41 beside another from v42.
  try {
    await content.load(async (manifest, record) => {
      const parsed = branchesFrom(manifest);
      if (parsed) { BRANCHES = parsed; renderBranchFilter(); }
      return Promise.all(BRANCHES.map((b) => loadBranch(b, record)));
    });
  } catch (err) {
    BRANCHES.forEach(({ id }) => {
      const gridId = `${id.replace("-", "")}-grid`;
      renderContentError(
        document.getElementById(gridId) || document.getElementById(`${id}-grid`),
        err,
      );
    });
  }
  toggleBranchVisibility();

  onLocaleChange(async () => {
    // Re-read the index so the new locale's translated labels apply. That
    // also re-pins to whatever version is active now, which is correct here
    // because no record requests are in flight at this point.
    content.invalidate();
    await loadManifest();
    renderBranchFilter();
  });
}

async function loadBranch({ id, label, file }, record) {
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

  // A pruned version propagates out to the session rather than being shown
  // as "data pending"; a missing or unreadable file still degrades to the
  // empty state exactly as before.
  const data = await record(`/public/data/personnel/${file}`);
  const people = Array.isArray(data) ? data : data?.personnel || data?.people || [];

  if (!people.length) {
    gridEl.innerHTML = renderEmpty(t("empty.personnelPending", null, "Data pending compilation."));
    if (countEl) countEl.textContent = "0 records";
    return;
  }

  if (countEl) countEl.textContent = `${people.length} records`;

  createPaginator({
    items:       people,
    pageSize:    PAGE_SIZE,
    renderFn:    (slice) => renderPeople(gridEl, slice, id),
    pagerEl,
    scrollTarget: gridEl,
  });
}

function renderPeople(container, people, branchId = "") {
  if (!people.length) {
    container.innerHTML = renderEmpty(t("empty.personnelNoRecords", null, "No records available yet."));
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
      });
    }
  });
}

onLocaleChange(() => {
  document.querySelectorAll(".person-card[data-translate-id]").forEach((card) => {
    applyRecordTranslation(card, "entity", card.dataset.translateId, {
      titleSelector: ".person-card__name",
      summarySelector: ".person-card__excerpt",
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
