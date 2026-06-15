/**
 * VeteransLedger · Letter record page
 * Reads :id from URL, searches letter collection files, renders the full letter.
 * Supports: original_text, translation, context, sources, citations, related_records, media.
 */

const COLLECTIONS = [
  { id: "german", label: "German", file: "german.json" },
  { id: "italian", label: "Italian", file: "italian.json" },
  { id: "japanese", label: "Japanese", file: "japanese.json" },
  { id: "volunteers", label: "Volunteers", file: "volunteers.json" },
];

const LANG_LABELS = Object.fromEntries(COLLECTIONS.map((c) => [c.id, c.label]));

async function findLetter(id) {
  for (const col of COLLECTIONS) {
    try {
      const res = await fetch(`/public/data/letters/${col.file}`);
      if (!res.ok) continue;
      const data = await res.json();
      const arr = Array.isArray(data) ? data : data?.letters || [];
      const letter = arr.find((l) => l.id === id);
      if (letter) return { ...letter, _lang: col.id };
    } catch (_) {}
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

function render(root, letter) {
  const langLabel =
    LANG_LABELS[letter._lang || letter.language] || letter.language || "";
  const dateFmt = formatDate(letter.date);
  const translation =
    letter.translation ||
    letter.full_text ||
    letter.content ||
    letter.text ||
    "";
  const original = letter.original_text || letter.original || "";
  const context = letter.context || "";

  document.title = `${letter.from || "Letter"} · VeteransLedger`;

  root.innerHTML = `
    <nav class="record-breadcrumb" aria-label="Breadcrumb">
      <a href="/letters">Letters</a>
      <span class="record-breadcrumb__sep">›</span>
      ${langLabel ? `<span>${langLabel}</span><span class="record-breadcrumb__sep">›</span>` : ""}
      <span>${letter.from || letter.id || ""}</span>
    </nav>

    <header class="record-header">
      <div class="record-header__meta">
        ${langLabel ? `<span class="record-header__badge">${langLabel} Collection</span>` : ""}
        <h1 class="record-header__title">${letter.subject || "Letter from the Archive"}</h1>
        <p class="record-header__subtitle">From: ${letter.from || "Unknown"}${letter.from_unit ? ` · ${letter.from_unit}` : ""}</p>
        ${dateFmt ? `<p class="record-header__dates">${dateFmt}${letter.location_written ? ` · ${letter.location_written}` : ""}</p>` : ""}
      </div>
    </header>

    <dl class="record-letter-meta">
      ${letter.from ? `<dt>From</dt><dd>${letter.from}</dd>` : ""}
      ${letter.from_unit ? `<dt>Unit</dt><dd>${letter.from_unit}</dd>` : ""}
      ${letter.to ? `<dt>To</dt><dd>${letter.to}</dd>` : ""}
      ${dateFmt ? `<dt>Date</dt><dd>${dateFmt}</dd>` : ""}
      ${letter.location_written ? `<dt>Location</dt><dd>${letter.location_written}</dd>` : ""}
      ${letter.subject ? `<dt>Subject</dt><dd>${letter.subject}</dd>` : ""}
      ${letter.nation ? `<dt>Nation</dt><dd>${letter.nation}</dd>` : ""}
    </dl>

    ${
      context
        ? `
    <section class="record-section">
      <h2 class="record-section__title">Historical Context</h2>
      <div class="record-section__body"><p>${context}</p></div>
    </section>`
        : ""
    }

    ${
      original
        ? `
    <section class="record-section">
      <h2 class="record-section__title">Original Text</h2>
      <div class="record-letter-original">
        <span class="record-letter-original__label">Original — ${langLabel || "Source language"}</span>
        ${original.replace(/\n/g, "<br>")}
      </div>
    </section>`
        : ""
    }

    ${
      translation
        ? `
    <section class="record-section">
      <h2 class="record-section__title">${original ? "Translation (English)" : "Full Text"}</h2>
      <div class="record-letter-body">${translation.replace(/\n/g, "<br>")}</div>
    </section>`
        : ""
    }

    ${
      letter.notes
        ? `
    <section class="record-section">
      <h2 class="record-section__title">Archival Notes</h2>
      <div class="record-section__body"><p>${letter.notes}</p></div>
    </section>`
        : ""
    }

    ${renderTimelineRefs(letter)}
    ${renderMedia(letter)}
    ${renderSources(letter)}
    ${renderRelatedRecords(letter, "/letters")}

    ${
      letter.archive_source
        ? `
    <p class="record-archive-note">Source: ${letter.archive_source} · VeteransLedger Historical Archive · Educational use only.</p>`
        : `
    <p class="record-archive-note">VeteransLedger Historical Archive · All content is presented for educational purposes only.</p>`
    }
  `;
}

/* ── Archive section renderers ───────────────────────────────── */

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
            <a class="record-related-card" href="${r.url || backPath + "/" + r.id}">
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
  const docs = media.filter((m) => m.type === "document" || m.type === "pdf");

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
        docs.length
          ? `<div style="margin-top:var(--space-4)">${docs
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
    renderError(root, "No letter ID provided.");
    return;
  }

  const letter = await findLetter(id);
  if (!letter) {
    renderError(root, `Letter record "${id}" not found.`);
    return;
  }

  render(root, letter);
}

function renderError(root, msg) {
  root.innerHTML = `
    <nav class="record-breadcrumb"><a href="/letters">← Back to Letters</a></nav>
    <div class="record-error">
      <div class="record-error__icon">✉</div>
      <div class="record-error__title">Letter Not Found</div>
      <p style="font-size:var(--text-sm);color:var(--text-muted)">${msg}</p>
    </div>`;
}

init();
