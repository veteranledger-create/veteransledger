/**
 * VeteransLedger · Formation record page
 * Reads :id from URL, searches all formation files, renders the full record.
 */

import { renderBlock, renderDossierSection, attachMediaFallbacks, initAttributionModal, initImageLightbox } from "/pages/shared/media-blocks.js";

const INDEX_URL = "/public/data/formations/index.json";

// Loaded once in init() — every formation keyed by id, each tagged with its
// own category. Built in full (rather than stopping at the first match) so
// "Related Formation" cards can resolve their own classification icon
// without an extra round-trip per related record.
let formationsById = new Map();

async function loadAllFormations() {
  let categories = [];
  try {
    const res = await fetch(INDEX_URL);
    const data = res.ok ? await res.json() : {};
    categories = data.categories || [];
  } catch (_) {}

  const map = new Map();
  await Promise.all(categories.map(async (cat) => {
    try {
      const res = await fetch(cat.file);
      if (!res.ok) return;
      const data = await res.json();
      const arr = Array.isArray(data) ? data : [];
      arr.forEach((f) => { if (f?.id) map.set(f.id, { ...f, _category: cat }); });
    } catch (_) {}
  }));
  return map;
}

// Mirrors the classification-icon logic on the listing page, keyed off the
// category this record was found in rather than a `_section` tag.
const ICON_BASE = "/public/images/icons/formations";
const BRANCH_ICON_BASE = "/public/images/icons/branches";

function getFormationIcon(f, section) {
  const type = (f.type || "").toLowerCase();

  if (section === "waffen-ss")    return { src: `${BRANCH_ICON_BASE}/ss.svg`, alt: "Waffen-SS" };
  if (section === "luftwaffe")    return { src: `${BRANCH_ICON_BASE}/luftwaffe.svg`, alt: "Luftwaffe" };
  if (section === "kriegsmarine") return { src: `${BRANCH_ICON_BASE}/marine.svg`, alt: "Kriegsmarine" };
  if (section === "volunteers") {
    if (f.shield) return { src: f.shield, alt: `${f.nation || "Volunteer"} legion shield` };
    if (f.flag)   return { src: f.flag,   alt: f.nation || "Volunteer formation" };
    return { src: `${ICON_BASE}/volunteer.svg`, alt: "Volunteer formation" };
  }

  if (type.includes("army group")) return { src: `${ICON_BASE}/army-group.svg`, alt: "Army Group" };
  if (type.includes("army"))       return { src: `${ICON_BASE}/army.svg`,       alt: "Army" };
  if (type.includes("corps"))      return { src: `${ICON_BASE}/corps.svg`,      alt: "Corps" };
  if (type.includes("division"))  return { src: `${ICON_BASE}/division.svg`,   alt: "Division" };
  if (type.includes("brigade"))   return { src: `${ICON_BASE}/brigade.svg`,    alt: "Brigade" };
  if (type.includes("regiment"))  return { src: `${ICON_BASE}/regiment.svg`,   alt: "Regiment" };
  if (type.includes("battalion")) return { src: `${ICON_BASE}/battalion.svg`,  alt: "Battalion" };
  if (type.includes("company"))   return { src: `${ICON_BASE}/company.svg`,    alt: "Company" };
  return null;
}

function formatParent(parent) {
  if (typeof parent === "string") return parent;
  if (parent && parent.title) {
    return parent.url ? `<a href="${parent.url}">${parent.title}</a>` : parent.title;
  }
  return "";
}

function formatYear(dateStr) {
  if (!dateStr) return "";
  return String(dateStr).slice(0, 4);
}

function render(root, f) {
  const cat = f._category || {};
  const activeStr = f.active
    ? `${f.active.from || ""}${f.active.to ? " – " + f.active.to : ""}`
    : "";

  document.title = `${f.name} · VeteransLedger`;

  root.innerHTML = `
    <nav class="record-breadcrumb" aria-label="Breadcrumb">
      <a href="/formations">Formations</a>
      <span class="record-breadcrumb__sep">›</span>
      ${cat.label ? `<span>${cat.label}</span><span class="record-breadcrumb__sep">›</span>` : ""}
      <span>${f.name}</span>
    </nav>

    <header class="record-header">
      <div class="record-header__meta">
        <span class="record-header__type">
          ${(() => {
            const icon = getFormationIcon(f, cat.section);
            return icon ? `<img class="record-card__icon" src="${icon.src}" alt="${icon.alt}">` : "";
          })()}
          <span class="record-header__badge">${f.type || f.service || ""}</span>
        </span>
        <h1 class="record-header__title">${f.name}</h1>
      </div>
    </header>

    <dl class="record-meta-grid">
      ${f.type             ? `<div class="record-meta-item"><dt>Type</dt><dd>${f.type}</dd></div>` : ""}
      ${f.nation           ? `<div class="record-meta-item"><dt>Nation</dt><dd>${f.nation}</dd></div>` : ""}
      ${f.service          ? `<div class="record-meta-item"><dt>Branch</dt><dd>${f.service}</dd></div>` : ""}
      ${activeStr          ? `<div class="record-meta-item"><dt>Active</dt><dd>${activeStr}</dd></div>` : ""}
      ${f.theater          ? `<div class="record-meta-item"><dt>Theater</dt><dd>${f.theater}</dd></div>` : ""}
      ${f.volunteer_origin ? `<div class="record-meta-item"><dt>Volunteer Origin</dt><dd>${f.volunteer_origin}</dd></div>` : ""}
    </dl>

    ${renderOverview(f)}
    ${renderHistoricalContext(f)}

    ${renderOrganization(f)}

    ${f.commanders && f.commanders.length ? `
    <section class="record-section">
      <h2 class="record-section__title">Commanders</h2>
      <div class="record-table-wrap">
        <table class="record-table">
          <thead><tr><th>Commander</th><th>Period</th></tr></thead>
          <tbody>
            ${f.commanders.map((c) => `<tr><td>${c.name}</td><td>${c.period || ""}</td></tr>`).join("")}
          </tbody>
        </table>
      </div>
    </section>` : ""}

    ${renderSubordinateUnits(f)}
    ${renderCampaignParticipation(f)}
    ${renderDossierSection("Equipment &amp; Armament", f.dossier?.equipment)}
    ${renderDossierSection("Military Orders &amp; Directives", f.dossier?.orders)}
    ${renderDossierSection("Operational Maps", f.dossier?.maps)}
    ${renderDossierSection("Field Reports", f.dossier?.field_reports)}
    ${renderDossierSection("Recruitment &amp; Propaganda Material", f.dossier?.propaganda)}
    ${renderDossierSection("Order of Battle", f.dossier?.order_of_battle)}
    ${renderDossierSection("Photographic Archive", f.dossier?.photos)}
    ${renderDossierSection("Unit Insignia", f.dossier?.insignia)}
    ${renderDossierSection("Gallery", f.dossier?.gallery)}
    ${renderSources(f)}
    ${renderRelatedRecords(f)}

    <p class="record-archive-note">VeteransLedger Historical Archive · All content is presented for educational purposes only.</p>
  `;
}

// Overview and Historical Context can be long-form: an ordered array of
// blocks (text/image/gallery/map/document/quote/table/orbat — the same
// block types as the dossier sections below) interleaving narrative
// paragraphs with figures. Most records only have the original plain
// `summary`/`context` string — those still render as a single paragraph,
// unchanged, so search indexing (which reads these same string fields)
// is never affected by this.
function renderOverview(f) {
  if (f.overview_blocks && f.overview_blocks.length) {
    return `
    <section class="record-section">
      <h2 class="record-section__title">Overview</h2>
      ${f.overview_blocks.map((b) => `<div class="record-block">${renderBlock(b)}</div>`).join("")}
    </section>`;
  }
  if (f.summary) {
    return `
    <section class="record-section">
      <h2 class="record-section__title">Overview</h2>
      <div class="record-section__body"><p>${f.summary}</p></div>
    </section>`;
  }
  return "";
}

function renderHistoricalContext(f) {
  if (f.context_blocks && f.context_blocks.length) {
    return `
    <section class="record-section">
      <h2 class="record-section__title">Historical Context</h2>
      ${f.context_blocks.map((b) => `<div class="record-block">${renderBlock(b)}</div>`).join("")}
    </section>`;
  }
  if (f.context) {
    return `
    <section class="record-section">
      <h2 class="record-section__title">Historical Context</h2>
      <div class="record-section__body"><p>${f.context}</p></div>
    </section>`;
  }
  return "";
}

// A real, data-driven hierarchy diagram built only from fields each record
// already has — parent_formation and constituent_divisions. Never a
// fabricated image; it simply visualises relationships already present in
// the JSON, so it appears automatically for every record that has one.
function renderOrgChart(f) {
  const parent = f.parent_formation;
  const children = (f.constituent_divisions || []).filter((c) => typeof c === "object" || typeof c === "string");
  if (!parent && !children.length) return "";

  const nodeLabel = (entry) => {
    if (typeof entry === "string") return `<span class="record-orgchart__node">${entry}</span>`;
    const inner = entry.url ? `<a href="${entry.url}">${entry.title}</a>` : entry.title;
    return `<span class="record-orgchart__node">${inner}</span>`;
  };

  return `
    <div class="record-orgchart">
      ${parent ? `
        <div class="record-orgchart__tier">${nodeLabel(parent)}</div>
        <div class="record-orgchart__connector"></div>` : ""}
      <div class="record-orgchart__tier">
        <span class="record-orgchart__node record-orgchart__node--self">${f.name}</span>
      </div>
      ${children.length ? `
        <div class="record-orgchart__connector"></div>
        <div class="record-orgchart__tier">${children.map(nodeLabel).join("")}</div>` : ""}
    </div>`;
}

function renderOrganization(f) {
  const rows = [
    f.parent_formation && ["Parent Formation", formatParent(f.parent_formation)],
    f.peak_strength    && ["Peak Strength", f.peak_strength],
    f.predecessor      && ["Predecessor", f.predecessor],
    f.fate             && ["Fate", f.fate],
  ].filter(Boolean);

  const stats = f.statistics ? Object.entries(f.statistics).filter(([, v]) => v != null) : [];
  const chart = renderOrgChart(f);
  if (!rows.length && !stats.length && !chart) return "";

  const label = (k) => k.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());

  return `
    <section class="record-section">
      <h2 class="record-section__title">Organization</h2>
      ${chart}
      ${rows.length || stats.length ? `
      <dl class="record-meta-grid">
        ${rows.map(([k, v]) => `<div class="record-meta-item"><dt>${k}</dt><dd>${v}</dd></div>`).join("")}
        ${stats.map(([k, v]) => `<div class="record-meta-item"><dt>${label(k)}</dt><dd>${v}</dd></div>`).join("")}
      </dl>` : ""}
    </section>`;
}

// Subordinate entries may be a plain string (no record exists yet to link
// to) or a {id,title,url} object (a real child record — Parent → Child
// navigation per the archive relationship requirements).
function formatSubordinate(entry) {
  if (typeof entry === "string") return entry;
  if (entry && entry.title) {
    return entry.url ? `<a href="${entry.url}">${entry.title}</a>` : entry.title;
  }
  return "";
}

function renderSubordinateUnits(f) {
  const divisions = f.constituent_divisions || [];
  const vessels    = f.major_vessels || [];
  if (!divisions.length && !vessels.length) return "";

  return `
    <section class="record-section">
      <h2 class="record-section__title">Subordinate Units</h2>
      ${divisions.length ? `<ul class="record-list">${divisions.map((d) => `<li>${formatSubordinate(d)}</li>`).join("")}</ul>` : ""}
      ${vessels.length   ? `<ul class="record-list">${vessels.map((v) => `<li>${formatSubordinate(v)}</li>`).join("")}</ul>`   : ""}
    </section>`;
}

// The campaign list is always auto-derived from related_records — no
// record needs to author it by hand. An optional campaign_blocks array
// lets a record additionally place media (a campaign map, a photograph)
// inside this section once that material exists, without changing how
// the list itself is built.
function renderCampaignParticipation(f) {
  const campaigns = (f.related_records || []).filter((r) => r.type === "Campaign");
  const blocks = f.campaign_blocks || [];
  if (!campaigns.length && !blocks.length) return "";

  return `
    <section class="record-section">
      <h2 class="record-section__title">Campaign Participation</h2>
      ${blocks.map((b) => `<div class="record-block">${renderBlock(b)}</div>`).join("")}
      ${campaigns.length ? `
      <ul class="record-list">
        ${campaigns.map((c) => `<li><a href="${c.url || "#"}">${c.title || c.id}</a></li>`).join("")}
      </ul>` : ""}
    </section>`;
}

function renderSources(rec) {
  const sources = rec.sources || [];
  if (!sources.length) return "";

  const primary   = sources.filter((s) => s.type === "primary");
  const secondary = sources.filter((s) => s.type === "secondary");
  const other     = sources.filter((s) => !s.type);

  const renderList = (items) =>
    items.map((s) => `<li>${s.ref || s.title || s}${s.note ? ` — <em>${s.note}</em>` : ""}</li>`).join("");

  return `
    <section class="record-section record-section--archive">
      <h2 class="record-section__title">Sources &amp; References</h2>
      ${primary.length   ? `<div class="record-sources-group"><h3 class="record-sources-group__label">Primary Sources</h3><ol class="record-sources-list">${renderList(primary)}</ol></div>`   : ""}
      ${secondary.length ? `<div class="record-sources-group"><h3 class="record-sources-group__label">Secondary Sources</h3><ol class="record-sources-list">${renderList(secondary)}</ol></div>` : ""}
      ${other.length     ? `<div class="record-sources-group"><h3 class="record-sources-group__label">References</h3><ol class="record-sources-list">${renderList(other)}</ol></div>`           : ""}
    </section>`;
}

// Personnel, Campaigns, Letters, Armaments, then other Formations —
// matches the archive's stated cross-reference priority order.
const RELATED_TYPE_PRIORITY = ["Personnel", "Campaign", "Letter", "Armament", "Formation"];

function renderRelatedRecords(rec) {
  const related = [...(rec.related_records || [])].sort((a, b) => {
    const ai = RELATED_TYPE_PRIORITY.indexOf(a.type);
    const bi = RELATED_TYPE_PRIORITY.indexOf(b.type);
    return (ai === -1 ? RELATED_TYPE_PRIORITY.length : ai) - (bi === -1 ? RELATED_TYPE_PRIORITY.length : bi);
  });
  if (!related.length) return "";

  return `
    <section class="record-section record-section--archive">
      <h2 class="record-section__title">Related Records</h2>
      <div class="record-related-grid">
        ${related.map((r) => {
          // Related Formation cards get their own classification icon —
          // same visual identity as the rest of the archive — when the
          // target record is already loaded in formationsById.
          const target = r.type === "Formation" ? formationsById.get(r.id) : null;
          const icon = target ? getFormationIcon(target, target._category?.section) : null;
          return `
          <a class="record-related-card" href="${r.url || "/formations/" + r.id}">
            <span class="record-related-card__type">
              ${icon ? `<img class="record-card__icon" src="${icon.src}" alt="${icon.alt}">` : ""}
              ${r.type || ""}
            </span>
            <span class="record-related-card__title">${r.title || r.id}</span>
          </a>`;
        }).join("")}
      </div>
    </section>`;
}

async function init() {
  const root = document.getElementById("record-root");
  const id   = location.pathname.split("/").filter(Boolean).pop();

  if (!id) { renderError(root, "No formation ID provided."); return; }

  formationsById = await loadAllFormations();
  const formation = formationsById.get(id);
  if (!formation) { renderError(root, `Formation record "${id}" not found.`); return; }

  render(root, formation);
  attachMediaFallbacks(root);
  initAttributionModal();
  initImageLightbox();
}

function renderError(root, msg) {
  root.innerHTML = `
    <nav class="record-breadcrumb"><a href="/formations">← Back to Formations</a></nav>
    <div class="record-error">
      <div class="record-error__icon">⚔</div>
      <div class="record-error__title">Record Not Found</div>
      <p style="font-size:var(--text-sm);color:var(--text-muted)">${msg}</p>
    </div>`;
}

init();
