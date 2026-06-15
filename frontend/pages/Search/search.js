/**
 * VeteransLedger · Search page
 * Client-side search across JSON data files, with API fallback.
 */

const form = document.getElementById("search-form");
const input = document.getElementById("search-input");
const results = document.getElementById("search-results");
const filterBtns = document.querySelectorAll("[data-type]");

let activeType = "all";

// Pre-fill from URL query
const urlParams = new URLSearchParams(location.search);
const initialQuery = urlParams.get("q") || "";
if (input && initialQuery) {
  input.value = initialQuery;
  runSearch(initialQuery);
}

// Wire type filters
filterBtns.forEach((btn) => {
  btn.addEventListener("click", () => {
    activeType = btn.dataset.type;
    filterBtns.forEach((b) => b.classList.toggle("is-active", b === btn));
    if (input?.value.trim()) runSearch(input.value.trim());
  });
});

// Wire form submit
form?.addEventListener("submit", (e) => {
  e.preventDefault();
  const q = input?.value.trim();
  if (q) runSearch(q);
});

async function runSearch(query) {
  if (!results) return;
  results.innerHTML = `<div class="loader"><span class="loader__dot"></span><span class="loader__dot"></span><span class="loader__dot"></span></div>`;

  // Update URL without reload
  const url = new URL(location.href);
  url.searchParams.set("q", query);
  history.replaceState({}, "", url.toString());

  try {
    // Try API first, fall back to client-side JSON scan
    const apiRes = await fetch(
      `/api/search?q=${encodeURIComponent(query)}&type=${activeType === "all" ? "" : activeType}`,
    );
    if (apiRes.ok) {
      const data = await apiRes.json();
      renderApiResults(data);
    } else {
      renderEmpty("Search service unavailable. Try again later.");
    }
  } catch (_) {
    renderEmpty("Could not connect to search service.");
  }
}

function renderApiResults({ records = [], entities = [], total = 0, query }) {
  if (!results) return;

  const combined = [
    ...records.map((r) => ({ ...r, _kind: "record" })),
    ...entities.map((e) => ({ ...e, _kind: "entity" })),
  ];

  if (!combined.length) {
    results.innerHTML = `<div class="empty-state">
      <div class="empty-state__icon" aria-hidden="true">⌕</div>
      <p class="empty-state__title">No results for "${escapeHtml(query)}"</p>
      <p class="empty-state__text">Try different keywords or browse the archive sections.</p>
    </div>`;
    return;
  }

  const heading = document.createElement("p");
  heading.style.cssText =
    "font-size:var(--text-sm);color:var(--text-muted);margin-bottom:var(--space-6);";
  heading.textContent = `${total} results for "${query}"`;

  const grid = document.createElement("div");
  grid.className = "record-grid";

  combined.forEach((item) => {
    const el = document.createElement("article");
    el.className = "record-card";
    const title = item.title || item.name || "Unknown";
    const type = item.type || item._kind || "";
    const summary = item.summary || item.biography || "";

    el.innerHTML = `
      <div class="record-card__body">
        <div class="record-card__tags"><span class="badge">${type}</span></div>
        <h3 class="record-card__title">${escapeHtml(title)}</h3>
        ${summary ? `<p class="record-card__summary">${escapeHtml(summary.slice(0, 160))}…</p>` : ""}
      </div>`;
    grid.appendChild(el);
  });

  results.innerHTML = "";
  results.appendChild(heading);
  results.appendChild(grid);
}

function renderEmpty(msg) {
  if (!results) return;
  results.innerHTML = `<div class="empty-state">
    <div class="empty-state__icon" aria-hidden="true">⌕</div>
    <p class="empty-state__title">${escapeHtml(msg)}</p>
  </div>`;
}

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
