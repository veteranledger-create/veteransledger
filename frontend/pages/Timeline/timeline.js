/**
 * VeteransLedger · Timeline page
 * Loads /public/data/nsdap/timeline.json (and future timeline data)
 * and renders a year-grouped chronological track.
 */

const YEARS = [
  1933, 1934, 1935, 1936, 1937, 1938, 1939, 1940, 1941, 1942, 1943, 1944, 1945,
];

const yearNav = document.getElementById("timeline-year-nav");
const yearLoader = document.getElementById("year-loader");
const track = document.getElementById("timeline-track");
const loader = document.getElementById("timeline-loader");
const filters = document.getElementById("timeline-filters");

let allEvents = [];
let activeYear = null;
let activeCategory = "all";

async function init() {
  // Render year buttons
  if (yearLoader) yearLoader.remove();
  YEARS.forEach((year) => {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "timeline-year-btn";
    btn.textContent = year;
    btn.dataset.year = year;
    btn.setAttribute("role", "tab");
    btn.setAttribute("aria-selected", "false");
    btn.addEventListener("click", () => selectYear(year));
    yearNav?.appendChild(btn);
  });

  // Load timeline data
  try {
    const res = await fetch("/public/data/timeline/events.json");
    if (res.ok) {
      const data = await res.json();
      allEvents = Array.isArray(data) ? data : data.events || [];
    }
  } catch (_) {}

  // Wire category filters
  filters?.addEventListener("click", (e) => {
    const btn = e.target.closest(".filter-btn");
    if (!btn) return;
    activeCategory = btn.dataset.filter || "all";
    filters
      .querySelectorAll(".filter-btn")
      .forEach((b) => b.classList.toggle("is-active", b === btn));
    render();
  });

  selectYear(1939); // default to war start
}

function selectYear(year) {
  activeYear = year;
  yearNav?.querySelectorAll(".timeline-year-btn").forEach((btn) => {
    const isActive = +btn.dataset.year === year;
    btn.classList.toggle("is-active", isActive);
    btn.setAttribute("aria-selected", String(isActive));
  });
  render();
}

function render() {
  if (!track) return;
  track.innerHTML = "";

  const events = allEvents.filter((e) => {
    const year = e.year || (e.date ? new Date(e.date).getFullYear() : null);
    if (activeYear && year !== activeYear) return false;
    if (activeCategory !== "all" && e.category !== activeCategory) return false;
    return true;
  });

  if (!events.length) {
    track.innerHTML = `<div class="empty-state">
      <div class="empty-state__icon" aria-hidden="true">✛</div>
      <p class="empty-state__title">No events found</p>
      <p class="empty-state__text">No records match this filter for ${activeYear ?? "this period"}.</p>
    </div>`;
    return;
  }

  // Group by year
  const groups = {};
  events.forEach((e) => {
    const y = e.year || (e.date ? new Date(e.date).getFullYear() : "?");
    if (!groups[y]) groups[y] = [];
    groups[y].push(e);
  });

  Object.keys(groups)
    .sort()
    .forEach((year) => {
      const groupEl = document.createElement("div");
      groupEl.className = "timeline-group";
      groupEl.innerHTML = `
      <div class="timeline-group__year">
        <span class="timeline-group__year-label">${year}</span>
        <span class="timeline-group__year-line"></span>
      </div>`;

      groups[year].forEach((ev) => {
        const dateStr = ev.date
          ? new Date(ev.date).toLocaleDateString("en-GB", {
              day: "numeric",
              month: "short",
            })
          : ev.month || "";

        const evEl = document.createElement("div");
        evEl.className = "timeline-event";
        evEl.innerHTML = `
        <div class="timeline-event__date">${dateStr}</div>
        <div class="timeline-event__body">
          ${ev.category ? `<div class="timeline-event__category">${ev.category}</div>` : ""}
          <h3 class="timeline-event__title">${ev.title || ev.event || ""}</h3>
          ${ev.summary || ev.description ? `<p class="timeline-event__summary">${ev.summary || ev.description}</p>` : ""}
          ${ev.location ? `<div class="timeline-event__location">📍 ${ev.location}</div>` : ""}
        </div>`;
        groupEl.appendChild(evEl);
      });

      track.appendChild(groupEl);
    });
}

init();
