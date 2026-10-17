/**
 * VeteransLedger · Letters page
 * Loads letter collections, normalises dual schemas, renders list + inline viewer.
 * Collection definitions loaded from letters/index.json — no hardcoded arrays.
 * Pagination: 12 letters per page; preserved when filter changes.
 */

import { createPaginator } from "/pages/shared/paginator.js";
import { resolveRelatedUrl } from "/pages/shared/related-url-resolver.js";
import { applyRecordTranslation, loadManifestTranslatedVersioned } from "/pages/shared/translation-loader.js";
import { createContentSession, renderContentError } from "/pages/shared/content-fetch.js";
import { onLocaleChange } from "/pages/shared/i18n.js";
import { applyUiStrings, t } from "/pages/shared/ui-strings.js";

let COLLECTIONS = [];

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

// One session per page load: the index is fetched once and every collection
// file is pinned to the version that index came from. The manifest still
// goes through the translation loader, so translated labels apply; the
// version pinned is the English source's, which is what the server served.
const content = createContentSession("/public/data/letters/index.json", {
  loadIndex: (url) => loadManifestTranslatedVersioned(url, "letters/index.json"),
});

const COLLECTIONS_FALLBACK = [
  { id: "german",     label: "German",     file: "german.json" },
  { id: "italian",    label: "Italian",    file: "italian.json" },
  { id: "japanese",   label: "Japanese",   file: "japanese.json" },
  { id: "volunteers", label: "Volunteers", file: "volunteers.json" },
  { id: "british",    label: "British",    file: "british.json" },
  { id: "polish",     label: "Polish",     file: "polish.json" },
];

/** Collections as one particular manifest describes them. */
function collectionsFrom(manifest) {
  const cols = (manifest?.collections ?? []).map((c) => ({
    id:   c.id,
    label: c.label,
    file: String(c.file ?? "").replace("/public/data/letters/", ""),
  }));
  return cols.length ? cols : COLLECTIONS_FALLBACK;
}

async function loadManifest() {
  COLLECTIONS = collectionsFrom((await content.index()).data);
}

function renderCollectionFilter() {
  const bar = document.querySelector(".filter-bar");
  if (!bar || !COLLECTIONS.length) return;
  bar.innerHTML =
    `<button type="button" class="filter-btn${activeLang === "all" ? " is-active" : ""}" data-lang="all">${t("search.filter.all", null, "All")}</button>` +
    COLLECTIONS.map((c) => `<button type="button" class="filter-btn${activeLang === c.id ? " is-active" : ""}" data-lang="${c.id}">${c.label}</button>`).join("");
}

async function init() {
  await loadManifest();
  renderCollectionFilter();

  // The collection list is re-derived inside the load, so if the session has
  // to reload a newer index the file list reloads with it rather than
  // replaying a stale one. Promise.all rather than allSettled: the only
  // rejection a record fetch produces is a pruned version, which must reach
  // the session.
  try {
    allLetters = await content.load(async (manifest, record) => {
      const cols = collectionsFrom(manifest);
      COLLECTIONS = cols;
      renderCollectionFilter();

      const loaded = await Promise.all(
        cols.map((c) =>
          record(`/public/data/letters/${c.file}`).then((data) => {
            const letters = Array.isArray(data) ? data : data?.letters || [];
            return letters.map((l) => normalise({ ...l, _lang: c.id }));
          }),
        ),
      );
      return loaded.flat();
    });
  } catch (err) {
    renderContentError(listEl, err);
    return;
  }

  document.querySelector(".filter-bar")?.addEventListener("click", (e) => {
    const btn = e.target.closest(".filter-btn");
    if (!btn) return;
    activeLang = btn.dataset.lang || "all";
    document.querySelectorAll(".filter-btn")
      .forEach((b) => b.classList.toggle("is-active", b === btn));
    updatePaginator();
  });

  buildPaginator();

  onLocaleChange(async () => {
    // Re-read the index so the new locale's translated labels apply. That
    // also re-pins to whatever version is active now, which is correct here
    // because no record requests are in flight at this point.
    content.invalidate();
    await loadManifest();
    renderCollectionFilter();
  });
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
      <p class="empty-state__title" data-i18n="empty.letters.title">No letters found</p>
      <p class="empty-state__text" data-i18n="empty.letters.text">This collection is being compiled.</p>
    </div>`;
    applyUiStrings(listEl);
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
      ${letter.id ? `<a class="letter-card__deep-link" href="${resolveRelatedUrl("Letter", letter.id)}" style="display:inline-flex;align-items:center;gap:4px;margin-top:8px;font-size:11px;color:var(--gold-dim);text-decoration:none;letter-spacing:0.06em;" onclick="event.stopPropagation()"><span data-i18n="letters.readFullLetter">Read full letter</span> <span class="icon-svg icon-svg--arrow-right icon-svg--sm" aria-hidden="true"></span></a>` : ""}`;
    applyUiStrings(card);

    card.addEventListener("click", () => openLetter(letter));
    card.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === " ") { e.preventDefault(); openLetter(letter); }
    });
    listEl.appendChild(card);

    const translateId = letter.recordId || letter.id;
    if (translateId) {
      card.dataset.translateId = translateId;
      applyRecordTranslation(card, "record", translateId, {
        titleSelector: ".letter-card__from",
        summarySelector: ".letter-card__excerpt",
      });
    }
  });
}

onLocaleChange(() => {
  document.querySelectorAll(".letter-card[data-translate-id]").forEach((card) => {
    applyRecordTranslation(card, "record", card.dataset.translateId, {
      titleSelector: ".letter-card__from",
      summarySelector: ".letter-card__excerpt",
    });
  });
});

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
    ${letter.id ? `<a href="${resolveRelatedUrl("Letter", letter.id)}" style="display:inline-flex;align-items:center;gap:5px;margin-top:var(--space-4);font-size:var(--text-xs);color:var(--gold);text-decoration:none;letter-spacing:0.06em;"><span data-i18n="letters.readFullRecord">Read full record with sources</span> <span class="icon-svg icon-svg--arrow-right icon-svg--sm" aria-hidden="true"></span></a>` : ""}`;
  applyUiStrings(viewerEl);

  viewerEl.scrollIntoView({ behavior: "smooth", block: "nearest" });
}

init();
