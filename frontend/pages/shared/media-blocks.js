/**
 * VeteransLedger · Shared Media/Dossier Block Renderer
 * ES module — import with: import { renderBlock, renderDossierSection, attachMediaFallbacks, initAttributionModal } from '/pages/shared/media-blocks.js';
 *
 * Used by both Formations/record.js and Armaments/record.js so the two
 * archives render identical block types (text/quote/table/orbat/image/
 * gallery/map/document) and share one attribution-modal implementation
 * instead of each page reinventing it.
 */

const CONTENT_PLACEHOLDER = "/public/images/covers/placeholder-cards.webp";

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
function imageCaption(img) {
  const attrId = registerAttribution(img);
  return `
    <figcaption class="record-image-item__caption">
      ${img.caption || ""}
      <button type="button" class="attribution-trigger" data-attribution-id="${attrId}" aria-label="View source and attribution">
        <img src="/public/images/icons/ui/info.svg" alt="" aria-hidden="true">
      </button>
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
        const attrId = registerAttribution(img);
        return `
        <figure class="record-gallery__item">
          ${aiBadge(img)}
          <img src="${img.src}" alt="${img.caption || ""}" loading="lazy">
          <figcaption>
            ${img.caption || ""}
            <button type="button" class="attribution-trigger" data-attribution-id="${attrId}" aria-label="View source and attribution">
              <img src="/public/images/icons/ui/info.svg" alt="" aria-hidden="true">
            </button>
          </figcaption>
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

  const summaryPanel = `
    <dl class="record-meta-grid record-media-summary">
      <div class="record-meta-item"><dt>Photographs Available</dt><dd>${count}</dd></div>
      <div class="record-meta-item"><dt>Date Range</dt><dd>${dateRange}</dd></div>
      <div class="record-meta-item"><dt>Archives Represented</dt><dd>${archivesRepresented}</dd></div>
    </dl>`;

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

export function attachMediaFallbacks(root) {
  // Small classification markers (icons/shields/flags) — disappear cleanly
  // if the asset is ever missing, rather than showing a broken-image box.
  root.querySelectorAll(".record-card__icon").forEach((img) => {
    img.addEventListener("error", () => img.remove(), { once: true });
  });
  // Larger dossier content images (photos, scans, maps) — fall back to the
  // archive's standard "file not available" placeholder instead of just
  // vanishing, since a missing photo should still read as a labelled gap.
  root.querySelectorAll(".record-image-item__img, .record-gallery__item img, .record-document__img, .record-media-item img").forEach((img) => {
    img.addEventListener("error", () => { img.src = CONTENT_PLACEHOLDER; }, { once: true });
  });
}

// ── Attribution modal ───────────────────────────────────────────
// One shared modal per page, injected on first use. Surfaces the fields
// that don't belong inline in a caption — title, license, credit, archive,
// year — only when the visitor asks for them, instead of permanently
// printing a credit line under every image.
let _modalReady = false;

function buildModalRow(label, value, modifierClass) {
  if (!value) return "";
  const cls = modifierClass ? `attribution-modal__row ${modifierClass}` : "attribution-modal__row";
  return `<div class="${cls}"><dt>${label}</dt><dd>${value}</dd></div>`;
}

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

function openAttributionModal(id) {
  const data = _attributionRegistry.get(id);
  const overlay = document.getElementById("attribution-modal");
  const body = document.getElementById("attribution-modal-body");
  if (!data || !overlay || !body) return;

  const rows = [
    buildModalRow("Title", modalTitle(data)),
    buildModalRow("Description", data.description),
    buildModalRow("Historical Context", data.historical_context),
    buildModalRow("Type", modalTypeLabel(data)),
    buildModalRow("Historical Status", modalHistoricalStatus(data), "attribution-modal__row--status"),
    buildModalRow("Source", modalSource(data)),
    buildModalRow("License", modalLicense(data)),
    buildModalRow("Credit", data.credit),
    buildModalRow("Archive", data.archive),
    buildModalRow("Collection", data.collection),
    buildModalRow("Year", data.year),
    buildModalRow("Date", data.date),
    buildModalRow("Usage Rights", data.usage_rights),
    buildModalRow("Copyright Status", modalCopyrightStatus(data), "attribution-modal__row--status"),
    buildModalRow("Notes", modalNotes(data), "attribution-modal__row--status"),
    buildModalRow("Location", data.location),
    buildModalRow("Scale", data.scale),
    buildModalRow("Resolution", data.resolution),
    buildModalRow("Codec", data.codec),
    buildModalRow("File Size", data.file_size),
    buildModalRow("Manufacturer", data.manufacturer),
    buildModalRow("Language", data.language),
  ].join("");

  body.innerHTML = rows
    ? `<dl class="attribution-modal__list">${rows}</dl>`
    : `<p class="attribution-modal__empty">No additional source information available.</p>`;
  overlay.hidden = false;
}

function closeAttributionModal() {
  const overlay = document.getElementById("attribution-modal");
  if (overlay) overlay.hidden = true;
}

export function initAttributionModal() {
  if (_modalReady) return;
  _modalReady = true;

  document.body.insertAdjacentHTML("beforeend", `
    <div id="attribution-modal" class="modal-overlay" hidden aria-modal="true" role="dialog" aria-labelledby="attribution-modal-title">
      <div class="modal archive-modal attribution-modal">
        <div class="archive-modal__header">
          <span class="archive-modal__header-spacer" aria-hidden="true"></span>
          <div class="archive-modal__header-content">
            <h2 class="archive-modal__title" id="attribution-modal-title">Source &amp; Attribution</h2>
          </div>
          <button type="button" class="modal__close" id="attribution-modal-close" aria-label="Close">
            <img class="modal__close-icon" src="/public/images/icons/navigation/close.svg" alt="" aria-hidden="true" width="24" height="24">
          </button>
        </div>
        <div class="attribution-modal__body" id="attribution-modal-body"></div>
      </div>
    </div>`);

  const overlay = document.getElementById("attribution-modal");
  document.getElementById("attribution-modal-close").addEventListener("click", closeAttributionModal);
  overlay.addEventListener("click", (e) => { if (e.target === overlay) closeAttributionModal(); });
  document.addEventListener("keydown", (e) => { if (e.key === "Escape") closeAttributionModal(); });

  document.body.addEventListener("click", (e) => {
    const trigger = e.target.closest(".attribution-trigger");
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
    <div id="image-lightbox" class="lightbox-overlay" hidden role="dialog" aria-modal="true" aria-label="Image viewer">
      <button type="button" class="lightbox-close" id="lightbox-close" aria-label="Close image viewer">
        <img src="/public/images/icons/navigation/close.svg" alt="" aria-hidden="true" width="24" height="24">
      </button>
      <div class="lightbox-stage" id="lightbox-stage">
        <img class="lightbox-img" id="lightbox-img" src="" alt="" draggable="false">
      </div>
      <p class="lightbox-caption" id="lightbox-caption"></p>
    </div>`);

  const overlay = document.getElementById("image-lightbox");
  const stage = document.getElementById("lightbox-stage");
  const img = document.getElementById("lightbox-img");

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
