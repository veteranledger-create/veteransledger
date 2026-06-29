/**
 * VeteransLedger · Award record page
 * Reads :id from URL, fetches the award JSON from awards/index.json, renders the full record.
 */

import { resolveRelatedUrl } from "/pages/shared/related-url-resolver.js";

const PLACEHOLDER = "/public/images/covers/placeholder-cards.webp";

let _indexPromise = null;
async function loadIndex() {
  if (!_indexPromise) {
    _indexPromise = fetch("/public/data/awards/index.json")
      .then((r) => (r.ok ? r.json() : null))
      .catch(() => null);
  }
  return _indexPromise;
}

async function findAward(id) {
  const index = await loadIndex();
  const records = index?.records ?? [];
  const entry = records.find((r) => r.id === id);
  if (!entry) return null;
  try {
    const res = await fetch(`/public/data/awards/${id}.json`);
    return res.ok ? await res.json() : null;
  } catch { return null; }
}

function formatDate(dateStr) {
  if (!dateStr) return "";
  const d = new Date(dateStr);
  return isNaN(d.getTime()) ? dateStr : d.toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" });
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

function renderGallery(rec) {
  const gallery = rec.gallery || [];
  if (!gallery.length) return "";
  return `
    <section class="record-section record-section--archive">
      <h2 class="record-section__title">Gallery</h2>
      <div class="record-media-gallery">
        ${gallery.map((g) => `
          <figure class="record-media-item">
            <img src="${g.url || g.file || ""}" alt="${g.caption || rec.title}" loading="lazy"
              onerror="this.onerror=null;this.src='${PLACEHOLDER}'">
            ${g.caption ? `<figcaption>${g.caption}</figcaption>` : ""}
          </figure>`).join("")}
      </div>
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

function render(root, award) {
  document.title = `${award.title} · VeteransLedger`;

  const heroImg = document.createElement("img");
  heroImg.className = "record-hero-image";
  heroImg.alt = award.title || "";
  heroImg.addEventListener("error", () => { heroImg.src = PLACEHOLDER; }, { once: true });
  heroImg.src = award.image || PLACEHOLDER;

  root.innerHTML = `
    <nav class="record-breadcrumb" aria-label="Breadcrumb">
      <a href="/awards">Awards &amp; Decorations</a>
      <span class="record-breadcrumb__sep">›</span>
      <span>${award.title || ""}</span>
    </nav>

    <header class="record-header">
      <div class="record-header__meta">
        ${award.nation ? `<span class="record-header__badge">${award.nation}</span>` : ""}
        <h1 class="record-header__title">${award.title || "Untitled"}</h1>
      </div>
    </header>

    <div id="award-hero-placeholder"></div>

    ${award.summary ? `<blockquote class="record-summary">${award.summary}</blockquote>` : ""}

    ${renderGallery(award)}
    ${renderDocuments(award)}
    ${renderSources(award)}
    ${renderRelated(award)}

    <p class="record-archive-note">VeteransLedger Historical Archive · All content is presented for educational purposes only.</p>
  `;

  const placeholder = root.querySelector("#award-hero-placeholder");
  if (placeholder) placeholder.replaceWith(heroImg);
}

async function init() {
  const root = document.getElementById("record-root");
  const id   = location.pathname.split("/").filter(Boolean).pop();
  if (!id) { renderError(root, "No award ID provided."); return; }
  const award = await findAward(id);
  if (!award) { renderError(root, `Award "${id}" not found.`); return; }
  render(root, award);
}

function renderError(root, msg) {
  root.innerHTML = `
    <nav class="record-breadcrumb"><a href="/awards">← Back to Awards</a></nav>
    <div class="record-error">
      <div class="record-error__icon">✦</div>
      <div class="record-error__title">Award Not Found</div>
      <p style="font-size:var(--text-sm);color:var(--text-muted)">${msg}</p>
    </div>`;
}

init();
