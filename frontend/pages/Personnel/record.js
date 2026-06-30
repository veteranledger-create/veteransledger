/**
 * VeteransLedger · Personnel record page
 * Reads :id from URL, searches branch files for the matching person, renders profile.
 */

import { resolveRelatedUrl } from "/pages/shared/related-url-resolver.js";
import { applyRecordTranslation } from "/pages/shared/translation-loader.js";
import { onLocaleChange } from "/pages/shared/i18n.js";

const PLACEHOLDER = "/public/images/covers/placeholder-cards.webp";

const _BRANCHES_FALLBACK = [
  { id: "army",         label: "Heer (Army)",        file: "army.json" },
  { id: "luftwaffe",    label: "Luftwaffe",           file: "luftwaffe.json" },
  { id: "kriegsmarine", label: "Kriegsmarine",        file: "kriegsmarine.json" },
  { id: "waffen-ss",    label: "Waffen-SS",           file: "waffen-ss.json" },
  { id: "foreign",      label: "Foreign Volunteers",  file: "foreign.json" },
];

let _manifestPromise = null;
async function loadManifest() {
  if (!_manifestPromise) {
    _manifestPromise = fetch("/public/data/personnel/index.json")
      .then((r) => (r.ok ? r.json() : null))
      .catch(() => null);
  }
  return _manifestPromise;
}

async function findPerson(id) {
  const manifest = await loadManifest();
  const branches = (manifest?.branches ?? _BRANCHES_FALLBACK).map((b) => ({
    ...b,
    file: b.file.replace("/public/data/personnel/", ""),
  }));
  for (const branch of branches) {
    try {
      const res = await fetch(`/public/data/personnel/${branch.file}`);
      if (!res.ok) continue;
      const data = await res.json();
      const arr = Array.isArray(data) ? data : data?.personnel || data?.people || [];
      const person = arr.find((p) => p.id === id);
      if (person) return { ...person, _branch: branch.id, _branchLabel: branch.label };
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

function render(root, p) {
  document.title = `${p.name} · VeteransLedger`;

  const branchLabel = p._branchLabel || p._branch || p.branch || "";
  const portrait = p.portrait || p.image || p.photo || PLACEHOLDER;
  const born = formatDate(p.born);
  const died = formatDate(p.died);
  const commands = p.commands || [];
  const awards = p.awards || [];
  const campaigns = p.campaigns || [];

  root.innerHTML = `
    <nav class="record-breadcrumb" aria-label="Breadcrumb">
      <a href="/personnel">Personnel</a>
      <span class="record-breadcrumb__sep">›</span>
      ${branchLabel ? `<span>${branchLabel}</span><span class="record-breadcrumb__sep">›</span>` : ""}
      <span>${p.name || ""}</span>
    </nav>

    <header class="record-header">
      <div class="record-header__meta">
        ${branchLabel ? `<span class="record-header__badge">${branchLabel}</span>` : ""}
        ${p.rank ? `<p class="record-header__subtitle" style="color:var(--gold-dim);font-size:var(--text-sm);margin-bottom:var(--space-2);letter-spacing:0.06em;">${p.rank}</p>` : ""}
        <h1 class="record-header__title">${p.name || "Unknown"}</h1>
        ${p.birthplace ? `<p class="record-header__subtitle">Born: ${p.birthplace}</p>` : ""}
        <p class="record-header__dates">
          ${born ? `b. ${born}` : ""}${born && died ? " · " : ""}${died ? `d. ${died}` : ""}
        </p>
      </div>
      <img class="record-portrait" src="${portrait}" alt="${p.name || ""}" onerror="this.onerror=null;this.src='${PLACEHOLDER}'">
    </header>

    ${p.biography ? (() => {
      const paras = String(p.biography).split(/\n\n+/).map(s => s.trim()).filter(Boolean);
      return `<section class="record-section record-section--biography">
        <h2 class="record-section__title">Biography</h2>
        <div class="record-section__body">${paras.map(t => `<p>${t}</p>`).join("")}</div>
      </section>`;
    })() : ""}

    <div class="record-two-col">
      ${
        commands.length
          ? `
      <section class="record-section">
        <h2 class="record-section__title">Commands</h2>
        <ul class="record-list">
          ${commands.map((c) => `<li>${c}</li>`).join("")}
        </ul>
      </section>`
          : ""
      }

      ${
        awards.length
          ? `
      <section class="record-section">
        <h2 class="record-section__title">Decorations</h2>
        <ul class="record-list">
          ${awards.map((a) => `<li>${a}</li>`).join("")}
        </ul>
      </section>`
          : ""
      }
    </div>

    ${
      campaigns.length
        ? `
    <section class="record-section">
      <h2 class="record-section__title">Campaigns Served</h2>
      <div class="record-tags">
        ${campaigns.map((c) => `<span class="record-tag">${c.replace(/-/g, " ")}</span>`).join("")}
      </div>
    </section>`
        : ""
    }

    ${
      p.born || p.died || p.birthplace || p.nationality
        ? `
    <section class="record-section">
      <h2 class="record-section__title">Biographical Data</h2>
      <table class="record-specs">
        <tbody>
          ${p.rank ? `<tr><td>Rank</td><td>${p.rank}</td></tr>` : ""}
          ${p.branch ? `<tr><td>Branch</td><td>${branchLabel}</td></tr>` : ""}
          ${born ? `<tr><td>Born</td><td>${born}${p.birthplace ? `, ${p.birthplace}` : ""}</td></tr>` : ""}
          ${died ? `<tr><td>Died</td><td>${died}</td></tr>` : ""}
          ${p.nationality ? `<tr><td>Nationality</td><td>${p.nationality}</td></tr>` : ""}
        </tbody>
      </table>
    </section>`
        : ""
    }

    ${renderHistoricalContext(p)}
    ${renderFullReport(p)}
    ${renderTimelineRefs(p)}
    ${renderMedia(p)}
    ${renderSources(p)}
    ${renderRelatedRecords(p, "/personnel")}

    <p class="record-archive-note">VeteransLedger Historical Archive · All content is presented for educational purposes only.</p>
  `;
}

/* ── Archive section renderers (shared across all record types) ── */

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
          ${m.description ? `<p style="font-size:var(--text-xs);color:var(--text-muted);margin-top:var(--space-1)">${m.description}</p>` : ""}
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
    renderError(root, "No record ID provided.");
    return;
  }

  const person = await findPerson(id);
  if (!person) {
    renderError(root, `Personnel record "${id}" not found.`);
    return;
  }

  render(root, person);

  applyRecordTranslation(root, "entity", person.recordId || person.id);
  onLocaleChange(() => applyRecordTranslation(root, "entity", person.recordId || person.id));
}

function renderError(root, msg) {
  root.innerHTML = `
    <nav class="record-breadcrumb"><a href="/personnel">← Back to Personnel</a></nav>
    <div class="record-error">
      <div class="record-error__icon">✛</div>
      <div class="record-error__title">Record Not Found</div>
      <p style="font-size:var(--text-sm);color:var(--text-muted)">${msg}</p>
    </div>`;
}

init();
