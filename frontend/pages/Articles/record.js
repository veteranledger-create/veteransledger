/**
 * VeteransLedger · Article record page
 * Reads :id from URL, searches article category files, renders full article.
 */

import { resolveRelatedUrl } from "/pages/shared/related-url-resolver.js";

const PLACEHOLDER = "/public/images/covers/articles-cover.webp";

const _ARTICLE_CATEGORIES_FALLBACK = [
  { cat: "military",  files: ["poland-1939.json", "rearmament.json"] },
  { cat: "political", files: ["anschluss.json", "july-20.json", "rise-nsdap.json"] },
  { cat: "economy",   files: [] },
  { cat: "legal",     files: ["nuremberg.json"] },
];

let _manifestPromise = null;
async function loadManifest() {
  if (!_manifestPromise) {
    _manifestPromise = fetch("/public/data/articles/index.json")
      .then((r) => (r.ok ? r.json() : null))
      .catch(() => null);
  }
  return _manifestPromise;
}

async function findArticle(id) {
  const manifest = await loadManifest();
  const categories = manifest?.categories
    ? manifest.categories.map((c) => ({ cat: c.id, files: (c.files || []).map((f) => f.split("/").pop()) }))
    : _ARTICLE_CATEGORIES_FALLBACK;

  for (const { cat, files } of categories) {
    for (const file of files) {
      try {
        const res = await fetch(`/public/data/articles/${cat}/${file}`);
        if (!res.ok) continue;
        const data = await res.json();
        if (data?.id === id) return { ...data, _category: cat };
      } catch (_) {}
    }
  }
  return null;
}

function formatDate(dateStr) {
  if (!dateStr) return "";
  const d = new Date(dateStr);
  return isNaN(d.getTime())
    ? dateStr
    : d.toLocaleDateString("en-GB", {
        day: "numeric",
        month: "long",
        year: "numeric",
      });
}

function renderBody(body) {
  if (!Array.isArray(body)) return "";
  return body
    .map((block) => {
      if (block.type === "heading") return `<h3 class="article-body__heading">${block.text}</h3>`;
      if (block.type === "paragraph") return `<p>${block.text}</p>`;
      if (block.type === "quote")
        return `<blockquote class="article-body__quote">${block.text}</blockquote>`;
      if (block.type === "list") {
        const items = Array.isArray(block.items)
          ? block.items
          : (block.text || "").split("\n").map((s) => s.trim()).filter(Boolean);
        return `<ul class="article-body__list">${items.map((i) => `<li>${i}</li>`).join("")}</ul>`;
      }
      if (block.type === "numbered-list") {
        const items = Array.isArray(block.items)
          ? block.items
          : (block.text || "").split("\n").map((s) => s.trim()).filter(Boolean);
        return `<ol class="article-body__list">${items.map((i) => `<li>${i}</li>`).join("")}</ol>`;
      }
      if (block.type === "image")
        return `<figure class="article-body__figure">
          <img src="${block.url || block.src || ""}" alt="${block.caption || block.alt || ""}" loading="lazy" onerror="this.onerror=null;this.src='/public/images/covers/articles-cover.webp'">
          ${block.caption ? `<figcaption class="article-body__caption">${block.caption}</figcaption>` : ""}
          ${block.source ? `<figcaption class="article-body__caption article-body__caption--source">Source: ${block.source}</figcaption>` : ""}
        </figure>`;
      return `<p>${block.text || ""}</p>`;
    })
    .join("\n");
}

function renderArchivalNote(article) {
  if (!article.archival_note) return "";
  return `
    <section class="record-section record-section--archive">
      <h2 class="record-section__title">Archival Note</h2>
      <div class="record-section__body"><p>${article.archival_note}</p></div>
    </section>`;
}

function render(root, article) {
  document.title = `${article.title} · VeteransLedger`;

  const catLabel = (article._category || article.category || "").replace(/-/g, " ");
  const pubDate  = formatDate(article.date_published || article.date);
  const imgSrc   = article.image || (article.images && article.images[0]) || PLACEHOLDER;
  const tags     = article.tags || [];

  // Build hero img via DOM so error handler is attached before src fires
  const heroImg = document.createElement("img");
  heroImg.className = "record-hero-image";
  heroImg.alt = article.title || "";
  heroImg.addEventListener("error", () => { heroImg.src = PLACEHOLDER; }, { once: true });
  heroImg.addEventListener("load", () => { if (!heroImg.naturalWidth) heroImg.src = PLACEHOLDER; }, { once: true });
  heroImg.src = imgSrc;

  root.innerHTML = `
    <nav class="record-breadcrumb" aria-label="Breadcrumb">
      <a href="/articles">Articles</a>
      <span class="record-breadcrumb__sep">›</span>
      ${catLabel ? `<span>${catLabel}</span><span class="record-breadcrumb__sep">›</span>` : ""}
      <span>${article.title || ""}</span>
    </nav>

    <header class="record-header">
      <div class="record-header__meta">
        ${catLabel ? `<span class="record-header__badge">${catLabel}</span>` : ""}
        <h1 class="record-header__title">${article.title || "Untitled"}</h1>
        ${article.subtitle ? `<p class="record-header__subtitle" style="font-size:var(--text-base);color:var(--text-secondary);margin-top:var(--space-2);">${article.subtitle}</p>` : ""}
        <p class="record-header__dates">
          ${article.author ? `By ${article.author}` : ""}${article.author && pubDate ? " · " : ""}${pubDate}
        </p>
      </div>
    </header>

    <div id="article-hero-placeholder"></div>

    ${article.summary ? `<blockquote class="record-summary">${article.summary}</blockquote>` : ""}

    ${article.body?.length ? `
    <section class="record-section article-body">
      <div class="record-section__body article-body__content">
        ${renderBody(article.body)}
      </div>
    </section>` : ""}

    ${tags.length ? `
    <section class="record-section">
      <h2 class="record-section__title">Tags</h2>
      <div class="record-tags">
        ${tags.map((t) => `<span class="record-tag">${t}</span>`).join("")}
      </div>
    </section>` : ""}

    ${renderArchivalNote(article)}
    ${renderHistoricalContext(article)}
    ${renderFullReport(article)}
    ${renderTimelineRefs(article)}
    ${renderMedia(article)}
    ${renderSources(article)}
    ${renderRelatedRecords(article, "/articles")}

    <p class="record-archive-note">VeteransLedger Historical Archive · All content is presented for educational purposes only.</p>
  `;

  const placeholder = root.querySelector("#article-hero-placeholder");
  if (placeholder) placeholder.replaceWith(heroImg);
}

/* ── Archive section renderers ───────────────────────────────── */

function renderHistoricalContext(rec) {
  const text = rec.historical_context;
  if (!text) return "";
  const paras = Array.isArray(text)
    ? text
    : String(text).split(/\n\n+/).filter(Boolean);
  return `
    <section class="record-section record-section--archive">
      <h2 class="record-section__title">Historical Context</h2>
      <div class="record-section__body">${paras.map((p) => `<p>${p}</p>`).join("")}</div>
    </section>`;
}

function renderFullReport(rec) {
  const report = rec.full_report;
  if (!report) return "";
  if (Array.isArray(report)) {
    return `
      <section class="record-section record-section--archive">
        <h2 class="record-section__title">Full Historical Report</h2>
        <div class="record-section__body">
          ${report
            .map((block) => {
              if (block.type === "heading") return `<h3>${block.text}</h3>`;
              if (block.type === "quote")
                return `<blockquote style="border-left:3px solid var(--border-gold);padding-left:var(--space-4);color:var(--text-muted);font-style:italic;margin:var(--space-4) 0">${block.text}</blockquote>`;
              return `<p>${block.text || block}</p>`;
            })
            .join("")}
        </div>
      </section>`;
  }
  const paras = String(report).split(/\n\n+/).filter(Boolean);
  return `
    <section class="record-section record-section--archive">
      <h2 class="record-section__title">Full Historical Report</h2>
      <div class="record-section__body">${paras.map((p) => `<p>${p}</p>`).join("")}</div>
    </section>`;
}

function renderSources(rec) {
  const sources = rec.sources || [];
  const citations = rec.citations || [];
  if (!sources.length && !citations.length) return "";

  const primary = sources.filter((s) => s.type === "primary");
  const secondary = sources.filter((s) => s.type === "secondary");
  const other = sources.filter((s) => !s.type);

  const renderList = (items) =>
    items
      .map(
        (s) =>
          `<li>${s.ref || s.title || s}${s.note ? ` — <em>${s.note}</em>` : ""}</li>`,
      )
      .join("");

  return `
    <section class="record-section record-section--archive">
      <h2 class="record-section__title">Sources &amp; References</h2>
      ${primary.length ? `<div class="record-sources-group"><h3 class="record-sources-group__label">Primary Sources</h3><ol class="record-sources-list">${renderList(primary)}</ol></div>` : ""}
      ${secondary.length ? `<div class="record-sources-group"><h3 class="record-sources-group__label">Secondary Sources</h3><ol class="record-sources-list">${renderList(secondary)}</ol></div>` : ""}
      ${other.length ? `<div class="record-sources-group"><h3 class="record-sources-group__label">References</h3><ol class="record-sources-list">${renderList(other)}</ol></div>` : ""}
      ${citations.length ? `<div class="record-sources-group"><h3 class="record-sources-group__label">Citations</h3><ol class="record-sources-list">${citations.map((c) => `<li>${c.ref || c.text || c}</li>`).join("")}</ol></div>` : ""}
    </section>`;
}

function renderRelatedRecords(rec, backPath) {
  const prev = rec.prev_record;
  const next = rec.next_record;
  const related = rec.related_records || [];
  if (!prev && !next && !related.length) return "";

  return `
    <section class="record-section record-section--archive">
      <h2 class="record-section__title">Related Records</h2>
      ${
        prev || next
          ? `
        <div class="record-nav-prev-next">
          ${prev ? `<a class="record-nav-link record-nav-link--prev" href="${backPath}/${prev.id}">← ${prev.title || prev.id}</a>` : "<span></span>"}
          ${next ? `<a class="record-nav-link record-nav-link--next" href="${backPath}/${next.id}">${next.title || next.id} →</a>` : ""}
        </div>`
          : ""
      }
      ${
        related.length
          ? `
        <div class="record-related-grid">
          ${related
            .map(
              (r) => `
            <a class="record-related-card" href="${resolveRelatedUrl(r.type, r.id)}">
              <span class="record-related-card__type">${r.type || ""}</span>
              <span class="record-related-card__title">${r.title || r.id}</span>
            </a>`,
            )
            .join("")}
        </div>`
          : ""
      }
    </section>`;
}

function renderMedia(rec) {
  const media = rec.media || [];
  if (!media.length) return "";

  const images = media.filter(
    (m) => m.type === "image" || m.type === "gallery",
  );
  const maps = media.filter((m) => m.type === "map");
  const docs = media.filter((m) => m.type === "document" || m.type === "pdf");
  const audios = media.filter((m) => m.type === "audio");
  const videos = media.filter((m) => m.type === "video");

  return `
    <section class="record-section record-section--archive">
      <h2 class="record-section__title">Media Archive</h2>
      ${
        images.length
          ? `<div class="record-media-gallery">${images
              .map(
                (m) => `
        <figure class="record-media-item">
          <img src="${m.url}" alt="${m.caption || ""}" loading="lazy">
          ${m.caption ? `<figcaption>${m.caption}</figcaption>` : ""}
        </figure>`,
              )
              .join("")}</div>`
          : ""
      }
      ${
        maps.length
          ? `<div style="margin-top:var(--space-6)"><h3 class="record-sources-group__label">Maps</h3>${maps
              .map(
                (m) => `
        <figure class="record-media-item" style="max-width:100%;margin-bottom:var(--space-4)">
          <img src="${m.url}" alt="${m.caption || "Map"}" loading="lazy" style="max-width:100%;height:auto">
          ${m.caption ? `<figcaption>${m.caption}</figcaption>` : ""}
        </figure>`,
              )
              .join("")}</div>`
          : ""
      }
      ${
        docs.length
          ? `<div style="margin-top:var(--space-6)"><h3 class="record-sources-group__label">Documents</h3>${docs
              .map(
                (d) => `
        <div style="padding:var(--space-3) var(--space-4);background:var(--bg-card);border:1px solid var(--border-dim);border-radius:var(--radius);margin-bottom:var(--space-2)">
          <span style="font-size:var(--text-sm);color:var(--gold-dim)">${d.title || "Document"}</span>
          ${d.description ? `<p style="font-size:var(--text-xs);color:var(--text-muted);margin:var(--space-1) 0 0">${d.description}</p>` : ""}
          ${d.url ? `<a href="${d.url}" style="font-size:var(--text-xs);color:var(--gold)" target="_blank" rel="noopener">View ↗</a>` : ""}
        </div>`,
              )
              .join("")}</div>`
          : ""
      }
      ${audios.length ? audios.map((a) => `<div style="margin-top:var(--space-4)"><p style="font-size:var(--text-xs);color:var(--gold-dim);margin-bottom:var(--space-2)">${a.caption || "Audio"}</p><audio controls src="${a.url}" style="width:100%"></audio></div>`).join("") : ""}
      ${videos.length ? videos.map((v) => `<div style="margin-top:var(--space-4)"><p style="font-size:var(--text-xs);color:var(--gold-dim);margin-bottom:var(--space-2)">${v.caption || "Video"}</p><video controls src="${v.url}" style="width:100%;max-height:480px"></video></div>`).join("") : ""}
    </section>`;
}

function renderTimelineRefs(rec) {
  const refs = rec.timeline_refs || [];
  if (!refs.length) return "";

  return `
    <section class="record-section record-section--archive">
      <h2 class="record-section__title">Timeline References</h2>
      <div style="display:flex;flex-direction:column;gap:0">
        ${refs
          .map(
            (r) => `
          <div style="display:grid;grid-template-columns:110px 1fr;gap:var(--space-4);padding:var(--space-3) 0;border-bottom:1px solid var(--border-dim)">
            <span style="font-size:var(--text-xs);color:var(--text-muted);font-family:var(--font-display);padding-top:2px">${r.date || r.year || ""}</span>
            <div>
              <div style="font-size:var(--text-sm);color:var(--text-primary)">${r.event}</div>
              ${r.note ? `<div style="font-size:var(--text-xs);color:var(--text-muted);margin-top:var(--space-1)">${r.note}</div>` : ""}
            </div>
          </div>`,
          )
          .join("")}
      </div>
    </section>`;
}

async function init() {
  const root = document.getElementById("record-root");
  const id = location.pathname.split("/").filter(Boolean).pop();

  if (!id) {
    renderError(root, "No article ID provided.");
    return;
  }

  const article = await findArticle(id);
  if (!article) {
    renderError(root, `Article "${id}" not found.`);
    return;
  }

  render(root, article);
}

function renderError(root, msg) {
  root.innerHTML = `
    <nav class="record-breadcrumb"><a href="/articles">← Back to Articles</a></nav>
    <div class="record-error">
      <div class="record-error__icon">✛</div>
      <div class="record-error__title">Article Not Found</div>
      <p style="font-size:var(--text-sm);color:var(--text-muted)">${msg}</p>
    </div>`;
}

init();
