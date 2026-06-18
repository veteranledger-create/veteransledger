/**
 * VeteransLedger · Articles page
 * Category filter + pagination (9 per page).
 */

import { createPaginator } from "/pages/shared/paginator.js";

const CATEGORIES = [
  { id: "military",  path: "military",  files: ["poland-1939.json","rearmament.json","berlin-1945.json"] },
  { id: "political", path: "political", files: ["anschluss.json","july-20.json","rise-nsdap.json","occupation.json"] },
  { id: "economy",   path: "economy",   files: [] },
  { id: "legal",     path: "legal",     files: ["nuremberg.json"] },
];

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

async function init() {
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
    el.href = `/articles/${article.id}`;

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
  });
}

init();
