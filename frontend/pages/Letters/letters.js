/**
 * VeteransLedger · Letters page
 * Loads letter collections, normalises dual schemas, renders list + inline viewer.
 * Pagination: 12 letters per page; preserved when filter changes.
 */

import { createPaginator } from "/pages/shared/paginator.js";

const COLLECTIONS = [
  { id: "german",     label: "German",     file: "german.json" },
  { id: "italian",    label: "Italian",    file: "italian.json" },
  { id: "japanese",   label: "Japanese",   file: "japanese.json" },
  { id: "volunteers", label: "Volunteers", file: "volunteers.json" },
  { id: "british",    label: "British",    file: "british.json" },
  { id: "polish",     label: "Polish",     file: "polish.json" },
];

const PAGE_SIZE = 12;

const listEl   = document.getElementById("letters-list");
const viewerEl = document.getElementById("letter-viewer");

// Pager element inserted after the full letters layout (below both list and viewer)
const pagerEl = (() => {
  const el = document.createElement("div");
  el.className = "pagination";
  const layout = document.querySelector(".letters-layout");
  const anchor = layout || listEl;
  anchor?.parentNode?.insertBefore(el, anchor.nextSibling);
  return el;
})();

let allLetters  = [];
let activeLang  = "all";
let paginator   = null;

/* ── Field normalisation ─────────────────────────────────────── */
function normalise(letter) {
  return {
    ...letter,
    _author:   letter.from || letter.author || "Unknown soldier",
    _unit:     letter.from_unit || letter.unit || "",
    _to:       letter.to || letter.recipient || "",
    _location: letter.location_written || letter.location || "",
    _body:     letter.body || letter.translation || letter.full_text || letter.content || letter.text || "",
    _original: letter.original_text || letter.original || letter.originalText || "",
    _context:  letter.historical_context || letter.context || "",
    _notes:    letter.notes || letter.archival_note || "",
    _archive:  letter.archive_source || letter.archival_note || "",
    _excerpt:  letter.excerpt || "",
  };
}

async function init() {
  const results = await Promise.allSettled(
    COLLECTIONS.map((c) =>
      fetch(`/public/data/letters/${c.file}`)
        .then((r) => (r.ok ? r.json() : []))
        .then((data) => {
          const letters = Array.isArray(data) ? data : data?.letters || [];
          return letters.map((l) => normalise({ ...l, _lang: c.id }));
        }),
    ),
  );

  allLetters = results
    .filter((r) => r.status === "fulfilled")
    .flatMap((r) => r.value);

  document.querySelector(".filter-bar")?.addEventListener("click", (e) => {
    const btn = e.target.closest(".filter-btn");
    if (!btn) return;
    activeLang = btn.dataset.lang || "all";
    document.querySelectorAll(".filter-btn")
      .forEach((b) => b.classList.toggle("is-active", b === btn));
    updatePaginator();
  });

  buildPaginator();
}

function buildPaginator() {
  const filtered = activeLang === "all"
    ? allLetters
    : allLetters.filter((l) => l._lang === activeLang);

  if (paginator) {
    paginator.setItems(filtered);
  } else {
    paginator = createPaginator({
      items:       filtered,
      pageSize:    PAGE_SIZE,
      renderFn:    renderLetters,
      pagerEl,
      scrollTarget: listEl,
    });
  }
}

function updatePaginator() {
  const filtered = activeLang === "all"
    ? allLetters
    : allLetters.filter((l) => l._lang === activeLang);
  paginator?.setItems(filtered);
}

function renderLetters(letters) {
  if (!listEl) return;

  if (!letters.length) {
    listEl.innerHTML = `<div class="empty-state">
      <div class="empty-state__icon" aria-hidden="true">✉</div>
      <p class="empty-state__title">No letters found</p>
      <p class="empty-state__text">This collection is being compiled.</p>
    </div>`;
    return;
  }

  listEl.innerHTML = "";
  letters.forEach((letter) => {
    const card = document.createElement("article");
    card.className = "letter-card";
    card.setAttribute("tabindex", "0");
    card.setAttribute("role", "button");
    card.setAttribute("aria-label", `Letter from ${letter._author}`);

    const excerpt = (letter._excerpt || letter._body).slice(0, 200);

    card.innerHTML = `
      <div class="letter-card__header">
        <span class="letter-card__from">${letter._author}</span>
        <span class="letter-card__date">${letter.date || letter.year || ""}</span>
      </div>
      ${excerpt ? `<p class="letter-card__excerpt">"${excerpt}${excerpt.length >= 200 ? "…" : ""}"</p>` : ""}
      ${letter.id ? `<a class="letter-card__deep-link" href="/letters/${letter.id}" style="display:inline-block;margin-top:8px;font-size:11px;color:var(--gold-dim);text-decoration:none;letter-spacing:0.06em;" onclick="event.stopPropagation()">Read full letter →</a>` : ""}`;

    card.addEventListener("click", () => openLetter(letter));
    card.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === " ") { e.preventDefault(); openLetter(letter); }
    });
    listEl.appendChild(card);
  });
}

function openLetter(letter) {
  if (!viewerEl) return;

  const bodyHtml = letter._body
    ? letter._body.replace(/\n/g, "<br>")
    : "<em>Full text not available in this view — use the deep link to read the complete letter.</em>";

  viewerEl.innerHTML = `
    <p class="letter-viewer__from">${letter._author}</p>
    <p class="letter-viewer__date">${[letter.date, letter._location].filter(Boolean).join(" · ")}</p>
    ${letter.subject ? `<p style="font-size:var(--text-xs);color:var(--gold-dim);letter-spacing:0.06em;margin-bottom:var(--space-3)">${letter.subject}</p>` : ""}
    <div class="letter-viewer__body">${bodyHtml}</div>
    ${letter._original ? `<div class="letter-viewer__original"><strong>Original (${letter.language || "source language"}):</strong><br>${letter._original.replace(/\n/g, "<br>")}</div>` : ""}
    ${letter.translator_note ? `<p style="font-size:var(--text-xs);color:var(--text-muted);margin-top:var(--space-3);font-style:italic">${letter.translator_note}</p>` : ""}
    ${letter.id ? `<a href="/letters/${letter.id}" style="display:inline-block;margin-top:var(--space-4);font-size:var(--text-xs);color:var(--gold);text-decoration:none;letter-spacing:0.06em;">Read full record with sources →</a>` : ""}`;

  viewerEl.scrollIntoView({ behavior: "smooth", block: "nearest" });
}

init();
