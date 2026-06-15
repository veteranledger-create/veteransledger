/**
 * VeteransLedger · Armaments page
 * Loads category + nation JSON files and renders armament cards.
 * State: active category + active nation filter.
 */

const CATEGORIES = [
  { id: "panzer", label: "Panzers", path: "panzer" },
  { id: "aircraft", label: "Aircraft", path: "aircraft" },
  { id: "naval", label: "Naval", path: "naval" },
  { id: "missiles", label: "Missiles", path: "missiles" },
  { id: "wunderwaffen", label: "Wunderwaffen", path: "wunderwaffen" },
  { id: "equipment", label: "Equipment", path: "equipment" },
];

const NATIONS = ["germany", "italy", "japan", "other-axis"];
const PLACEHOLDER = "/public/images/covers/placeholder-cards.webp";
const FLAG_MAP = {
  germany: "/public/images/flags/germany.webp",
  italy: "/public/images/flags/italy.webp",
  japan: "/public/images/flags/japan.webp",
};

let activeCategory = "panzer";
let activeNation = "all";
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

  // Wire nation tabs
  document.getElementById("nation-tabs")?.addEventListener("click", (e) => {
    const btn = e.target.closest(".nation-tab");
    if (!btn) return;
    activeNation = btn.dataset.nation;
    document
      .querySelectorAll(".nation-tab")
      .forEach((b) => b.classList.toggle("is-active", b === btn));
    rerenderCurrent();
  });

  await loadCategory("panzer");
  showCategory("panzer");
}

async function showCategory(catId) {
  // Show/hide sections
  document.querySelectorAll(".armaments-category").forEach((sec) => {
    sec.hidden = sec.dataset.catId !== catId;
  });

  const section = document.querySelector(`[data-cat-id="${catId}"]`);
  if (!section) return;

  if (!cache[catId]) {
    section.innerHTML = `<div class="loader"><span class="loader__dot"></span><span class="loader__dot"></span><span class="loader__dot"></span></div>`;
    await loadCategory(catId);
  }
  renderCategory(catId, section);
}

async function loadCategory(catId) {
  const cat = CATEGORIES.find((c) => c.id === catId);
  if (!cat) return;

  const results = await Promise.allSettled(
    NATIONS.map((n) =>
      fetch(`/public/data/armaments/${cat.path}/${n}.json`)
        .then((r) => (r.ok ? r.json() : []))
        .then((data) => ({
          nation: n,
          items: Array.isArray(data)
            ? data
            : data?.armaments || data?.items || [],
        })),
    ),
  );

  cache[catId] = results
    .filter((r) => r.status === "fulfilled")
    .map((r) => r.value)
    .filter((r) => r.items.length > 0);
}

function renderCategory(catId, container) {
  const nationData = cache[catId] || [];
  const filtered =
    activeNation === "all"
      ? nationData.flatMap((n) =>
          n.items.map((item) => ({ ...item, _nation: n.nation })),
        )
      : (
          nationData.find(
            (n) =>
              n.nation === activeNation || n.nation === activeNation + "-axis",
          )?.items || []
        ).map((item) => ({ ...item, _nation: activeNation }));

  if (!filtered.length) {
    container.innerHTML = `<div class="empty-state"><div class="empty-state__icon" aria-hidden="true">✛</div><p class="empty-state__title">Records pending</p><p class="empty-state__text">Content being compiled.</p></div>`;
    return;
  }

  const grid = document.createElement("div");
  grid.className = "armaments-grid";

  filtered.forEach((item) => {
    const name = item.name || item.title || "Unknown";
    const nation = item._nation || item.nation || "";
    const imgSrc = item.image || PLACEHOLDER;
    const flag = FLAG_MAP[nation] || "";
    const cat = item.type || item.category || catId;

    const card = document.createElement("a");
    card.className = "armament-card";
    card.href = `/armaments/${item.id}`;
    card.innerHTML = `
      <div class="armament-card__image">
        <img src="${imgSrc}" alt="${name}" loading="lazy" onerror="this.src='${PLACEHOLDER}'">
      </div>
      <div class="armament-card__body">
        <p class="armament-card__category">${cat}</p>
        <h3 class="armament-card__name">${name}</h3>
        <p class="armament-card__nation">
          ${flag ? `<img class="armament-card__flag" src="${flag}" alt="${nation}">` : ""}
          ${nation.replace("-axis", "").replace("-", " ")}
        </p>
        ${item.summary ? `<p style="font-size:var(--text-xs);color:var(--text-muted);margin-top:var(--space-2);line-height:1.5;">${item.summary}</p>` : ""}
      </div>`;
    grid.appendChild(card);
  });

  container.innerHTML = "";
  container.appendChild(grid);
}

function rerenderCurrent() {
  const section = document.querySelector(`[data-cat-id="${activeCategory}"]`);
  if (section) renderCategory(activeCategory, section);
}

init();
