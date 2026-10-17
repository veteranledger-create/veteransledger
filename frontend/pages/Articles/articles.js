/**
 * VeteransLedger · Articles page
 * Category filter + pagination (9 per page).
 * Category definitions loaded from articles/index.json — no hardcoded arrays.
 */

import { createPaginator } from "/pages/shared/paginator.js";
import { resolveRelatedUrl } from "/pages/shared/related-url-resolver.js";
import { applyRecordTranslation } from "/pages/shared/translation-loader.js";
import { onLocaleChange } from "/pages/shared/i18n.js";
import { applyUiStrings } from "/pages/shared/ui-strings.js";
import { createContentSession } from "/pages/shared/content-fetch.js";

let CATEGORIES = [];

const PAGE_SIZE   = 9;
const PLACEHOLDER = "/public/images/covers/articles-cover.webp";

let allArticles   = [];
let activeCategory = "all";
const cache        = {};
let paginator      = null;

const mainGrid = document.getElementById("articles-grid");
const pagerEl  = (() => {
  const el = document.createElement("div");
  el.className = "pagination";
  mainGrid?.parentNode?.insertBefore(el, mainGrid.nextSibling);
  return el;
})();

// One session per page load: the index is fetched once and cached as before,
// but every article request is pinned to the version that index came from,
// so a promotion mid-load cannot mix content from two versions.
const content = createContentSession("/public/data/articles/index.json");

const CATEGORIES_FALLBACK = [
  { id: "military",  label: "Military",  path: "military",  files: ["poland-1939.json","rearmament.json","berlin-1945.json"] },
  { id: "political", label: "Political", path: "political", files: ["anschluss.json","july-20.json","rise-nsdap.json","occupation.json"] },
  { id: "economy",   label: "Economy",   path: "economy",   files: [] },
  { id: "legal",     label: "Legal",     path: "legal",     files: ["nuremberg.json"] },
];

/** Categories as one particular manifest describes them. */
function categoriesFrom(manifest) {
  const cats = (manifest?.categories ?? []).map((c) => ({
    id:    c.id,
    label: c.label,
    path:  c.id,
    files: (c.files || []).map((f) => f.split("/").pop()),
  }));
  return cats.length ? cats : CATEGORIES_FALLBACK;
}

async function loadManifest() {
  CATEGORIES = categoriesFrom((await content.index()).data);
}

function renderCategoryTabs() {
  const tabs = document.getElementById("category-tabs");
  if (!tabs || !CATEGORIES.length) return;
  tabs.innerHTML =
    `<button type="button" class="category-tab is-active" role="tab" data-category="all">All</button>` +
    CATEGORIES.map((c) =>
      `<button type="button" class="category-tab" role="tab" data-category="${c.id}">${c.label}</button>`,
    ).join("");
}

async function init() {
  await loadManifest();
  renderCategoryTabs();

  document.getElementById("category-tabs")?.addEventListener("click", (e) => {
    const btn = e.target.closest(".category-tab");
    if (!btn) return;
    activeCategory = btn.dataset.category;
    document.querySelectorAll(".category-tab")
      .forEach((b) => b.classList.toggle("is-active", b === btn));
    updatePaginator();
  });

  await loadAllCategories();
  buildPaginator();
}

/**
 * Loads every category's articles as one unit, against a single version.
 *
 * The category list is re-derived from the manifest inside the load rather
 * than read from the module-level CATEGORIES, so if the session has to
 * reload a newer index the file list reloads with it instead of replaying a
 * stale one. Promise.all rather than allSettled: the only rejection a record
 * fetch produces is a pruned version, and that must reach the session.
 */
async function loadAllCategories() {
  const loaded = await content.load(async (manifest, record) => {
    const cats = categoriesFrom(manifest);
    CATEGORIES = cats;
    renderCategoryTabs();

    const out = {};
    await Promise.all(
      cats.map(async ({ id, path, files }) => {
        const items = await Promise.all(
          files.map((file) =>
            record(`/public/data/articles/${path}/${file}`)
              .then((data) => (data ? { ...data, _category: id, _file: file } : null)),
          ),
        );
        out[id] = items.filter(Boolean);
      }),
    );
    return out;
  });

  for (const key of Object.keys(cache)) delete cache[key];
  Object.assign(cache, loaded);
  allArticles = Object.values(cache).flat();
}

function filteredArticles() {
  return activeCategory === "all"
    ? allArticles
    : (cache[activeCategory] || []);
}

function buildPaginator() {
  paginator = createPaginator({
    items:       filteredArticles(),
    pageSize:    PAGE_SIZE,
    renderFn:    (slice) => renderArticles(mainGrid, slice),
    pagerEl,
    scrollTarget: mainGrid,
  });
}

function updatePaginator() {
  paginator?.setItems(filteredArticles());
}

function renderArticles(container, articles) {
  if (!container) return;

  if (!articles.length) {
    container.innerHTML = `<div class="empty-state">
      <div class="empty-state__icon" aria-hidden="true">✛</div>
      <p class="empty-state__title" data-i18n="empty.articlesComingSoon.title">Coming soon</p>
      <p class="empty-state__text" data-i18n="empty.articlesComingSoon.text">Articles are being prepared.</p>
    </div>`;
    applyUiStrings(container);
    return;
  }

  container.innerHTML = "";
  articles.forEach((article) => {
    const el = document.createElement("a");
    el.className = "article-preview";
    el.href = resolveRelatedUrl("Article", article.id);

    const imgs = article.images || [];
    const img  = imgs[0] || PLACEHOLDER;
    const cat  = (article._category || article.category || "").replace("-", " ");

    el.innerHTML = `
      <div class="article-preview__image">
        <img src="${img}" alt="${article.title || ""}" loading="lazy" onerror="this.onerror=null;this.src='${PLACEHOLDER}'">
      </div>
      <div class="article-preview__body">
        ${cat ? `<p class="article-preview__category">${cat}</p>` : ""}
        <h3 class="article-preview__title">${article.title || "Untitled"}</h3>
        ${article.summary || article.intro
          ? `<p class="article-preview__summary">${(article.summary || article.intro || "").slice(0, 180)}…</p>`
          : ""}
      </div>`;

    container.appendChild(el);

    const translateId = article.recordId || article.id;
    if (translateId) {
      el.dataset.translateId = translateId;
      applyRecordTranslation(el, "record", translateId, {
        titleSelector: ".article-preview__title",
        summarySelector: ".article-preview__summary",
      });
    }
  });
}

onLocaleChange(() => {
  document.querySelectorAll(".article-preview[data-translate-id]").forEach((card) => {
    applyRecordTranslation(card, "record", card.dataset.translateId, {
      titleSelector: ".article-preview__title",
      summarySelector: ".article-preview__summary",
    });
  });
});

init();
