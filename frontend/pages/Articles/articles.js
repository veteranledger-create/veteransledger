/**
 * VeteransLedger · Articles page
 * Category filter + pagination (9 per page).
 * Category definitions loaded from articles/index.json — no hardcoded arrays.
 */

import { createPaginator } from "/pages/shared/paginator.js";
import { resolveRelatedUrl } from "/pages/shared/related-url-resolver.js";
import { applyRecordTranslation } from "/pages/shared/translation-loader.js";
import { onLocaleChange } from "/pages/shared/i18n.js";

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

async function loadManifest() {
  try {
    const res = await fetch("/public/data/articles/index.json");
    const data = res.ok ? await res.json() : null;
    CATEGORIES = (data?.categories ?? []).map((c) => ({
      id:    c.id,
      label: c.label,
      path:  c.id,
      files: (c.files || []).map((f) => f.split("/").pop()),
    }));
  } catch (_) {}
  if (!CATEGORIES.length) {
    CATEGORIES = [
      { id: "military",  label: "Military",  path: "military",  files: ["poland-1939.json","rearmament.json","berlin-1945.json"] },
      { id: "political", label: "Political", path: "political", files: ["anschluss.json","july-20.json","rise-nsdap.json","occupation.json"] },
      { id: "economy",   label: "Economy",   path: "economy",   files: [] },
      { id: "legal",     label: "Legal",     path: "legal",     files: ["nuremberg.json"] },
    ];
  }
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

  await Promise.allSettled(CATEGORIES.map((cat) => loadCategory(cat)));
  allArticles = Object.values(cache).flat();
  buildPaginator();
}

async function loadCategory({ id, path, files }) {
  if (!files.length) { cache[id] = []; return; }

  const results = await Promise.allSettled(
    files.map((file) =>
      fetch(`/public/data/articles/${path}/${file}`)
        .then((r) => (r.ok ? r.json() : null))
        .then((data) => data ? { ...data, _category: id, _file: file } : null),
    ),
  );
  cache[id] = results.filter((r) => r.status === "fulfilled" && r.value).map((r) => r.value);
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
      <p class="empty-state__title">Coming soon</p>
      <p class="empty-state__text">Articles are being prepared.</p>
    </div>`;
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
        noticeAnchor: ".article-preview__body",
      });
    }
  });
}

onLocaleChange(() => {
  document.querySelectorAll(".article-preview[data-translate-id]").forEach((card) => {
    applyRecordTranslation(card, "record", card.dataset.translateId, {
      titleSelector: ".article-preview__title",
      summarySelector: ".article-preview__summary",
      noticeAnchor: ".article-preview__body",
    });
  });
});

init();
