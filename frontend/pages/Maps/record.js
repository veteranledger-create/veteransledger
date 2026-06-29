/**
 * VeteransLedger · Map record page
 * Reads :id from URL, fetches the map JSON, renders the full record.
 */

import { resolveRelatedUrl } from "/pages/shared/related-url-resolver.js";

const PLACEHOLDER = "/public/images/covers/placeholder-cards.webp";

let _indexPromise = null;
async function loadIndex() {
  if (!_indexPromise) {
    _indexPromise = fetch("/public/data/maps/index.json")
      .then((r) => (r.ok ? r.json() : null))
      .catch(() => null);
  }
  return _indexPromise;
}

async function findMap(id) {
  const index = await loadIndex();
  const records = index?.records ?? [];
  const entry = records.find((r) => r.id === id);
  if (!entry) return null;
  try {
    const res = await fetch(`/public/data/maps/${id}.json`);
    return res.ok ? await res.json() : null;
  } catch { return null; }
}

function renderSources(rec) {
  const sources = rec.sources || [];
  if (!sources.length) return "";
  const primary   = sources.filter((s) => s.type === "primary");
  const secondary = sources.filter((s) => s.type === "secondary");
  const other     = sources.filter((s) => !s.type);
  const list = (items) => items.map((s) => `<li>${s.ref || s}${s.note ? ` — <em>${s.note}</em>` : ""}</li>`).join("");
  return `
    <section class="record-section record-section--archive">
      <h2 class="record-section__title">Sources &amp; References</h2>
      ${primary.length   ? `<div class="record-sources-group"><h3 class="record-sources-group__label">Primary Sources</h3><ol class="record-sources-list">${list(primary)}</ol></div>` : ""}
      ${secondary.length ? `<div class="record-sources-group"><h3 class="record-sources-group__label">Secondary Sources</h3><ol class="record-sources-list">${list(secondary)}</ol></div>` : ""}
      ${other.length     ? `<div class="record-sources-group"><h3 class="record-sources-group__label">References</h3><ol class="record-sources-list">${list(other)}</ol></div>` : ""}
    </section>`;
}

function renderRelated(rec) {
  const related = rec.related_records || [];
  if (!related.length) return "";
  return `
    <section class="record-section record-section--archive">
      <h2 class="record-section__title">Related Records</h2>
      <div class="record-related-grid">
        ${related.map((r) => `
          <a class="record-related-card" href="${resolveRelatedUrl(r.type, r.id)}">
            <span class="record-related-card__type">${r.type || ""}</span>
            <span class="record-related-card__title">${r.title || r.id}</span>
          </a>`).join("")}
      </div>
    </section>`;
}

function renderMapImages(rec) {
  const gallery = rec.gallery || [];
  if (!gallery.length && !rec.image) return "";
  const images = gallery.length ? gallery : [{ url: rec.image, caption: rec.title }];
  return `
    <section class="record-section record-section--archive">
      <h2 class="record-section__title">Map Images</h2>
      ${images.map((g) => `
        <figure class="record-media-item" style="max-width:100%;margin-bottom:var(--space-6)">
          <img src="${g.url || g.file || ""}" alt="${g.caption || rec.title}" loading="lazy"
            style="max-width:100%;height:auto"
            onerror="this.onerror=null;this.src='${PLACEHOLDER}'">
          ${g.caption ? `<figcaption>${g.caption}</figcaption>` : ""}
        </figure>`).join("")}
    </section>`;
}

function renderDocuments(rec) {
  const docs = rec.documents || [];
  if (!docs.length) return "";
  return `
    <section class="record-section record-section--archive">
      <h2 class="record-section__title">Documents</h2>
      ${docs.map((d) => `
        <div style="padding:var(--space-3) var(--space-4);background:var(--bg-card);border:1px solid var(--border-dim);border-radius:var(--radius);margin-bottom:var(--space-2)">
          <span style="font-size:var(--text-sm);color:var(--gold-dim)">${d.title || "Document"}</span>
          ${d.description ? `<p style="font-size:var(--text-xs);color:var(--text-muted);margin:var(--space-1) 0 0">${d.description}</p>` : ""}
          ${d.url ? `<a href="${d.url}" style="font-size:var(--text-xs);color:var(--gold)" target="_blank" rel="noopener">View ↗</a>` : ""}
        </div>`).join("")}
    </section>`;
}

function render(root, map) {
  document.title = `${map.title} · VeteransLedger`;
  const theater = map.theater?.replace(/-/g, " ");
  const meta = [theater, map.year].filter(Boolean).join(" · ");

  root.innerHTML = `
    <nav class="record-breadcrumb" aria-label="Breadcrumb">
      <a href="/maps">Maps</a>
      ${theater ? `<span class="record-breadcrumb__sep">›</span><span>${theater}</span>` : ""}
      <span class="record-breadcrumb__sep">›</span>
      <span>${map.title || ""}</span>
    </nav>

    <header class="record-header">
      <div class="record-header__meta">
        ${meta ? `<span class="record-header__badge">${meta}</span>` : ""}
        <h1 class="record-header__title">${map.title || "Untitled"}</h1>
      </div>
    </header>

    ${map.summary ? `<blockquote class="record-summary">${map.summary}</blockquote>` : ""}

    ${renderMapImages(map)}
    ${renderDocuments(map)}
    ${renderSources(map)}
    ${renderRelated(map)}

    <p class="record-archive-note">VeteransLedger Historical Archive · All content is presented for educational purposes only.</p>
  `;
}

async function init() {
  const root = document.getElementById("record-root");
  const id   = location.pathname.split("/").filter(Boolean).pop();
  if (!id) { renderError(root, "No map ID provided."); return; }
  const map = await findMap(id);
  if (!map) { renderError(root, `Map "${id}" not found.`); return; }
  render(root, map);
}

function renderError(root, msg) {
  root.innerHTML = `
    <nav class="record-breadcrumb"><a href="/maps">← Back to Maps</a></nav>
    <div class="record-error">
      <div class="record-error__icon">⊕</div>
      <div class="record-error__title">Map Not Found</div>
      <p style="font-size:var(--text-sm);color:var(--text-muted)">${msg}</p>
    </div>`;
}

init();
