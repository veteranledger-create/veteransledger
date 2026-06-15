/**
 * VeteransLedger · Articles page
 * Loads article files per category and renders preview cards.
 */

const CATEGORIES = [
  {
    id: "military",
    path: "military",
    files: ["poland-1939.json", "rearmament.json"],
  },
  {
    id: "political",
    path: "political",
    files: ["anschluss.json", "july-20.json", "rise-nsdap.json"],
  },
  { id: "economy", path: "economy", files: [] },
  { id: "legal", path: "legal", files: ["nuremberg.json"] },
];

const PLACEHOLDER = "/public/images/covers/articles-cover.webp";

let allArticles = [];
let activeCategory = "all";
const cache = {};

async function init() {
  // Wire category tabs
  document.getElementById("category-tabs")?.addEventListener("click", (e) => {
    const btn = e.target.closest(".category-tab");
    if (!btn) return;
    activeCategory = btn.dataset.category;
    document
      .querySelectorAll(".category-tab")
      .forEach((b) => b.classList.toggle("is-active", b === btn));
    showCategory(activeCategory);
  });

  // Load all articles
  await Promise.allSettled(CATEGORIES.map((cat) => loadCategory(cat)));

  allArticles = Object.values(cache).flat();
  showCategory("all");
}

async function loadCategory({ id, path, files }) {
  if (!files.length) {
    cache[id] = [];
    return;
  }

  const results = await Promise.allSettled(
    files.map((file) =>
      fetch(`/public/data/articles/${path}/${file}`)
        .then((r) => (r.ok ? r.json() : null))
        .then((data) =>
          data ? { ...data, _category: id, _file: file } : null,
        ),
    ),
  );

  cache[id] = results
    .filter((r) => r.status === "fulfilled" && r.value)
    .map((r) => r.value);
}

function showCategory(catId) {
  // Show/hide category sections
  document.querySelectorAll(".articles-category").forEach((sec) => {
    sec.hidden = catId !== "all" && sec.dataset.catId !== catId;
  });

  const mainGrid = document.getElementById("articles-grid");

  if (catId === "all") {
    renderArticles(mainGrid, allArticles);
    // Also populate category-specific grids
    CATEGORIES.forEach((cat) => {
      const sec = document.querySelector(`[data-cat-id="${cat.id}"]`);
      if (sec && sec !== document.querySelector("[data-cat-id='military']")) {
        const grid = sec.querySelector(".articles-grid") || createGrid(sec);
        renderArticles(grid, cache[cat.id] || []);
      }
    });
  } else {
    const section = document.querySelector(`[data-cat-id="${catId}"]`);
    if (section) {
      let grid = section.querySelector(".articles-grid");
      if (!grid) {
        grid = createGrid(section);
      }
      renderArticles(grid, cache[catId] || []);
    }
  }
}

function createGrid(container) {
  const grid = document.createElement("div");
  grid.className = "articles-grid";
  container.innerHTML = "";
  container.appendChild(grid);
  return grid;
}

function renderArticles(container, articles) {
  if (!container) return;
  if (!articles.length) {
    container.innerHTML = `<div class="empty-state"><div class="empty-state__icon" aria-hidden="true">✛</div><p class="empty-state__title">Coming soon</p><p class="empty-state__text">Articles are being prepared.</p></div>`;
    return;
  }

  container.innerHTML = "";
  articles.forEach((article) => {
    const el = document.createElement("a");
    el.className = "article-preview";
    el.href = `/articles/${article.id}`;

    const imgs = article.images || [];
    const img = imgs[0] || PLACEHOLDER;
    const cat = (article._category || article.category || "").replace("-", " ");

    el.innerHTML = `
      <div class="article-preview__image">
        <img src="${img}" alt="${article.title || ""}" loading="lazy" onerror="this.src='${PLACEHOLDER}'">
      </div>
      <div class="article-preview__body">
        ${cat ? `<p class="article-preview__category">${cat}</p>` : ""}
        <h3 class="article-preview__title">${article.title || "Untitled"}</h3>
        ${article.summary || article.intro ? `<p class="article-preview__summary">${(article.summary || article.intro || "").slice(0, 180)}…</p>` : ""}
      </div>`;

    container.appendChild(el);
  });
}

init();
