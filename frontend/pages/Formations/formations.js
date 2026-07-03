/**
 * VeteransLedger · Formations page
 * Section tabs with pagination (12 per page).
 */

import { createPaginator } from "/pages/shared/paginator.js";
import { resolveRelatedUrl } from "/pages/shared/related-url-resolver.js";
import { applyRecordTranslation } from "/pages/shared/translation-loader.js";
import { onLocaleChange } from "/pages/shared/i18n.js";

const INDEX_URL = "/public/data/formations/index.json";
const PAGE_SIZE = 12;

const grid       = document.getElementById("formations-grid");
const sectionNav = document.getElementById("section-nav");

// Pager element inserted after grid
const pagerEl = (() => {
  const el = document.createElement("div");
  el.className = "pagination";
  grid?.parentNode?.insertBefore(el, grid.nextSibling);
  return el;
})();

let allFormations = [];
let activeSection = "army-groups";
let paginator     = null;

async function init() {
  let categories = [];
  try {
    const res = await fetch(INDEX_URL);
    const data = res.ok ? await res.json() : {};
    categories = data.categories || [];
  } catch (_) {}

  const results = await Promise.allSettled(
    categories.map((cat) =>
      fetch(cat.file)
        .then((r) => (r.ok ? r.json() : []))
        .then((data) => {
          const items = Array.isArray(data) ? data : [];
          return items.map((f) => ({ ...f, _section: cat.section, _categoryLabel: cat.label }));
        }),
    ),
  );

  allFormations = results
    .filter((r) => r.status === "fulfilled")
    .flatMap((r) => r.value);

  updateTabCounts();

  sectionNav?.addEventListener("click", (e) => {
    const btn = e.target.closest(".nation-tab");
    if (!btn) return;
    activeSection = btn.dataset.section || "heer";
    sectionNav.querySelectorAll(".nation-tab").forEach((b) =>
      b.classList.toggle("is-active", b === btn),
    );
    updatePaginator();
  });

  // Handle hash on load
  const hash = location.hash.replace("#", "");
  if (hash) {
    const matchBtn = sectionNav?.querySelector(`[data-section="${hash}"]`);
    if (matchBtn) {
      activeSection = hash;
      sectionNav?.querySelectorAll(".nation-tab").forEach((b) =>
        b.classList.toggle("is-active", b.dataset.section === hash),
      );
    }
  }

  buildPaginator();
}

function getFiltered() {
  return allFormations.filter((f) => f._section === activeSection);
}

// ── Category counters — "Army Groups (5)" etc., recomputed once the data
// is in. Base labels are captured before the first count is appended so
// repeat calls never accumulate "(5) (5)".
const tabBaseLabels = new Map();

function updateTabCounts() {
  sectionNav?.querySelectorAll(".nation-tab").forEach((btn) => {
    const section = btn.dataset.section;
    if (!tabBaseLabels.has(btn)) tabBaseLabels.set(btn, btn.textContent.trim());
    const count = allFormations.filter((f) => f._section === section).length;
    btn.textContent = `${tabBaseLabels.get(btn)} (${count})`;
    // Empty categories are hidden rather than shown as dead ends — they
    // reappear automatically as soon as records are published for them.
    btn.hidden = count === 0;
  });

  // If the current section's tab just got hidden, fall back to the first
  // populated one so the page never opens on an empty grid.
  const activeBtn = sectionNav?.querySelector(`[data-section="${activeSection}"]`);
  if (activeBtn?.hidden) {
    const firstVisible = sectionNav?.querySelector(".nation-tab:not([hidden])");
    if (firstVisible) {
      activeSection = firstVisible.dataset.section;
      sectionNav.querySelectorAll(".nation-tab").forEach((b) =>
        b.classList.toggle("is-active", b === firstVisible),
      );
    }
  }
}

function buildPaginator() {
  paginator = createPaginator({
    items:       getFiltered(),
    pageSize:    PAGE_SIZE,
    renderFn:    (slice) => renderGrid(grid, slice),
    pagerEl,
    scrollTarget: grid,
  });
}

function updatePaginator() {
  paginator?.setItems(getFiltered());
}

// ── Classification icon resolution ──────────────────────────────
// Maps a formation record to a single SVG marker. Volunteer formations
// follow a priority chain — historical legion shield, then country flag,
// then a generic volunteer star — everything else gets a service-branch
// icon (Waffen-SS/Luftwaffe/Kriegsmarine) or an echelon (NATO-style
// bar/X) icon from the primary hierarchy.
const ICON_BASE = "/public/images/icons/formations";
const BRANCH_ICON_BASE = "/public/images/icons/branches";

function getFormationIcon(f) {
  const section = f._section || "";
  const type = (f.type || "").toLowerCase();

  if (section === "waffen-ss") return { src: `${BRANCH_ICON_BASE}/ss.svg`, alt: "Waffen-SS" };
  if (section === "luftwaffe") return { src: `${BRANCH_ICON_BASE}/luftwaffe.svg`, alt: "Luftwaffe" };
  if (section === "kriegsmarine") return { src: `${BRANCH_ICON_BASE}/marine.svg`, alt: "Kriegsmarine" };
  if (section === "volunteers") {
    if (f.shield) return { src: f.shield, alt: `${f.nation || "Volunteer"} legion shield` };
    if (f.flag)   return { src: f.flag,   alt: f.nation || "Volunteer formation" };
    return { src: `${ICON_BASE}/volunteer.svg`, alt: "Volunteer formation" };
  }

  if (type.includes("army group")) return { src: `${ICON_BASE}/army-group.svg`, alt: "Army Group" };
  if (type.includes("army"))       return { src: `${ICON_BASE}/army.svg`,       alt: "Army" };
  if (type.includes("corps"))      return { src: `${ICON_BASE}/corps.svg`,      alt: "Corps" };
  if (type.includes("division"))  return { src: `${ICON_BASE}/division.svg`,   alt: "Division" };
  if (type.includes("brigade"))   return { src: `${ICON_BASE}/brigade.svg`,    alt: "Brigade" };
  if (type.includes("regiment"))  return { src: `${ICON_BASE}/regiment.svg`,   alt: "Regiment" };
  if (type.includes("battalion")) return { src: `${ICON_BASE}/battalion.svg`,  alt: "Battalion" };
  if (type.includes("company"))   return { src: `${ICON_BASE}/company.svg`,    alt: "Company" };
  return null;
}

// Sections that group into subheadings instead of one flat grid, and what
// field each one groups by — Divisions by subtype, Volunteers by region.
const GROUPED_SECTIONS = {
  divisions: { keyFn: (f) => f.type || "Division", fallback: "Division" },
  volunteers: { keyFn: (f) => f.region || "Volunteer Formations", fallback: "Volunteer Formations" },
};

function renderGrid(container, items) {
  if (!container) return;

  if (!items.length) {
    container.innerHTML = `<div class="empty-state">
      <p class="empty-state__title">Section Under Expansion</p>
      <p class="empty-state__text">Current Records: 0 — this category is reserved for future archive growth.</p>
    </div>`;
    return;
  }

  const grouping = GROUPED_SECTIONS[activeSection];
  container.innerHTML = grouping
    ? renderGroupedBy(items, grouping.keyFn)
    : items.map((f) => formationCard(f)).join("");

  attachIconFallbacks(container);
  applyCardTranslations(container);
}

function renderGroupedBy(items, keyFn) {
  const groups = new Map();
  items.forEach((f) => {
    const key = keyFn(f);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(f);
  });

  return Array.from(groups.entries())
    .map(([groupLabel, records]) => `
      <div class="formation-subgroup">
        <h3 class="formation-subgroup__title">${groupLabel}</h3>
        <div class="record-grid">
          ${records.map((f) => formationCard(f)).join("")}
        </div>
      </div>`)
    .join("");
}

function attachIconFallbacks(container) {
  container.querySelectorAll(".record-card__icon").forEach((img) => {
    img.addEventListener("error", () => img.remove(), { once: true });
  });
}

function formationCard(f) {
  const active = f.active
    ? `${f.active.from ? f.active.from.slice(0, 4) : ""}${f.active.to ? "–" + f.active.to.slice(0, 4) : ""}`
    : "";

  const summary = (f.summary || "").slice(0, 160) + ((f.summary || "").length > 160 ? "…" : "");

  // Branch/nation line — clearly separates "what kind" (type, already badged)
  // from "whose" (nation + service), satisfying the type/nation/branch/years card requirement.
  const metaParts = [f.nation, f.service].filter(Boolean);
  const icon = getFormationIcon(f);
  const iconImg = icon
    ? `<img class="record-card__icon" src="${icon.src}" alt="${icon.alt}">`
    : "";

  const translateId = f.recordId || f.id;
  return `
    <a class="record-card" href="${resolveRelatedUrl("Formation", f.id)}" ${translateId ? `data-translate-id="${translateId}"` : ""}>
      <div class="record-card__body">
        <div class="record-card__header">
          <span class="record-card__type">
            ${iconImg}
            <span class="record-card__badge">${f.type || f.service || ""}</span>
          </span>
          ${active ? `<span class="record-card__year">${active}</span>` : ""}
        </div>
        <h3 class="record-card__title">${f.name}</h3>
        <p class="record-card__meta">${metaParts.join(" · ")}</p>
        ${summary ? `<p class="record-card__summary">${summary}</p>` : ""}
      </div>
    </a>`;
}

function applyCardTranslations(container) {
  container.querySelectorAll(".record-card[data-translate-id]").forEach((card) => {
    applyRecordTranslation(card, "record", card.dataset.translateId);
  });
}

onLocaleChange(() => applyCardTranslations(grid));

init();
