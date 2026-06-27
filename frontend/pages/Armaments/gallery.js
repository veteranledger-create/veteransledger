/**
 * VeteransLedger · Armament media gallery page (/armaments/:id/gallery)
 * Renders a tabbed full-media viewer for gallery images, blueprints, videos, and documents.
 */

import { attachMediaFallbacks, initAttributionModal, initImageLightbox, registerAttribution } from "/pages/shared/media-blocks.js";

const CATEGORIES_FALLBACK = ["panzer", "aircraft", "naval", "missiles", "wunderwaffen", "equipment"];
const NATIONS_FALLBACK = ["germany", "italy", "japan", "other-axis"];

const DOC_TYPE_LABELS = {
  pdf_manual: "PDF Manual",
  technical_document: "Technical Document",
  crew_manual: "Crew Manual",
  field_manual: "Field Manual",
  original_document: "Original Document",
};

let manifestPromise = null;
async function loadManifest() {
  if (!manifestPromise) {
    manifestPromise = fetch("/public/data/armaments/index.json")
      .then((r) => (r.ok ? r.json() : null))
      .catch(() => null);
  }
  return manifestPromise;
}

async function findArmament(id) {
  const manifest = await loadManifest();
  const pairs = manifest?.categories?.flatMap(
    (cat) => (cat.nations || []).map((nation) => [cat.id, nation]),
  ) ?? CATEGORIES_FALLBACK.flatMap((cat) => NATIONS_FALLBACK.map((nation) => [cat, nation]));

  for (const [cat, nation] of pairs) {
    try {
      const res = await fetch(`/public/data/armaments/${cat}/${nation}.json`);
      if (!res.ok) continue;
      const data = await res.json();
      const arr = Array.isArray(data) ? data : data?.armaments || data?.items || [];
      const item = arr.find((a) => a.id === id);
      if (item) return { ...item, _category: cat, _nation: nation };
    } catch (_) {}
  }
  return null;
}

function attrInfoBtn(attrId) {
  return `<button type="button" class="attribution-trigger" data-attribution-id="${attrId}" aria-label="View source and attribution"><img src="/public/images/icons/ui/info.svg" alt="" aria-hidden="true"></button>`;
}

function renderImagePanel(items, modifier = "", isBlueprint = false) {
  if (!items || !items.length) {
    return `<p class="armament-gallery-empty">No items in this collection.</p>`;
  }
  return `
    <p class="armament-gallery-count">${items.length} item${items.length !== 1 ? "s" : ""}</p>
    <div class="armament-gallery-grid">
      ${items.map((g) => {
        const attrId = isBlueprint
          ? registerAttribution({
              src: g.file, title: g.title, description: g.caption,
              source: g.source, credit: g.photographer, archive: g.archive,
              license: g.license, date: g.capture_date, location: g.location,
              scale: g.scale, notes: g.notes,
            })
          : registerAttribution({
              src: g.file, title: g.title, description: g.caption,
              source: g.source, credit: g.photographer, archive: g.archive,
              license: g.license, date: g.capture_date, location: g.location,
              resolution: g.resolution, notes: g.notes,
            });
        return `
        <figure class="armament-gallery-figure${modifier}">
          <img src="${g.file}" alt="${g.caption || g.title || ""}" loading="lazy">
          <figcaption class="armament-gallery-figcaption">
            <div>
              ${g.title ? `<strong>${g.title}</strong>` : ""}
              ${g.caption ? `<span>${g.caption}</span>` : ""}
              ${g.source ? `<span class="armament-gallery-source">${g.source}</span>` : ""}
            </div>
            ${attrInfoBtn(attrId)}
          </figcaption>
        </figure>`;
      }).join("")}
    </div>`;
}

function renderVideoPanel(items) {
  if (!items || !items.length) {
    return `<p class="armament-gallery-empty">No footage in this collection.</p>`;
  }
  return `
    <p class="armament-gallery-count">${items.length} item${items.length !== 1 ? "s" : ""}</p>
    <div class="armament-gallery-grid">
      ${items.map((v) => {
        const attrId = registerAttribution({
          src: v.file, title: v.title, description: v.caption,
          archive: v.archive, license: v.license, codec: v.codec,
          resolution: v.resolution, file_size: v.file_size,
          location: v.location, notes: v.notes,
        });
        return `
        <figure class="armament-gallery-figure">
          <video class="armament-gallery-video-player" controls preload="metadata"${v.thumbnail ? ` poster="${v.thumbnail}"` : ""}>
            <source src="${v.file}">
            <p>Your browser does not support HTML5 video.</p>
          </video>
          <figcaption class="armament-gallery-figcaption">
            <div>
              ${v.title ? `<strong>${v.title}</strong>` : ""}
              ${v.duration ? `<span class="armament-gallery-duration">${v.duration}</span>` : ""}
              ${v.caption ? `<span>${v.caption}</span>` : ""}
            </div>
            ${attrInfoBtn(attrId)}
          </figcaption>
        </figure>`;
      }).join("")}
    </div>`;
}

function renderDocumentPanel(docs) {
  if (!docs || !docs.length) {
    return `<p class="armament-gallery-empty">No documents in this collection.</p>`;
  }
  return `
    <p class="armament-gallery-count">${docs.length} document${docs.length !== 1 ? "s" : ""}</p>
    <ul class="record-documents-list">
      ${docs.map((d) => {
        const typeLabel = DOC_TYPE_LABELS[d.type] || d.type || "Document";
        const meta = [d.language, d.size, d.archive].filter(Boolean).join(" · ");
        return `
        <li class="record-document-item">
          <div class="record-document-item__icon" aria-hidden="true">
            <img src="/public/images/icons/ui/file.svg" alt="" width="24" height="24">
          </div>
          <div class="record-document-item__body">
            <span class="record-document-item__type">${typeLabel}</span>
            <a class="record-document-item__title" href="${d.file}" target="_blank" rel="noopener noreferrer">${d.title || "Untitled Document"}</a>
            ${d.caption ? `<p class="record-document-item__caption">${d.caption}</p>` : ""}
            ${meta ? `<p class="record-document-item__meta">${meta}</p>` : ""}
            ${d.license ? `<p class="record-document-item__meta">${d.license}</p>` : ""}
          </div>
          <a class="record-document-item__download" href="${d.file}" download target="_blank" rel="noopener noreferrer" aria-label="Download ${d.title || "document"}">Download</a>
        </li>`;
      }).join("")}
    </ul>`;
}

function render(root, item) {
  const name = item.name || "Unknown";
  document.title = `${name} — Media Gallery · VeteransLedger`;

  const recordPath = location.pathname.replace(/\/gallery$/, "");
  const gallery = item.gallery || [];
  const blueprints = item.blueprints || [];
  const videos = item.videos || [];
  const documents = item.documents || [];

  const tabs = [
    { id: "images",     label: `Images (${gallery.length})`,     count: gallery.length },
    { id: "blueprints", label: `Blueprints (${blueprints.length})`, count: blueprints.length },
    { id: "footage",    label: `Footage (${videos.length})`,     count: videos.length },
    { id: "documents",  label: `Documents (${documents.length})`, count: documents.length },
  ];

  // Activate the tab named in the URL hash, default to first non-empty tab
  const hashTab = location.hash.replace("#", "");
  const initialTab = tabs.find((t) => t.id === hashTab && t.count > 0)
    || tabs.find((t) => t.count > 0)
    || tabs[0];

  root.innerHTML = `
    <nav class="record-breadcrumb" aria-label="Breadcrumb">
      <a href="/armaments">Armaments</a>
      <span class="record-breadcrumb__sep">›</span>
      <a href="${recordPath}">${name}</a>
      <span class="record-breadcrumb__sep">›</span>
      <span>Media Gallery</span>
    </nav>

    <header class="record-header" style="padding-bottom:var(--space-4)">
      <div class="record-header__meta">
        <h1 class="record-header__title">${name} — Media Gallery</h1>
      </div>
    </header>

    <nav class="armament-gallery-tabs" role="tablist" aria-label="Media categories">
      ${tabs.map((t) => `
        <button
          class="armament-gallery-tab${t.id === initialTab.id ? " active" : ""}"
          role="tab"
          aria-selected="${t.id === initialTab.id}"
          aria-controls="panel-${t.id}"
          data-tab="${t.id}"
          ${t.count === 0 ? "hidden" : ""}
        >${t.label}</button>`).join("")}
    </nav>

    <div id="panel-images" class="armament-gallery-panel${initialTab.id === "images" ? " active" : ""}" role="tabpanel">
      ${renderImagePanel(gallery, "", false)}
    </div>
    <div id="panel-blueprints" class="armament-gallery-panel${initialTab.id === "blueprints" ? " active" : ""}" role="tabpanel">
      ${renderImagePanel(blueprints, " armament-gallery-figure--blueprint", true)}
    </div>
    <div id="panel-footage" class="armament-gallery-panel${initialTab.id === "footage" ? " active" : ""}" role="tabpanel">
      ${renderVideoPanel(videos)}
    </div>
    <div id="panel-documents" class="armament-gallery-panel${initialTab.id === "documents" ? " active" : ""}" role="tabpanel">
      ${renderDocumentPanel(documents)}
    </div>
  `;

  root.querySelectorAll(".armament-gallery-tab").forEach((btn) => {
    btn.addEventListener("click", () => {
      root.querySelectorAll(".armament-gallery-tab").forEach((b) => {
        b.classList.remove("active");
        b.setAttribute("aria-selected", "false");
      });
      root.querySelectorAll(".armament-gallery-panel").forEach((p) => p.classList.remove("active"));
      btn.classList.add("active");
      btn.setAttribute("aria-selected", "true");
      root.querySelector(`#panel-${btn.dataset.tab}`)?.classList.add("active");
      history.replaceState(null, "", `#${btn.dataset.tab}`);
    });
  });
}

async function init() {
  const root = document.getElementById("gallery-root");
  const segments = location.pathname.split("/").filter(Boolean);
  // URL is /armaments/:id/gallery — id is second-to-last segment
  const id = segments[segments.length - 2];

  if (!id) {
    root.innerHTML = `<nav class="record-breadcrumb"><a href="/armaments">← Back to Armaments</a></nav><div class="record-error"><div class="record-error__title">No armament ID provided.</div></div>`;
    return;
  }

  const item = await findArmament(id);
  if (!item) {
    root.innerHTML = `<nav class="record-breadcrumb"><a href="/armaments">← Back to Armaments</a></nav><div class="record-error"><div class="record-error__title">Record not found: ${id}</div></div>`;
    return;
  }

  render(root, item);
  attachMediaFallbacks(root);
  initAttributionModal();
  initImageLightbox();
}

init();
