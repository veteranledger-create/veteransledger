/**
 * VeteransLedger · Campaigns page
 * Loads campaign data per theater from /public/data/campaigns/
 * and renders record cards with theater tab switching.
 */

const THEATERS = [
  { id: "eastern-front", label: "Eastern Front", path: "eastern-front" },
  { id: "western-front", label: "Western Front", path: "western-front" },
  { id: "africa", label: "North Africa", path: "africa" },
  { id: "italy", label: "Italy", path: "italy" },
  { id: "atlantic", label: "Atlantic", path: "atlantic" },
];

const PLACEHOLDER = "/public/images/covers/placeholder-cards.webp";

let activeTheater = "eastern-front";
const cache = {};

// Wire theater tab navigation
document.getElementById("theater-nav")?.addEventListener("click", (e) => {
  const btn = e.target.closest(".nation-tab");
  if (!btn) return;
  const theater = btn.dataset.theater;
  if (!theater) return;
  document
    .querySelectorAll(".nation-tab")
    .forEach((b) => b.classList.toggle("is-active", b === btn));
  switchTheater(theater);
});

// Wire hash on load
function initFromHash() {
  const hash = location.hash.replace("#", "");
  const match = THEATERS.find((t) => t.id === hash);
  if (match) {
    activeTheater = match.id;
    document
      .querySelector(`[data-theater="${match.id}"]`)
      ?.classList.add("is-active");
    document.querySelectorAll(".nation-tab").forEach((b) => {
      b.classList.toggle("is-active", b.dataset.theater === match.id);
    });
  }
  switchTheater(activeTheater);
}

async function switchTheater(theaterId) {
  activeTheater = theaterId;
  const grid = document.getElementById("campaigns-grid");
  if (!grid) return;

  if (!cache[theaterId]) {
    grid.innerHTML = `<div class="loader"><span class="loader__dot"></span><span class="loader__dot"></span><span class="loader__dot"></span></div>`;
    cache[theaterId] = await loadTheaterData(theaterId);
  }

  renderCampaigns(grid, cache[theaterId]);

  // Update section heading
  const sectionLabel = document.querySelector(".section-label");
  if (sectionLabel) {
    const theater = THEATERS.find((t) => t.id === theaterId);
    sectionLabel.textContent = theater?.label || theaterId;
  }
}

async function loadTheaterData(theaterId) {
  const theater = THEATERS.find((t) => t.id === theaterId);
  if (!theater) return [];

  const files = await discoverFiles(theater.path);
  const results = await Promise.allSettled(
    files.map((file) =>
      fetch(`/public/data/campaigns/${theater.path}/${file}`).then((r) =>
        r.ok ? r.json() : null,
      ),
    ),
  );
  return results
    .filter((r) => r.status === "fulfilled" && r.value)
    .map((r) => r.value);
}

async function discoverFiles(theaterPath) {
  const known = {
    "eastern-front": [
      "barbarossa.json",
      "blue.json",
      "caucasus.json",
      "kharkov.json",
      "kiev.json",
      "leningrad.json",
      "moscow.json",
      "stalingrad.json",
    ],
    "western-front": [
      "britain.json",
      "bulge.json",
      "bzura.json",
      "dieppe.json",
      "dunkirk.json",
      "france.json",
      "market-garden.json",
      "normandy.json",
      "norway.json",
      "poland.json",
      "warsaw.json",
    ],
    africa: [
      "alamein-1.json",
      "alamein-2.json",
      "gazala.json",
      "sonnenblume.json",
      "tobruk.json",
    ],
    italy: [
      "cassino.json",
      "crete.json",
      "gothic-line.json",
      "sicily.json",
      "taranto.json",
    ],
    atlantic: [
      "altmark.json",
      "atlantic.json",
      "convoy-war.json",
      "rheinubung.json",
      "river-plate.json",
      "uboat-campaing.json",
    ],
  };
  return known[theaterPath] || [];
}

function renderCampaigns(container, campaigns) {
  if (!campaigns.length) {
    container.innerHTML = `<div class="empty-state">
      <div class="empty-state__icon" aria-hidden="true">✛</div>
      <p class="empty-state__title">Records pending</p>
      <p class="empty-state__text">Content for this theater is being compiled.</p>
    </div>`;
    return;
  }

  container.innerHTML = "";
  campaigns.forEach((c) => {
    const card = document.createElement("a");
    card.className = "record-card";
    card.href = `/campaigns/${c.id}`;

    const imgSrc = c.image || PLACEHOLDER;
    const dateStr = c.startDate || c.date || c.year || "";
    const theater = c.theater || "";

    card.innerHTML = `
      <div class="record-card__image">
        <img src="${imgSrc}" alt="${c.title || ""}" loading="lazy" onerror="this.src='${PLACEHOLDER}'">
      </div>
      <div class="record-card__body">
        <div class="record-card__tags">
          ${theater ? `<span class="badge">${theater}</span>` : ""}
        </div>
        <h3 class="record-card__title">${c.title || "Untitled"}</h3>
        ${dateStr ? `<p class="record-card__meta">${dateStr}</p>` : ""}
        ${c.summary ? `<p class="record-card__summary">${c.summary}</p>` : ""}
      </div>
      <div class="record-card__footer">
        <span class="record-card__read-more">Read more →</span>
      </div>`;

    container.appendChild(card);
  });
}

initFromHash();
