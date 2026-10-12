/**
 * VeteransLedger · Shared Media/Dossier Block Renderer
 * ES module — import with: import { renderBlock, renderDossierSection, attachMediaFallbacks, initAttributionModal } from '/pages/shared/media-blocks.js';
 *
 * Used by both Formations/record.js and Armaments/record.js so the two
 * archives render identical block types (text/quote/table/orbat/image/
 * gallery/map/document) and share one attribution-modal implementation
 * instead of each page reinventing it.
 */

import { applyUiStrings } from "./ui-strings.js";


// Every media item this module renders may carry a classification payload:
// { src, caption, title, description, historical_context, type,
//   historical_status, source, license, credit, archive, collection, year,
//   date, usage_rights, copyright_status, notes, is_ai_generated }.
// Only `caption` stays visible inline, as a short identifying label — every
// other field (including longer description/context text) only surfaces on
// demand through the attribution modal, keyed by an incrementing id rather
// than embedded as HTML attributes (avoids quote-escaping issues with
// historical text). The modal is the archive's single source of detailed
// provenance, so nothing here should duplicate what it already shows.
let _attributionSeq = 0;
const _attributionRegistry = new Map();

export function registerAttribution(img) {
  const id = String(_attributionSeq++);
  _attributionRegistry.set(id, img);
  return id;
}

// An image is "real" (eligible for Historical Photographs / as a default
// card-photo candidate) unless it's explicitly flagged otherwise — untagged
// legacy entries default to real so existing catalogued photos keep working.
export function isRealPhoto(img) {
  return !!img && (!img.type || img.type === "photograph") && !img.is_ai_generated;
}

export function isAiGenerated(img) {
  return !!img && !!(img.is_ai_generated || img.type === "ai_illustration");
}

function aiBadge(img) {
  return isAiGenerated(img)
    ? `<span class="media-ai-badge">Digital Reconstruction</span>`
    : "";
}

// Inline caption stays deliberately short — a plain identifying label only.
// Source/credit/license/year/etc. all live in the attribution modal now, so
// nothing here duplicates what a click on the info icon already reveals.
// The caption-side "Image record" control. Reads as archival apparatus —
// a specimen-plate mark and a letterspaced label — rather than a generic
// dashboard icon button, and states plainly what it opens. Rendered only
// when the panel has something to show, and the whole figcaption is
// dropped when there is neither a caption nor any attribution, because an
// empty caption bar under an image is noise rather than metadata.
// Markup for an already-registered attribution id. Exported so the pages
// that register their own entries (Armaments record/gallery panels) emit
// the identical control instead of keeping their own copy of this HTML.
export function attributionTriggerMarkup(attrId) {
  return `<button type="button" class="image-record-trigger" data-attribution-id="${attrId}" data-i18n-aria-label="attribution.viewAria" aria-label="View image record: source and attribution"><span class="image-record-trigger__mark" aria-hidden="true"></span><span class="image-record-trigger__label">Image record</span></button>`;
}

export function attributionTrigger(img) {
  if (!hasAttributionData(img)) return "";
  return attributionTriggerMarkup(registerAttribution(img));
}

function imageCaption(img) {
  const trigger = attributionTrigger(img);
  if (!img.caption && !trigger) return "";
  return `
    <figcaption class="record-image-item__caption">
      ${img.caption || ""}${trigger}
    </figcaption>`;
}

// Layout options: "left"/"right" float the image so following text wraps
// beside it; "wide" spans the full content width; default is a single
// constrained-width figure. Multiple images always become a side-by-side
// row regardless of the requested layout.
const IMAGE_LAYOUT_CLASS = {
  left: "record-image-left",
  right: "record-image-right",
  wide: "record-image-wide",
};

function renderImageBlock(block) {
  const images = block.images || [];
  if (!images.length) return "";
  const layoutClass = images.length > 1
    ? "record-image-row"
    : IMAGE_LAYOUT_CLASS[block.layout] || "record-image-single";

  return `
    ${block.title ? `<h3 class="record-block__title">${block.title}</h3>` : ""}
    <figure class="${layoutClass}">
      ${images.map((img) => `
        <div class="record-image-item">
          ${aiBadge(img)}
          <img class="record-image-item__img" src="${img.src}" alt="${img.caption || ""}" loading="lazy">
          ${imageCaption(img)}
        </div>`).join("")}
    </figure>`;
}

function renderGalleryBlock(block) {
  const images = block.images || [];
  if (!images.length) return "";
  return `
    ${block.title ? `<h3 class="record-block__title">${block.title}</h3>` : ""}
    <div class="record-gallery">
      ${images.map((img) => {
        const trigger = attributionTrigger(img);
        return `
        <figure class="record-gallery__item">
          ${aiBadge(img)}
          <img src="${img.src}" alt="${img.caption || ""}" loading="lazy">
          ${img.caption || trigger ? `<figcaption>${img.caption || ""}${trigger}</figcaption>` : ""}
        </figure>`;
      }).join("")}
    </div>`;
}

function renderDocumentBlock(block) {
  if (!block.image && !block.text) return "";
  return `
    ${block.title ? `<h3 class="record-block__title">${block.title}</h3>` : ""}
    <div class="record-document">
      ${block.image ? `
        <div class="record-document__imgwrap">
          ${aiBadge(block.image)}
          <img class="record-document__img" src="${block.image.src}" alt="${block.image.caption || ""}" loading="lazy">
        </div>` : ""}
      <div class="record-document__body">
        ${block.text ? `<div class="record-document__text">${block.text}</div>` : ""}
        ${block.image ? imageCaption(block.image) : ""}
      </div>
    </div>`;
}

// Each long-form section (Equipment, Orders, Maps, Field Reports,
// Propaganda, Order of Battle, Photographic Archive, Gallery, Blueprint
// Archive, Technical Drawings, etc.) holds an array of blocks. A block is
// one of: text, quote, table, orbat, image, gallery, map, document. This is
// intentionally generic so any future section can mix prose, scans, photos,
// and tables instead of plain text only.
export function renderBlock(block) {
  if (!block || !block.type) return "";
  switch (block.type) {
    case "text":
      return `
        ${block.title ? `<h3 class="record-block__title">${block.title}</h3>` : ""}
        <div class="record-section__body"><p>${block.text || ""}</p></div>`;

    case "quote":
      return `
        <blockquote class="record-block-quote">
          <p>${block.text || ""}</p>
          ${block.attribution ? `<cite>${block.attribution}</cite>` : ""}
        </blockquote>`;

    case "table":
      if (!block.rows || !block.rows.length) return "";
      return `
        ${block.title ? `<h3 class="record-block__title">${block.title}</h3>` : ""}
        <div class="record-table-wrap">
          <table class="record-table">
            ${block.headers ? `<thead><tr>${block.headers.map((h) => `<th>${h}</th>`).join("")}</tr></thead>` : ""}
            <tbody>${block.rows.map((row) => `<tr>${row.map((cell) => `<td>${cell}</td>`).join("")}</tr>`).join("")}</tbody>
          </table>
        </div>`;

    case "orbat":
      if (!block.rows || !block.rows.length) return "";
      return `
        ${block.title ? `<h3 class="record-block__title">${block.title}</h3>` : ""}
        <div class="record-table-wrap">
          <table class="record-table record-orbat">
            <thead><tr><th>Unit</th><th>Type</th><th>Commander</th><th>Strength</th></tr></thead>
            <tbody>
              ${block.rows.map((r) => `<tr><td>${r.unit || ""}</td><td>${r.type || ""}</td><td>${r.commander || ""}</td><td>${r.strength || ""}</td></tr>`).join("")}
            </tbody>
          </table>
        </div>`;

    case "image":
      return renderImageBlock(block);

    case "gallery":
      return renderGalleryBlock(block);

    case "map":
      return block.image ? renderImageBlock({ title: block.title, layout: "wide", images: [block.image] }) : "";

    case "document":
      return renderDocumentBlock(block);

    default:
      return "";
  }
}

// Renders a dossier section only when it actually has content — these
// sections stay out of the page entirely for records that don't have this
// material catalogued yet, rather than padding every record with empty
// placeholder boxes. This is the single mechanism behind every "appears
// only when media exists" section on both Formations and Armaments pages.
export function renderDossierSection(title, blocks) {
  if (!blocks || !blocks.length) return "";
  return `
    <section class="record-section">
      <h2 class="record-section__title">${title}</h2>
      ${blocks.map((b) => `<div class="record-block">${renderBlock(b)}</div>`).join("")}
    </section>`;
}

function imagesFromBlock(block) {
  if (block.images && block.images.length) return block.images;
  if (block.image) return [block.image];
  return [];
}

// Pulls a 4-digit year out of a year/date string so mixed formats
// ("1943", "1943-06", "June 1943") still sort and range correctly.
function extractYear(value) {
  const match = String(value).match(/\d{4}/);
  return match ? parseInt(match[0], 10) : null;
}

function summarizeRealPhotos(images) {
  const years = images.map((i) => extractYear(i.year || i.date)).filter((y) => y != null);
  const archives = [...new Set(images.map((i) => i.archive).filter(Boolean))];
  let dateRange = "—";
  if (years.length) {
    const min = Math.min(...years), max = Math.max(...years);
    dateRange = min === max ? String(min) : `${min}–${max}`;
  }
  return {
    count: images.length,
    dateRange,
    archivesRepresented: archives.length ? archives.join(", ") : "—",
  };
}

// Historical Photographs is the one dossier section that always renders,
// with or without media — every Armament record gets the same archival
// framework (summary panel + gallery-or-empty-state) so the archive never
// looks unfinished. It's also the one section that must never contain
// AI-generated material, even if a block was mis-filed there — filtering by
// the image's own classification rather than trusting where it was placed
// means a future mistake can't surface as a "real" wartime photo.
export function renderHistoricalPhotographsSection(title, blocks) {
  const allImages = (blocks || []).flatMap(imagesFromBlock);
  const realPhotos = allImages.filter(isRealPhoto);
  const { count, dateRange, archivesRepresented } = summarizeRealPhotos(realPhotos);

  // The summary only describes photographs that actually exist. With none
  // catalogued it is dropped entirely rather than printing "0 / — / —",
  // and individual rows are omitted when that fact isn't documented, so the
  // panel never pads itself with placeholder dashes.
  const summaryRows = [
    ["Photographs Available", String(count)],
    ["Date Range", dateRange !== "—" ? dateRange : null],
    ["Archives Represented", archivesRepresented !== "—" ? archivesRepresented : null],
  ].filter(([, v]) => v);

  const summaryPanel = count
    ? `
    <dl class="record-meta-grid record-media-summary">
      ${summaryRows.map(([label, value]) => `<div class="record-meta-item"><dt>${label}</dt><dd>${value}</dd></div>`).join("")}
    </dl>`
    : "";

  const body = count
    ? renderGalleryBlock({ images: realPhotos })
    : `
      <div class="record-media-empty">
        <p class="record-media-empty__text">No historical photographs have been catalogued for this record yet.</p>
        <p class="record-media-empty__note">This section remains available for future archival additions.</p>
      </div>`;

  return `
    <section class="record-section">
      <h2 class="record-section__title">${title}</h2>
      ${summaryPanel}
      ${body}
    </section>`;
}

const VISUAL_DOSSIER_KEYS = ["photos", "combat_photos", "blueprints", "diagrams", "documents"];

function dossierImages(dossier, keys) {
  const out = [];
  for (const key of keys) {
    const blocks = dossier?.[key];
    if (!blocks) continue;
    for (const b of blocks) out.push(...imagesFromBlock(b));
  }
  return out;
}

// Card thumbnail priority: a real catalogued photo, then a labelled AI
// illustration, then the placeholder — blueprints/diagrams/documents are
// deliberately excluded here so listing cards stay photographic rather than
// showing a schematic, even when that's the only media a record has.
export function cardImageCandidates(item, placeholder) {
  const dossier = item.dossier || {};
  const realPhotos = dossierImages(dossier, ["photos", "combat_photos"]).filter(isRealPhoto).map((i) => i.src);
  const aiIllustrations = dossierImages(dossier, VISUAL_DOSSIER_KEYS).filter(isAiGenerated).map((i) => i.src);
  const candidates = [item.image, ...realPhotos, ...aiIllustrations].filter(Boolean);
  if (placeholder) candidates.push(placeholder);
  return [...new Set(candidates)];
}

// Record hero priority: explicit image, real photo, technical drawing,
// AI illustration, then the placeholder as the last resort.
export function heroImageCandidates(item, placeholder) {
  const dossier = item.dossier || {};
  const realPhotos = dossierImages(dossier, ["photos", "combat_photos"]).filter(isRealPhoto).map((i) => i.src);
  const technical = dossierImages(dossier, ["blueprints", "diagrams"]).map((i) => i.src);
  const aiAny = dossierImages(dossier, VISUAL_DOSSIER_KEYS).filter(isAiGenerated).map((i) => i.src);
  const candidates = [item.image, ...realPhotos, ...technical, ...aiAny].filter(Boolean);
  if (placeholder) candidates.push(placeholder);
  return [...new Set(candidates)];
}

// A hero or card candidate can resolve to an AI-generated image (the spec
// allows it as a last resort before the placeholder, on both the record
// hero and listing cards) — this lets those renderers know to badge it,
// since their plain <img> tags don't go through renderImageBlock's normal
// AI-badge path the way dossier sections do.
export function isAiGeneratedImageSrc(item, src) {
  const dossier = item.dossier || {};
  return dossierImages(dossier, VISUAL_DOSSIER_KEYS).some((i) => i.src === src && isAiGenerated(i));
}

// A restrained, neutral stand-in for an image that failed to load. Replaces
// the <img> entirely rather than swapping in a large illustrated
// "file not available" graphic, which overwhelmed the record content and was
// itself not an archival image. Styling lives in record.css and follows the
// existing dark archival palette.
export function missingMediaElement(label) {
  const el = document.createElement("div");
  el.className = "record-media-missing";
  el.setAttribute("role", "img");
  el.setAttribute("aria-label", label || "Image not available");
  el.innerHTML = `<span class="record-media-missing__label">Image not available</span>`;
  return el;
}

// Delegated, page-wide replacement for the per-page inline
// `onerror="this.src='...placeholder-cards.webp'"` handlers that each record
// page used to carry. Any <img data-missing-fallback> anywhere on the page
// becomes the neutral missing-media block when it fails to load, so every
// content type shares one behaviour instead of five near-copies. Registered
// in the capture phase because `error` does not bubble.
let _missingFallbackReady = false;

export function initMissingMediaFallback() {
  if (_missingFallbackReady) return;
  _missingFallbackReady = true;
  document.addEventListener("error", (e) => {
    const img = e.target;
    if (!(img instanceof HTMLImageElement)) return;
    if (!img.hasAttribute("data-missing-fallback")) return;
    img.replaceWith(missingMediaElement(img.alt));
  }, true);
}

export function attachMediaFallbacks(root) {
  // Small classification markers (icons/shields/flags) — disappear cleanly
  // if the asset is ever missing, rather than showing a broken-image box.
  root.querySelectorAll(".record-card__icon").forEach((img) => {
    img.addEventListener("error", () => img.remove(), { once: true });
  });
  // Larger dossier content images (photos, scans, maps) — swapped for the
  // neutral missing-media block so a gap still reads as a labelled absence
  // without a broken-image icon and without dominating the record.
  root.querySelectorAll(".record-image-item__img, .record-gallery__item img, .record-document__img, .record-media-item img").forEach((img) => {
    img.addEventListener("error", () => {
      img.replaceWith(missingMediaElement(img.alt));
    }, { once: true });
  });
}

// ── Attribution modal ───────────────────────────────────────────
// One shared modal per page, injected on first use. Surfaces the fields
// that don't belong inline in a caption — title, license, credit, archive,
// year — only when the visitor asks for them, instead of permanently
// printing a credit line under every image.
let _modalReady = false;

function titleCase(s) {
  return String(s).replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

// The inline caption already identifies the image, so the modal only adds a
// Title row when there's something genuinely beyond that — a fuller
// description distinct from the short caption. Otherwise it would just
// repeat the exact text already sitting right below the thumbnail.
function modalTitle(data) {
  if (data.title && data.title !== data.caption) return data.title;
  return null;
}

// Type reflects the image's own content category (Photograph/Blueprint/
// Diagram/etc) for real media. AI-generated content always gets the explicit
// "Digital Reconstruction" label instead, regardless of any content-category
// type it was also tagged with, so it can never read as a plain photograph.
function modalTypeLabel(data) {
  if (isAiGenerated(data)) return "Digital Reconstruction";
  return data.type ? titleCase(data.type) : null;
}

function modalSource(data) {
  if (data.source) return data.source;
  return isAiGenerated(data) ? "AI Generated Illustration" : null;
}

// Historical Status uses the archive's standard provenance labels (Original
// Historical Photograph, Public Domain Historical Photograph, Licensed
// Historical Photograph, Archive Scan, Technical Blueprint, Modern Technical
// Illustration). AI content always gets "Modern Reconstruction" even if the
// data didn't set one explicitly, so it can never be mistaken for an
// original wartime item.
function modalHistoricalStatus(data) {
  if (data.historical_status) return data.historical_status;
  return isAiGenerated(data) ? "Modern Reconstruction" : null;
}

// License uses the archive's standard licensing labels (Public Domain,
// CC BY, CC BY-SA, Professional License, Archive Permission, Rights
// Reserved, AI Generated Illustration).
function modalLicense(data) {
  if (data.license) return data.license;
  return isAiGenerated(data) ? "AI Generated Illustration" : null;
}

function modalNotes(data) {
  if (data.notes) return data.notes;
  return isAiGenerated(data)
    ? "Illustrative reconstruction created for educational purposes. Not an original wartime photograph."
    : null;
}

// Copyright Status is the plain-English summary a visitor actually wants —
// "can I trust/use this, and why" — derived from the formal License value
// (or an explicit override) so the archive never needs to maintain the same
// fact in two places.
const LICENSE_TO_COPYRIGHT_STATUS = {
  "Public Domain": "Public Domain",
  "Creative Commons": "Licensed (Creative Commons)",
  "Professional License": "Licensed (Professional License)",
  "Archive Permission": "Archive-Authorized Use",
  "Rights Reserved": "Rights Reserved",
  "AI Generated Illustration": "AI-Generated — No Traditional Copyright Claim",
};

function modalCopyrightStatus(data) {
  if (data.copyright_status) return data.copyright_status;
  const license = modalLicense(data);
  if (license && LICENSE_TO_COPYRIGHT_STATUS[license]) return LICENSE_TO_COPYRIGHT_STATUS[license];
  if (license) return license;
  return isAiGenerated(data) ? "AI-Generated — No Traditional Copyright Claim" : null;
}

// Single source of truth for what the modal would show. Returns [label,
// value, modifier] triples for every row that has a real value — nothing is
// invented here, each entry either comes straight from the image's own data
// or from an explicit AI-content label derived from is_ai_generated.
// hasAttributionData() reuses this so the info trigger can be hidden when
// opening the modal would only produce "no information available".
const hasValue = (v) => v != null && String(v).trim() !== "";

// Splits an image's metadata into the three shapes the panel actually
// renders, instead of flattening everything into identical table rows:
//
//   prose  — long-form text that wants a reading measure (description,
//            historical context, notes)
//   facts  — short catalogue values that read best as a dense plate of
//            label/value pairs (type, source, credit, license, year…)
//   status — the provenance line, surfaced as a marker rather than a row,
//            with `verified` false whenever the archive's own wording says
//            the source has not been confirmed. Nothing is inferred beyond
//            that: an absent status stays absent.
function attributionModel(data) {
  const prose = [
    ["Description", data.description],
    ["Historical Context", data.historical_context],
    ["Notes", modalNotes(data)],
  ].filter(([, v]) => hasValue(v));

  const facts = [
    ["Type", modalTypeLabel(data)],
    ["Original Source", modalSource(data)],
    ["Creator", data.credit],
    ["Archive", data.archive],
    ["Collection", data.collection],
    ["Year", data.year],
    ["Date", data.date],
    ["License", modalLicense(data)],
    ["Copyright", modalCopyrightStatus(data)],
    ["Usage Rights", data.usage_rights],
    ["Location", data.location],
    ["Scale", data.scale],
    ["Resolution", data.resolution],
    ["Codec", data.codec],
    ["File Size", data.file_size],
    ["Manufacturer", data.manufacturer],
    ["Language", data.language],
  ].filter(([, v]) => hasValue(v));

  const status = modalHistoricalStatus(data);
  const verified = hasValue(status) && !/unverified|pending|unconfirmed/i.test(String(status));

  return { title: modalTitle(data) || data.caption || null, prose, facts, status, verified };
}

// Flat view of everything the panel would show — the single test for
// "is there anything here at all", used to decide whether the trigger
// renders in the first place.
function attributionRows(data) {
  const m = attributionModel(data);
  return [...m.prose, ...m.facts, ...(hasValue(m.status) ? [["Historical Status", m.status]] : [])];
}

// True when the modal would show at least one row. Used to suppress the
// info trigger entirely on images that carry nothing beyond src/caption,
// so a visitor is never offered a button that opens an empty panel.
export function hasAttributionData(img) {
  return !!img && attributionRows(img).length > 0;
}

let _lastFocused = null;

function openAttributionModal(id) {
  const data = _attributionRegistry.get(id);
  const overlay = document.getElementById("attribution-modal");
  const body = document.getElementById("attribution-modal-body");
  if (!data || !overlay || !body) return;

  const { title, prose, facts, status, verified } = attributionModel(data);

  // Provenance reads as a marker, not another row — and says plainly
  // whether the archive has confirmed the source. Absent status stays
  // absent rather than being filled in with a guess.
  const provenance = hasValue(status)
    ? `<p class="image-record__provenance image-record__provenance--${verified ? "verified" : "unverified"}">
         <span class="image-record__provenance-mark" aria-hidden="true"></span>
         <span>${status}</span>
       </p>`
    : "";

  const proseHtml = prose.map(([label, value]) => `
    <section class="image-record__note">
      <h3 class="image-record__note-label">${label}</h3>
      <p class="image-record__note-text">${value}</p>
    </section>`).join("");

  // Short values become a dense catalogue plate — one grid, tiny gold
  // labels — instead of a column of near-identical bordered rows.
  const plateHtml = facts.length
    ? `<dl class="image-record__plate">
        ${facts.map(([label, value]) => `
          <div class="image-record__cell">
            <dt>${label}</dt>
            <dd>${value}</dd>
          </div>`).join("")}
       </dl>`
    : "";

  body.innerHTML = (proseHtml || plateHtml || provenance)
    ? `<div class="image-record">
         ${title ? `<p class="image-record__caption">${title}</p>` : ""}
         ${provenance}
         ${proseHtml}
         ${plateHtml}
       </div>`
    : `<p class="image-record__empty">No additional source information has been catalogued for this image.</p>`;

  _lastFocused = document.activeElement;
  overlay.hidden = false;
  document.getElementById("attribution-modal-close")?.focus();
}

function closeAttributionModal() {
  const overlay = document.getElementById("attribution-modal");
  if (!overlay || overlay.hidden) return;
  overlay.hidden = true;
  // Return focus to whatever opened the panel so keyboard users land back
  // beside the image they were inspecting rather than at the top of the page.
  if (_lastFocused && document.contains(_lastFocused)) _lastFocused.focus();
  _lastFocused = null;
}

// Keeps Tab inside the open panel. Without this, tabbing walks out into the
// page behind the overlay while the dialog is still showing.
function trapAttributionFocus(e) {
  const overlay = document.getElementById("attribution-modal");
  if (!overlay || overlay.hidden || e.key !== "Tab") return;
  const focusable = overlay.querySelectorAll('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])');
  if (!focusable.length) return;
  const first = focusable[0];
  const last = focusable[focusable.length - 1];
  if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
  else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
}

export function initAttributionModal() {
  if (_modalReady) return;
  _modalReady = true;

  applyUiStrings(document.body); // patch attribution-trigger buttons already rendered
  document.body.insertAdjacentHTML("beforeend", `
    <div id="attribution-modal" class="modal-overlay" hidden aria-modal="true" role="dialog" aria-labelledby="attribution-modal-title">
      <div class="modal archive-modal attribution-modal">
        <div class="archive-modal__header">
          <span class="archive-modal__header-spacer" aria-hidden="true"></span>
          <div class="archive-modal__header-content">
            <h2 class="archive-modal__title" id="attribution-modal-title">Image Record</h2>
          </div>
          <button type="button" class="modal__close" id="attribution-modal-close" data-i18n-aria-label="attribution.closeAria" aria-label="Close">
            <span class="icon-close modal__close-icon" aria-hidden="true"></span>
          </button>
        </div>
        <div class="attribution-modal__body" id="attribution-modal-body"></div>
      </div>
    </div>`);

  const overlay = document.getElementById("attribution-modal");
  applyUiStrings(overlay);
  document.getElementById("attribution-modal-close").addEventListener("click", closeAttributionModal);
  overlay.addEventListener("click", (e) => { if (e.target === overlay) closeAttributionModal(); });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") closeAttributionModal();
    trapAttributionFocus(e);
  });

  // Matches both the current control and the legacy icon-button class, so
  // any page still emitting the old markup keeps working.
  document.body.addEventListener("click", (e) => {
    const trigger = e.target.closest(".image-record-trigger, .attribution-trigger");
    if (trigger) openAttributionModal(trigger.dataset.attributionId);
  });
}

// ── Image lightbox ──────────────────────────────────────────────
// One shared full-screen viewer per page, injected on first use. Lets a
// visitor inspect any historical photograph, blueprint, or document at full
// size — with wheel-zoom and click-drag panning — without ever leaving the
// page or opening a new tab. Targets the same image classes every dossier
// section already renders, so this applies everywhere those classes are
// used (Historical Photographs, Blueprint Archive, Technical Drawings,
// Documents & Manuals, Gallery) with no per-section wiring required.
let _lightboxReady = false;
let _lbScale = 1, _lbX = 0, _lbY = 0, _lbDragging = false, _lbStartX = 0, _lbStartY = 0;

const LIGHTBOX_MIN_SCALE = 1;
const LIGHTBOX_MAX_SCALE = 4;
const LIGHTBOX_ZOOM_STEP = 0.25;
const LIGHTBOX_DOUBLE_TAP_SCALE = 2.5;

function lightboxApplyTransform() {
  const img = document.getElementById("lightbox-img");
  const stage = document.getElementById("lightbox-stage");
  if (!img) return;
  img.style.transform = `translate(${_lbX}px, ${_lbY}px) scale(${_lbScale})`;
  if (stage) stage.style.cursor = _lbScale > 1 ? "grab" : "zoom-in";
}

function openImageLightbox(src, caption) {
  const overlay = document.getElementById("image-lightbox");
  const img = document.getElementById("lightbox-img");
  const cap = document.getElementById("lightbox-caption");
  if (!overlay || !img) return;
  _lbScale = 1; _lbX = 0; _lbY = 0;
  img.src = src;
  img.alt = caption || "";
  if (cap) {
    cap.textContent = caption || "";
    cap.hidden = !caption;
  }
  lightboxApplyTransform();
  overlay.hidden = false;
}

function closeImageLightbox() {
  const overlay = document.getElementById("image-lightbox");
  if (overlay) overlay.hidden = true;
  _lbDragging = false;
}

export function initImageLightbox() {
  if (_lightboxReady) return;
  _lightboxReady = true;

  document.body.insertAdjacentHTML("beforeend", `
    <div id="image-lightbox" class="lightbox-overlay" hidden role="dialog" aria-modal="true" data-i18n-aria-label="lightbox.viewerAria" aria-label="Image viewer">
      <button type="button" class="lightbox-close" id="lightbox-close" data-i18n-aria-label="lightbox.closeAria" aria-label="Close image viewer">
        <span class="icon-close" aria-hidden="true"></span>
      </button>
      <div class="lightbox-stage" id="lightbox-stage">
        <img class="lightbox-img" id="lightbox-img" src="" alt="" draggable="false">
      </div>
      <p class="lightbox-caption" id="lightbox-caption"></p>
    </div>`);

  const overlay = document.getElementById("image-lightbox");
  const stage = document.getElementById("lightbox-stage");
  const img = document.getElementById("lightbox-img");

  applyUiStrings(overlay);
  document.getElementById("lightbox-close").addEventListener("click", closeImageLightbox);
  overlay.addEventListener("click", (e) => { if (e.target === overlay) closeImageLightbox(); });
  document.addEventListener("keydown", (e) => { if (e.key === "Escape" && !overlay.hidden) closeImageLightbox(); });

  // Wheel to zoom, clamped, recentring on 1x so a fully zoomed-out image
  // never drifts off-stage.
  stage.addEventListener("wheel", (e) => {
    if (overlay.hidden) return;
    e.preventDefault();
    const delta = e.deltaY < 0 ? LIGHTBOX_ZOOM_STEP : -LIGHTBOX_ZOOM_STEP;
    _lbScale = Math.min(LIGHTBOX_MAX_SCALE, Math.max(LIGHTBOX_MIN_SCALE, _lbScale + delta));
    if (_lbScale === LIGHTBOX_MIN_SCALE) { _lbX = 0; _lbY = 0; }
    lightboxApplyTransform();
  }, { passive: false });

  // Double-click/tap toggles between fit and a fixed zoom level — the
  // quickest way to inspect detail without reaching for the wheel.
  img.addEventListener("dblclick", () => {
    _lbScale = _lbScale > LIGHTBOX_MIN_SCALE ? LIGHTBOX_MIN_SCALE : LIGHTBOX_DOUBLE_TAP_SCALE;
    _lbX = 0; _lbY = 0;
    lightboxApplyTransform();
  });

  // Pan only once zoomed in — at 1x the image is fully visible already, so
  // dragging has nothing useful to do.
  img.addEventListener("pointerdown", (e) => {
    if (_lbScale <= LIGHTBOX_MIN_SCALE) return;
    _lbDragging = true;
    _lbStartX = e.clientX - _lbX;
    _lbStartY = e.clientY - _lbY;
    img.setPointerCapture(e.pointerId);
  });
  img.addEventListener("pointermove", (e) => {
    if (!_lbDragging) return;
    _lbX = e.clientX - _lbStartX;
    _lbY = e.clientY - _lbStartY;
    lightboxApplyTransform();
  });
  const endLightboxDrag = () => { _lbDragging = false; };
  img.addEventListener("pointerup", endLightboxDrag);
  img.addEventListener("pointercancel", endLightboxDrag);

  // Delegated so it works for every image any dossier section renders, now
  // or in the future, without each one needing its own listener.
  document.body.addEventListener("click", (e) => {
    if (e.target.closest(".attribution-trigger")) return;
    const clicked = e.target.closest(".record-image-item__img, .record-gallery__item img, .record-document__img, .record-media-item img");
    if (clicked) openImageLightbox(clicked.src, clicked.alt);
  });
}
