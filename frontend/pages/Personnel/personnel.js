/**
 * VeteransLedger · Personnel page
 * Loads branch JSON files and renders person cards grouped by branch.
 */

const BRANCHES = [
  { id: "army", label: "Heer (Army)", file: "army.json" },
  { id: "luftwaffe", label: "Luftwaffe", file: "luftwaffe.json" },
  { id: "kriegsmarine", label: "Kriegsmarine", file: "kriegsmarine.json" },
  { id: "waffen-ss", label: "Waffen-SS", file: "waffen-ss.json" },
  { id: "foreign", label: "Foreign Volunteers", file: "foreign.json" },
];

const PLACEHOLDER = "/public/images/covers/placeholder-cards.webp";
let activeBranch = "all";

async function init() {
  // Wire filter bar
  document.querySelector(".filter-bar")?.addEventListener("click", (e) => {
    const btn = e.target.closest(".filter-btn");
    if (!btn) return;
    activeBranch = btn.dataset.branch || "all";
    document
      .querySelectorAll(".filter-btn")
      .forEach((b) => b.classList.toggle("is-active", b === btn));
    toggleBranchVisibility();
  });

  // Load all branches in parallel
  await Promise.allSettled(BRANCHES.map((b) => loadBranch(b)));
  toggleBranchVisibility();
}

async function loadBranch({ id, label, file }) {
  const gridEl =
    document.getElementById(`${id.replace("-", "")}-grid`) ||
    document.getElementById(`${id}-grid`);
  const countEl =
    document.getElementById(`${id.replace("-", "")}-count`) ||
    document.getElementById(`${id}-count`);

  try {
    const res = await fetch(`/public/data/personnel/${file}`);
    const data = res.ok ? await res.json() : null;
    const people = Array.isArray(data)
      ? data
      : data?.personnel || data?.people || [];

    if (countEl) countEl.textContent = `${people.length} records`;
    if (gridEl) renderPeople(gridEl, people);
  } catch (_) {
    if (gridEl) gridEl.innerHTML = renderEmpty("Data pending compilation.");
  }
}

function renderPeople(container, people) {
  if (!people.length) {
    container.innerHTML = renderEmpty("No records available yet.");
    return;
  }

  container.innerHTML = "";
  people.forEach((p) => {
    const el = document.createElement("a");
    el.className = "person-card";
    el.href = `/personnel/${p.id}`;

    const img = p.image || p.photo || PLACEHOLDER;
    const rank = p.rank || p.title || "";
    const name = p.name || p.fullName || "Unknown";
    const meta = [
      p.born && `b. ${p.born}`,
      p.died && `d. ${p.died}`,
      p.nationality,
    ]
      .filter(Boolean)
      .join(" · ");

    el.innerHTML = `
      <div class="person-card__portrait">
        <img src="${img}" alt="${name}" loading="lazy" onerror="this.src='${PLACEHOLDER}'">
      </div>
      <div class="person-card__info">
        ${rank ? `<p class="person-card__rank">${rank}</p>` : ""}
        <h3 class="person-card__name">${name}</h3>
        ${meta ? `<p class="person-card__meta">${meta}</p>` : ""}
        ${p.summary ? `<p class="person-card__meta" style="margin-top:var(--space-2);font-size:var(--text-xs);color:var(--text-muted);display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden;">${p.summary}</p>` : ""}
      </div>`;

    container.appendChild(el);
  });
}

function toggleBranchVisibility() {
  BRANCHES.forEach(({ id }) => {
    const section = document.getElementById(id);
    if (!section) return;
    const gridId = `${id.replace("-", "")}-grid`;
    const grid =
      document.getElementById(gridId) || document.getElementById(`${id}-grid`);
    section.hidden = activeBranch !== "all" && activeBranch !== id;
    if (grid) grid.closest(".branch-section").hidden = section.hidden;
  });
}

function renderEmpty(msg) {
  return `<div class="empty-state"><div class="empty-state__icon" aria-hidden="true">✛</div><p class="empty-state__title">${msg}</p></div>`;
}

init();
