/**
 * VeteransLedger · Armament record page
 * Reads :id from URL, searches all category/nation files, renders specifications.
 */

import { renderDossierSection, renderHistoricalPhotographsSection, attachMediaFallbacks, initAttributionModal, initImageLightbox, heroImageCandidates, isAiGeneratedImageSrc } from "/pages/shared/media-blocks.js";

const PLACEHOLDER = "/public/images/covers/placeholder-cards.webp";

const CATEGORIES = [
  "panzer",
  "aircraft",
  "naval",
  "missiles",
  "wunderwaffen",
  "equipment",
];
const NATIONS = ["germany", "italy", "japan", "other-axis"];

const CAT_LABELS = {
  panzer: "Panzers",
  aircraft: "Aircraft",
  naval: "Naval",
  missiles: "Missiles",
  wunderwaffen: "Wunderwaffen",
  equipment: "Equipment",
};

async function findArmament(id) {
  for (const cat of CATEGORIES) {
    for (const nation of NATIONS) {
      try {
        const res = await fetch(`/public/data/armaments/${cat}/${nation}.json`);
        if (!res.ok) continue;
        const data = await res.json();
        const arr = Array.isArray(data)
          ? data
          : data?.armaments || data?.items || [];
        const item = arr.find((a) => a.id === id);
        if (item) return { ...item, _category: cat, _nation: nation };
      } catch (_) {}
    }
  }
  return null;
}

function render(root, item) {
  document.title = `${item.name} · VeteransLedger`;

  const catLabel =
    CAT_LABELS[item._category] || item._category || item.category || "";
  const nationStr = (item.nation || item._nation || "").replace(/-/g, " ");

  const armor = item.armor_mm || {};
  const armament = item.armament || {};
  const primGun = armament.primary || "";
  const secGuns = Array.isArray(armament.secondary)
    ? armament.secondary
    : armament.secondary
      ? [armament.secondary]
      : [];

  // Cascades explicit image → real photo → blueprint/diagram → AI
  // illustration → placeholder, advancing on load failure instead of
  // jumping straight to the placeholder (handles the many still-broken
  // legacy /storage/... paths gracefully).
  const heroCandidates = heroImageCandidates(item, PLACEHOLDER);
  let heroIndex = 0;
  const heroWrap = document.createElement("div");
  heroWrap.className = "armament-hero-wrap";
  const heroBadge = document.createElement("span");
  heroBadge.className = "media-ai-badge";
  heroBadge.textContent = "Digital Reconstruction";
  heroBadge.hidden = true;
  const heroImg = document.createElement("img");
  heroImg.className = "record-hero-image armament-hero-image";
  heroImg.alt = item.name || "";
  const updateHeroBadge = () => {
    heroBadge.hidden = !isAiGeneratedImageSrc(item, heroImg.src.replace(location.origin, ""));
  };
  const tryNextHero = () => {
    heroIndex++;
    if (heroIndex < heroCandidates.length) { heroImg.src = heroCandidates[heroIndex]; updateHeroBadge(); }
  };
  heroImg.addEventListener("error", tryNextHero);
  heroImg.addEventListener("load", () => { if (!heroImg.naturalWidth) tryNextHero(); });
  heroImg.src = heroCandidates[0];
  updateHeroBadge();
  heroWrap.appendChild(heroBadge);
  heroWrap.appendChild(heroImg);

  root.innerHTML = `
    <nav class="record-breadcrumb" aria-label="Breadcrumb">
      <a href="/armaments">Armaments</a>
      <span class="record-breadcrumb__sep">›</span>
      ${catLabel ? `<span>${catLabel}</span><span class="record-breadcrumb__sep">›</span>` : ""}
      <span>${item.name || ""}</span>
    </nav>

    <header class="record-header">
      <div class="record-header__meta">
        ${catLabel ? `<span class="record-header__badge">${catLabel}</span>` : ""}
        ${item.designation ? `<p class="record-header__subtitle" style="color:var(--gold-dim);font-size:var(--text-sm);margin-bottom:var(--space-2);letter-spacing:0.08em;">${item.designation}</p>` : ""}
        <h1 class="record-header__title">${item.name || "Unknown"}</h1>
        <p class="record-header__subtitle">
          ${item.type ? `${item.type}` : ""}${item.type && nationStr ? " · " : ""}${nationStr}
        </p>
        ${item.years_of_service ? `<p class="record-header__dates">In service: ${item.years_of_service}</p>` : ""}
      </div>
    </header>

    <div id="record-hero-placeholder"></div>

    ${item.summary ? `<blockquote class="record-summary">${item.summary}</blockquote>` : ""}

    <section class="record-section">
      <h2 class="record-section__title">Specifications</h2>
      <table class="record-specs">
        <tbody>
          ${item.manufacturer ? `<tr><td>Manufacturer</td><td>${item.manufacturer}</td></tr>` : ""}
          ${item.type ? `<tr><td>Type</td><td>${item.type}</td></tr>` : ""}
          ${nationStr ? `<tr><td>Nation</td><td>${nationStr}</td></tr>` : ""}
          ${item.years_of_service ? `<tr><td>Years of Service</td><td>${item.years_of_service}</td></tr>` : ""}
          ${item.crew != null ? `<tr><td>Crew</td><td>${item.crew}</td></tr>` : ""}
          ${item.weight_tonnes != null ? `<tr><td>Weight</td><td>${item.weight_tonnes} tonnes</td></tr>` : ""}
          ${primGun ? `<tr><td>Primary Armament</td><td>${primGun}</td></tr>` : ""}
          ${secGuns.length ? `<tr><td>Secondary Armament</td><td>${secGuns.join("; ")}</td></tr>` : ""}
          ${armor.hull_front != null ? `<tr><td>Armour (hull front)</td><td>${armor.hull_front} mm</td></tr>` : ""}
          ${armor.turret_front != null ? `<tr><td>Armour (turret front)</td><td>${armor.turret_front} mm</td></tr>` : ""}
          ${armor.hull_side != null ? `<tr><td>Armour (hull side)</td><td>${armor.hull_side} mm</td></tr>` : ""}
          ${item.engine ? `<tr><td>Engine</td><td>${item.engine}</td></tr>` : ""}
          ${item.speed_kmh != null ? `<tr><td>Max Speed</td><td>${item.speed_kmh} km/h</td></tr>` : ""}
          ${item.range_km != null ? `<tr><td>Operational Range</td><td>${item.range_km} km</td></tr>` : ""}
          ${item.units_produced != null ? `<tr><td>Units Produced</td><td>${item.units_produced.toLocaleString()}</td></tr>` : ""}
        </tbody>
      </table>
    </section>

    ${renderHistoricalContext(item)}
    ${renderFullReport(item)}
    ${renderTimelineRefs(item)}
    ${renderHistoricalPhotographsSection("Historical Photographs", item.dossier?.photos)}
    ${renderDossierSection("Combat Photography", item.dossier?.combat_photos)}
    ${renderDossierSection("Blueprint Archive", item.dossier?.blueprints)}
    ${renderDossierSection("Technical Drawings", item.dossier?.diagrams)}
    ${renderDossierSection("Factory Documentation", item.dossier?.factory_documents)}
    ${renderDossierSection("Technical Manuals", item.dossier?.manuals)}
    ${renderDossierSection("Maintenance Manuals", item.dossier?.maintenance_manuals)}
    ${renderDossierSection("Testing Reports", item.dossier?.testing_reports)}
    ${renderDossierSection("Operational Maps", item.dossier?.maps)}
    ${renderSources(item)}
    ${renderRelatedRecords(item, "/armaments")}

    <p class="record-archive-note">VeteransLedger Historical Archive · All content is presented for educational purposes only.</p>
  `;

  // Replace placeholder div with the pre-built hero img (handler attached before src was set)
  const placeholder = root.querySelector("#record-hero-placeholder");
  if (placeholder) placeholder.replaceWith(heroWrap);
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
    renderError(root, "No armament ID provided.");
    return;
  }

  const item = await findArmament(id);
  if (!item) {
    renderError(root, `Armament record "${id}" not found.`);
    return;
  }

  render(root, item);
  attachMediaFallbacks(root);
  initAttributionModal();
  initImageLightbox();
}

function renderError(root, msg) {
  root.innerHTML = `
    <nav class="record-breadcrumb"><a href="/armaments">← Back to Armaments</a></nav>
    <div class="record-error">
      <div class="record-error__icon">✛</div>
      <div class="record-error__title">Record Not Found</div>
      <p style="font-size:var(--text-sm);color:var(--text-muted)">${msg}</p>
    </div>`;
}

init();
