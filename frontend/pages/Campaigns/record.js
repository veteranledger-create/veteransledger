/**
 * VeteransLedger · Campaign record page
 * Reads :id from URL, fetches the matching campaign JSON, renders details.
 */

const PLACEHOLDER = "/public/images/covers/placeholder-cards.webp";

const THEATER_FILES = {
  "eastern-front": [
    "barbarossa",
    "blue",
    "caucasus",
    "kharkov",
    "kiev",
    "leningrad",
    "moscow",
    "stalingrad",
  ],
  "western-front": [
    "britain",
    "bulge",
    "bzura",
    "dieppe",
    "dunkirk",
    "france",
    "market-garden",
    "normandy",
    "norway",
    "poland",
    "warsaw",
  ],
  africa: ["alamein-1", "alamein-2", "gazala", "sonnenblume", "tobruk"],
  italy: ["cassino", "crete", "gothic-line", "sicily", "taranto"],
  atlantic: [
    "altmark",
    "atlantic",
    "convoy-war",
    "rheinubung",
    "river-plate",
    "uboat-campaing",
  ],
};

const THEATER_LABELS = {
  "eastern-front": "Eastern Front",
  "western-front": "Western Front",
  africa: "North Africa",
  italy: "Italy",
  atlantic: "Atlantic",
};

async function findCampaign(id) {
  for (const [theater, files] of Object.entries(THEATER_FILES)) {
    if (!files.includes(id)) continue;
    const res = await fetch(`/public/data/campaigns/${theater}/${id}.json`);
    if (res.ok) return { ...(await res.json()), _theater: theater };
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

function render(root, campaign) {
  const theater = campaign._theater || campaign.theater || "";
  const theaterLabel = THEATER_LABELS[theater] || theater;
  const img = campaign.image || PLACEHOLDER;
  const dateStart = formatDate(campaign.dates?.start);
  const dateEnd = formatDate(campaign.dates?.end);
  const dateStr =
    dateStart && dateEnd ? `${dateStart} – ${dateEnd}` : dateStart || "";

  document.title = `${campaign.title} · VeteransLedger`;

  const axisCmd = campaign.combatants?.axis?.commanders || [];
  const axisNat = campaign.combatants?.axis?.nations || [];
  const axisStr = campaign.combatants?.axis?.strength || "";
  const alliedCmd = campaign.combatants?.allied?.commanders || [];
  const alliedStr = campaign.combatants?.allied?.strength || "";
  const phases = campaign.phases || [];

  root.innerHTML = `
    <nav class="record-breadcrumb" aria-label="Breadcrumb">
      <a href="/campaigns">Campaigns</a>
      <span class="record-breadcrumb__sep">›</span>
      <span>${theaterLabel}</span>
      <span class="record-breadcrumb__sep">›</span>
      <span>${campaign.title || ""}</span>
    </nav>

    <header class="record-header">
      <div class="record-header__meta">
        ${theaterLabel ? `<span class="record-header__badge">${theaterLabel}</span>` : ""}
        <h1 class="record-header__title">${campaign.title || "Unknown Campaign"}</h1>
        ${dateStr ? `<p class="record-header__dates">${dateStr}</p>` : ""}
      </div>
    </header>

    <img class="record-hero-image" src="${img}" alt="${campaign.title || ""}" onerror="this.onerror=null;this.src='${PLACEHOLDER}'">

    ${campaign.summary ? `<blockquote class="record-summary">${campaign.summary}</blockquote>` : ""}

    ${
      campaign.background
        ? `
    <section class="record-section">
      <h2 class="record-section__title">Background</h2>
      <div class="record-section__body"><p>${campaign.background}</p></div>
    </section>`
        : ""
    }

    ${
      axisCmd.length || alliedCmd.length
        ? `
    <section class="record-section">
      <h2 class="record-section__title">Combatants</h2>
      <div class="record-combatants">
        <div class="record-combatant">
          <div class="record-combatant__label">Axis Forces</div>
          ${axisNat.length ? `<ul>${axisNat.map((n) => `<li>${n}</li>`).join("")}</ul>` : ""}
          ${axisStr ? `<p style="font-size:var(--text-xs);color:var(--text-muted);margin-top:var(--space-3)">Strength: ${axisStr}</p>` : ""}
          ${axisCmd.length ? `<p style="font-size:var(--text-xs);color:var(--text-muted);margin-top:var(--space-2)">Commanders: ${axisCmd.join(", ")}</p>` : ""}
        </div>
        <div class="record-combatant">
          <div class="record-combatant__label">Allied Forces</div>
          ${alliedStr ? `<p style="font-size:var(--text-xs);color:var(--text-muted)">Strength: ${alliedStr}</p>` : ""}
          ${alliedCmd.length ? `<p style="font-size:var(--text-xs);color:var(--text-muted);margin-top:var(--space-2)">Commanders: ${alliedCmd.join(", ")}</p>` : ""}
        </div>
      </div>
    </section>`
        : ""
    }

    ${
      phases.length
        ? `
    <section class="record-section">
      <h2 class="record-section__title">Phases of Operation</h2>
      <ol class="record-phases">
        ${phases
          .map(
            (ph) => `
          <li class="record-phase">
            <div>
              <div class="record-phase__name">${ph.name || ""}</div>
              ${ph.objective ? `<div class="record-phase__objective">Objective: ${ph.objective}</div>` : ""}
              ${ph.result ? `<div class="record-phase__result">${ph.result}</div>` : ""}
            </div>
          </li>`,
          )
          .join("")}
      </ol>
    </section>`
        : ""
    }

    ${
      campaign.outcome
        ? `
    <section class="record-section">
      <h2 class="record-section__title">Outcome</h2>
      <div class="record-section__body"><p>${campaign.outcome}</p></div>
    </section>`
        : ""
    }

    ${
      campaign.casualties?.germany ||
      campaign.casualties?.soviet ||
      campaign.casualties?.allied ||
      Object.keys(campaign.casualties || {}).length
        ? `
    <section class="record-section">
      <h2 class="record-section__title">Casualties</h2>
      <table class="record-specs">
        <tbody>
          ${Object.entries(campaign.casualties || {})
            .map(
              ([k, v]) => `
          <tr><td>${k.charAt(0).toUpperCase() + k.slice(1)}</td><td>${v}</td></tr>`,
            )
            .join("")}
        </tbody>
      </table>
    </section>`
        : ""
    }

    ${
      campaign.significance
        ? `
    <section class="record-section">
      <h2 class="record-section__title">Historical Significance</h2>
      <div class="record-section__body"><p>${campaign.significance}</p></div>
    </section>`
        : ""
    }

    ${renderHistoricalContext(campaign)}
    ${renderFullReport(campaign)}
    ${renderTimelineRefs(campaign)}
    ${renderMedia(campaign)}
    ${renderSources(campaign)}
    ${renderRelatedRecords(campaign, "/campaigns")}

    <p class="record-archive-note">VeteransLedger Historical Archive · All content is presented for educational purposes only.</p>
  `;
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

  const campaign = await findCampaign(id);
  if (!campaign) {
    renderError(root, `Campaign record "${id}" not found.`);
    return;
  }

  render(root, campaign);
}

function renderError(root, msg) {
  root.innerHTML = `
    <nav class="record-breadcrumb"><a href="/campaigns">← Back to Campaigns</a></nav>
    <div class="record-error">
      <div class="record-error__icon">✛</div>
      <div class="record-error__title">Record Not Found</div>
      <p style="font-size:var(--text-sm);color:var(--text-muted)">${msg}</p>
    </div>`;
}

init();
