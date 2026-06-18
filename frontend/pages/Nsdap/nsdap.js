/**
 * VeteransLedger · NSDAP archive page
 * Renders all NSDAP archive sections from structured JSON.
 * Never falls back to JSON.stringify — every section has a dedicated renderer.
 */

const cache = {};
let activeSection = "overview";
let activeHitlerSub = "bio";
let activePartySub = "structure";

const DATA_MAP = {
  overview: "/public/data/nsdap/overview.json",
  hitler_bio: "/public/data/nsdap/hitler/bio.json",
  hitler_family: "/public/data/nsdap/hitler/family.json",
  hitler_rise: "/public/data/nsdap/hitler/rise.json",
  hitler_chancellorship: "/public/data/nsdap/hitler/chancellorship.json",
  hitler_rule: "/public/data/nsdap/hitler/rule.json",
  hitler_wartime: "/public/data/nsdap/hitler/wartime.json",
  hitler_end: "/public/data/nsdap/hitler/end.json",
  party_structure: "/public/data/nsdap/party/structure.json",
  party_leadership: "/public/data/nsdap/party/leadership.json",
  party_organizations: "/public/data/nsdap/party/organizations.json",
  party_departments: "/public/data/nsdap/party/departments.json",
  party_programme: "/public/data/nsdap/party/programme.json",
  party_religion: "/public/data/nsdap/party/religion.json",
  party_formation: "/public/data/nsdap/party/formation.json",
  party_foreign_policy: "/public/data/nsdap/party/foreign-policy.json",
  party_economy: "/public/data/nsdap/party/economy.json",
  party_state_relations: "/public/data/nsdap/party/state-relations.json",
  party_dissolution: "/public/data/nsdap/party/dissolution.json",
  timeline: "/public/data/nsdap/timeline.json",
  glossary: "/public/data/nsdap/glossary.json",
};

async function load(key) {
  if (key in cache) return cache[key];
  const url = DATA_MAP[key];
  if (!url) {
    cache[key] = null;
    return null;
  }
  try {
    const res = await fetch(url);
    cache[key] = res.ok ? await res.json() : null;
  } catch (_) {
    cache[key] = null;
  }
  return cache[key];
}

/* ── Init ───────────────────────────────────────────────────── */

async function init() {
  document.getElementById("nsdap-tabs")?.addEventListener("click", (e) => {
    const btn = e.target.closest(".category-tab");
    if (!btn) return;
    activeSection = btn.dataset.section;
    document
      .querySelectorAll("#nsdap-tabs .category-tab")
      .forEach((b) => b.classList.toggle("is-active", b === btn));
    showSection(activeSection);
  });

  await load("overview");
  showSection("overview");
}

async function showSection(id) {
  document.querySelectorAll(".nsdap-section").forEach((sec) => {
    sec.hidden = sec.id !== id;
  });
  const container = document.getElementById(id);
  if (!container) return;

  if (id === "overview") {
    await load("overview");
    renderOverview(container, cache.overview);
  } else if (id === "hitler") {
    const keys = [
      "hitler_bio",
      "hitler_family",
      "hitler_rise",
      "hitler_chancellorship",
      "hitler_rule",
      "hitler_wartime",
      "hitler_end",
    ];
    await Promise.all(keys.map(load));
    renderHitlerSection(container);
  } else if (id === "party") {
    const keys = [
      "party_structure",
      "party_leadership",
      "party_organizations",
      "party_departments",
      "party_programme",
      "party_religion",
      "party_formation",
      "party_foreign_policy",
      "party_economy",
      "party_state_relations",
      "party_dissolution",
    ];
    await Promise.all(keys.map(load));
    renderPartySection(container);
  } else if (id === "timeline") {
    await load("timeline");
    renderTimeline(container, cache.timeline);
  } else if (id === "glossary") {
    await load("glossary");
    renderGlossary(container, cache.glossary);
  }
}

/* ── Overview ────────────────────────────────────────────────── */

function renderOverview(container, data) {
  if (!data) {
    container.innerHTML = renderEmpty("Overview content is being compiled.");
    return;
  }
  const desc = data.description || "";
  const paras = desc.split(/\n\n+/).filter(Boolean);

  container.innerHTML = `
    <div class="nsdap-overview">
      <div class="article-body nsdap-overview__body">
        ${paras.map((p) => `<p>${p}</p>`).join("") || "<p>Historical documentation being compiled.</p>"}
        ${
          data.youth_wings?.length
            ? `
          <h3>Youth Organisations</h3>
          <ul>${data.youth_wings.map((w) => `<li>${w}</li>`).join("")}</ul>`
            : ""
        }
        ${
          data.paramilitary?.length
            ? `
          <h3>Paramilitary Formations</h3>
          <ul>${data.paramilitary.map((p) => `<li>${p}</li>`).join("")}</ul>`
            : ""
        }
      </div>
      <aside class="nsdap-facts">
        <p class="nsdap-facts__title">Party Facts</p>
        ${data.founded ? factRow("Founded", data.founded) : ""}
        ${data.dissolved ? factRow("Dissolved", data.dissolved) : ""}
        ${data.leader ? factRow("Leader", data.leader) : ""}
        ${data.ideology ? factRow("Ideology", data.ideology) : ""}
        ${data.peakMembership ? factRow("Peak Members", data.peakMembership) : ""}
        ${data.headquarters ? factRow("HQ", data.headquarters) : ""}
        ${data.newspaper ? factRow("Newspaper", data.newspaper) : ""}
        ${data.anthem ? factRow("Anthem", data.anthem) : ""}
      </aside>
    </div>
    ${
      data.note
        ? `<div class="nsdap-disclaimer" role="note" style="margin-top:var(--space-8)">
      <span class="nsdap-disclaimer__icon" aria-hidden="true">⚠</span>
      <div class="nsdap-disclaimer__text">${data.note}</div>
    </div>`
        : ""
    }
  `;
}

function factRow(label, value) {
  return `<div class="nsdap-facts__row">
    <span class="nsdap-facts__label">${label}</span>
    <span class="nsdap-facts__value">${value}</span>
  </div>`;
}

/* ── Hitler Section ─────────────────────────────────────────── */

const HITLER_SUBS = [
  { id: "bio", label: "Biography" },
  { id: "family", label: "Family" },
  { id: "rise", label: "Rise to Power" },
  { id: "chancellorship", label: "Chancellorship" },
  { id: "rule", label: "War & Ideology" },
  { id: "wartime", label: "War Leader" },
  { id: "end", label: "Fall & Death" },
];

function renderHitlerSection(container) {
  if (container.dataset.wired === "1") {
    switchHitlerSub(activeHitlerSub);
    return;
  }
  container.dataset.wired = "1";

  container.innerHTML = `
    <div class="nsdap-sub-tabs" id="hitler-sub-tabs" role="tablist">
      ${HITLER_SUBS.map(
        (s) => `
        <button type="button" class="category-tab${s.id === activeHitlerSub ? " is-active" : ""}"
          role="tab" data-hitler-sub="${s.id}">${s.label}</button>`,
      ).join("")}
    </div>
    <div id="hitler-sub-content"></div>
  `;

  container
    .querySelector("#hitler-sub-tabs")
    ?.addEventListener("click", (e) => {
      const btn = e.target.closest("[data-hitler-sub]");
      if (!btn) return;
      activeHitlerSub = btn.dataset.hitlerSub;
      container
        .querySelectorAll("[data-hitler-sub]")
        .forEach((b) => b.classList.toggle("is-active", b === btn));
      switchHitlerSub(activeHitlerSub);
    });

  switchHitlerSub(activeHitlerSub);
}

function switchHitlerSub(sub) {
  const out = document.getElementById("hitler-sub-content");
  if (!out) return;
  const data = cache[`hitler_${sub}`];
  if (!data) {
    out.innerHTML = renderEmpty("This section is being compiled.");
    return;
  }

  if (sub === "bio") renderBio(out, data);
  else renderSectionDoc(out, data);
}

function renderBio(container, data) {
  const bio = data.biography || "";
  const paras = bio.split(/\n\n+/).filter(Boolean);
  const el = data.early_life || {};

  container.innerHTML = `
    <div class="nsdap-overview" style="margin-top:var(--space-6)">
      <div class="article-body">
        ${paras.map((p) => `<p>${p}</p>`).join("")}
        ${el.childhood ? `<h3>Childhood</h3><p>${el.childhood}</p>` : ""}
        ${el.vienna ? `<h3>Vienna Years</h3><p>${el.vienna}</p>` : ""}
        ${el.ww1 ? `<h3>First World War</h3><p>${el.ww1}</p>` : ""}
      </div>
      <aside class="nsdap-facts">
        <p class="nsdap-facts__title">Biographical Data</p>
        ${factRow("Born", data.born || "")}
        ${factRow("Birthplace", data.birthplace || "")}
        ${factRow("Died", data.died || "")}
        ${data.place_of_death ? factRow("Place of Death", data.place_of_death) : ""}
        ${(data.titles || []).map((t) => factRow("Title", t)).join("")}
      </aside>
    </div>
    ${renderSources(data.sources)}
  `;
}

/* ── Section Document (generic sections array renderer) ─────── */

function renderSectionDoc(container, data) {
  const sections = data.sections || [];
  const summary = data.summary || data.description || "";

  container.innerHTML = `
    <div style="margin-top:var(--space-6);max-width:780px">
      ${data.title ? `<h2 class="nsdap-section-title">${data.title}</h2>` : ""}
      ${summary ? `<p class="nsdap-section-summary"><em>${summary}</em></p>` : ""}
      <div class="article-body">
        ${sections
          .map(
            (s) => `
          ${s.heading ? `<h3>${s.heading}</h3>` : ""}
          <p>${s.text || s.body || ""}</p>
        `,
          )
          .join("")}
      </div>
      ${renderSources(data.sources)}
    </div>
  `;
}

/* ── Party Section ───────────────────────────────────────────── */

const PARTY_SUBS = [
  { id: "structure", label: "Structure" },
  { id: "leadership", label: "Leadership" },
  { id: "departments", label: "Departments" },
  { id: "organizations", label: "Organizations" },
  { id: "programme", label: "Programme" },
  { id: "religion", label: "Religion" },
  { id: "formation", label: "Formation" },
  { id: "foreign_policy", label: "Foreign Policy" },
  { id: "economy", label: "Economy" },
  { id: "state_relations", label: "Party & State" },
  { id: "dissolution", label: "Dissolution" },
];

function renderPartySection(container) {
  if (container.dataset.wired === "1") {
    switchPartySub(activePartySub);
    return;
  }
  container.dataset.wired = "1";

  container.innerHTML = `
    <div class="nsdap-sub-tabs" id="party-sub-tabs" role="tablist">
      ${PARTY_SUBS.map(
        (s) => `
        <button type="button" class="category-tab${s.id === activePartySub ? " is-active" : ""}"
          role="tab" data-party-sub="${s.id}">${s.label}</button>`,
      ).join("")}
    </div>
    <div id="party-sub-content"></div>
  `;

  container.querySelector("#party-sub-tabs")?.addEventListener("click", (e) => {
    const btn = e.target.closest("[data-party-sub]");
    if (!btn) return;
    activePartySub = btn.dataset.partySub;
    container
      .querySelectorAll("[data-party-sub]")
      .forEach((b) => b.classList.toggle("is-active", b === btn));
    switchPartySub(activePartySub);
  });

  switchPartySub(activePartySub);
}

function switchPartySub(sub) {
  const out = document.getElementById("party-sub-content");
  if (!out) return;
  const data = cache[`party_${sub}`];
  if (!data) {
    out.innerHTML = renderEmpty("This section is being compiled.");
    return;
  }

  if (sub === "structure") renderStructure(out, data);
  else if (sub === "leadership") renderLeadership(out, data);
  else if (sub === "organizations") renderOrganizations(out, data);
  else if (sub === "departments") renderDepartments(out, data);
  else if (sub === "programme") renderProgramme(out, data);
  else if (sub === "religion") renderSectionDoc(out, data);
  else if (sub === "formation") renderContentDoc(out, data);
  else if (sub === "foreign_policy") renderForeignPolicy(out, data);
  else if (sub === "economy") renderEconomy(out, data);
  else if (sub === "state_relations") renderContentDoc(out, data);
  else if (sub === "dissolution") renderContentDoc(out, data);
}

function renderStructure(container, data) {
  const hierarchy = data.hierarchy || [];
  const orgs = data.affiliated_organisations || [];

  container.innerHTML = `
    <div class="article-body" style="margin-top:var(--space-6);max-width:780px">
      ${data.description ? `<p>${data.description}</p>` : ""}
      ${
        hierarchy.length
          ? `
        <h3>Hierarchical Structure</h3>
        <div style="display:flex;flex-direction:column;gap:var(--space-4);margin-bottom:var(--space-8)">
          ${hierarchy
            .map(
              (h) => `
            <div style="display:grid;grid-template-columns:12px 1fr;gap:var(--space-4);align-items:start">
              <div style="width:8px;height:8px;border-radius:50%;background:var(--gold-dim);margin-top:5px;flex-shrink:0"></div>
              <div>
                <div style="font-family:var(--font-display);font-size:var(--text-sm);color:var(--gold);margin-bottom:var(--space-1)">${h.level}</div>
                <div style="font-size:var(--text-sm);color:var(--text-secondary);line-height:1.65">${h.description}</div>
              </div>
            </div>`,
            )
            .join("")}
        </div>
      `
          : ""
      }
      ${
        orgs.length
          ? `
        <h3>Affiliated Organisations</h3>
        <table style="width:100%;border-collapse:collapse;font-size:var(--text-sm)">
          ${orgs
            .map(
              (o) => `
            <tr>
              <td style="padding:var(--space-2) var(--space-3);border-bottom:1px solid var(--border-dim);color:var(--gold-dim);white-space:nowrap;vertical-align:top;font-weight:600">${o.name}</td>
              <td style="padding:var(--space-2) var(--space-3);border-bottom:1px solid var(--border-dim);color:var(--text-secondary);line-height:1.55">${o.role}</td>
            </tr>`,
            )
            .join("")}
        </table>
      `
          : ""
      }
    </div>
  `;
}

function renderLeadership(container, data) {
  const leaders = data.leaders || [];
  container.innerHTML = `
    <div style="margin-top:var(--space-6)">
      ${data.description ? `<p style="font-size:var(--text-sm);color:var(--text-secondary);margin-bottom:var(--space-6);max-width:680px">${data.description}</p>` : ""}
      <div style="display:flex;flex-direction:column;gap:var(--space-3)">
        ${leaders
          .map(
            (l) => `
          <div style="padding:var(--space-4) var(--space-5);background:var(--bg-card);border:1px solid var(--border-dim);border-left:3px solid var(--border-gold);border-radius:var(--radius)">
            <div style="display:flex;align-items:baseline;gap:var(--space-3);flex-wrap:wrap;margin-bottom:var(--space-1)">
              <span style="font-family:var(--font-display);font-size:var(--text-base);color:var(--text-primary)">${l.name}</span>
              <span style="font-size:var(--text-xs);color:var(--gold-dim);text-transform:uppercase;letter-spacing:0.08em">${l.role}</span>
            </div>
            ${l.fate ? `<p style="font-size:var(--text-xs);color:var(--text-muted);margin:0">Post-war fate: ${l.fate}</p>` : ""}
          </div>`,
          )
          .join("")}
      </div>
    </div>
  `;
}

function renderOrganizations(container, data) {
  const orgs = data.organisations || [];
  container.innerHTML = `
    <div style="margin-top:var(--space-6);display:flex;flex-direction:column;gap:var(--space-5)">
      ${orgs
        .map(
          (o) => `
        <div style="padding:var(--space-5) var(--space-6);background:var(--bg-card);border:1px solid var(--border-dim);border-left:3px solid var(--border-gold);border-radius:var(--radius)">
          <div style="display:flex;align-items:baseline;gap:var(--space-3);flex-wrap:wrap;margin-bottom:var(--space-2)">
            <span style="font-family:var(--font-display);font-size:var(--text-base);color:var(--text-primary)">${o.name}</span>
            ${o.founded ? `<span style="font-size:var(--text-xs);color:var(--text-muted)">Est. ${o.founded}</span>` : ""}
            ${o.peak_membership ? `<span style="font-size:var(--text-xs);color:var(--gold-dim)">Peak: ${o.peak_membership}</span>` : ""}
          </div>
          <p style="font-size:var(--text-sm);color:var(--text-secondary);line-height:1.65;margin:0">${o.description}</p>
        </div>`,
        )
        .join("")}
    </div>
  `;
}

function renderDepartments(container, data) {
  const rl = data.reichsleiters || [];
  const deps = data.departments || [];
  const bh = data.brown_house;

  container.innerHTML = `
    <div style="margin-top:var(--space-6);max-width:780px">
      ${data.summary ? `<p class="article-body" style="margin-bottom:var(--space-6)"><em>${data.summary}</em></p>` : ""}

      ${
        rl.length
          ? `
        <h3 style="font-family:var(--font-display);font-size:var(--text-lg);color:var(--text-primary);margin:var(--space-6) 0 var(--space-5)">Reichsleiters</h3>
        <div style="display:flex;flex-direction:column;gap:var(--space-4)">
          ${rl
            .map(
              (l) => `
            <div style="padding:var(--space-5);background:var(--bg-card);border:1px solid var(--border-dim);border-radius:var(--radius)">
              <div style="display:flex;align-items:baseline;gap:var(--space-3);flex-wrap:wrap;margin-bottom:var(--space-2)">
                <span style="font-family:var(--font-display);font-size:var(--text-base);color:var(--text-primary)">${l.name}</span>
                <span style="font-size:var(--text-xs);color:var(--gold-dim);text-transform:uppercase;letter-spacing:0.06em">${l.title}</span>
              </div>
              <p style="font-size:var(--text-sm);color:var(--text-secondary);line-height:1.65;margin:0 0 var(--space-2)">${l.role}</p>
              ${l.fate ? `<p style="font-size:var(--text-xs);color:var(--text-muted);margin:0">Fate: ${l.fate}</p>` : ""}
            </div>`,
            )
            .join("")}
        </div>
      `
          : ""
      }

      ${
        deps.length
          ? `
        <h3 style="font-family:var(--font-display);font-size:var(--text-lg);color:var(--text-primary);margin:var(--space-8) 0 var(--space-5)">Party Departments</h3>
        <table style="width:100%;border-collapse:collapse;font-size:var(--text-sm)">
          <thead>
            <tr>
              <th style="text-align:left;padding:var(--space-2) var(--space-3);border-bottom:1px solid var(--border-gold);color:var(--gold-dim);font-size:var(--text-xs);letter-spacing:0.1em;text-transform:uppercase">Department</th>
              <th style="text-align:left;padding:var(--space-2) var(--space-3);border-bottom:1px solid var(--border-gold);color:var(--gold-dim);font-size:var(--text-xs);letter-spacing:0.1em;text-transform:uppercase">Head</th>
              <th style="text-align:left;padding:var(--space-2) var(--space-3);border-bottom:1px solid var(--border-gold);color:var(--gold-dim);font-size:var(--text-xs);letter-spacing:0.1em;text-transform:uppercase">Function</th>
            </tr>
          </thead>
          <tbody>
            ${deps
              .map(
                (d) => `
              <tr>
                <td style="padding:var(--space-3);border-bottom:1px solid var(--border-dim);color:var(--gold-dim);font-weight:600;vertical-align:top;font-size:var(--text-xs)">${d.name}</td>
                <td style="padding:var(--space-3);border-bottom:1px solid var(--border-dim);color:var(--text-muted);vertical-align:top;white-space:nowrap">${d.head}</td>
                <td style="padding:var(--space-3);border-bottom:1px solid var(--border-dim);color:var(--text-secondary);line-height:1.55">${d.function}</td>
              </tr>`,
              )
              .join("")}
          </tbody>
        </table>
      `
          : ""
      }

      ${
        bh
          ? `
        <h3 style="font-family:var(--font-display);font-size:var(--text-lg);color:var(--text-primary);margin:var(--space-8) 0 var(--space-4)">${bh.title}</h3>
        <p class="article-body">${bh.text}</p>
      `
          : ""
      }

      ${renderSources(data.sources)}
    </div>
  `;
}

function renderProgramme(container, data) {
  const points = data.points || [];
  container.innerHTML = `
    <div style="margin-top:var(--space-6);max-width:780px">
      <h2 class="nsdap-section-title">${data.title || "NSDAP Programme"}</h2>
      ${data.announced ? `<p style="font-size:var(--text-xs);color:var(--text-muted);margin-bottom:var(--space-2)">Announced: ${data.announced}${data.location ? " · " + data.location : ""}</p>` : ""}
      ${data.context ? `<p class="article-body" style="margin-bottom:var(--space-8)"><em>${data.context}</em></p>` : ""}

      <div style="display:flex;flex-direction:column;gap:var(--space-4)">
        ${points
          .map(
            (p) => `
          <div style="padding:var(--space-5);background:var(--bg-card);border:1px solid var(--border-dim);border-left:3px solid var(--border-gold);border-radius:var(--radius)">
            <div style="font-family:var(--font-display);font-size:var(--text-xs);color:var(--gold-dim);letter-spacing:0.12em;margin-bottom:var(--space-2)">POINT ${p.number}</div>
            <p style="font-size:var(--text-sm);color:var(--text-primary);margin:0 0 var(--space-3);font-style:italic;line-height:1.6">"${p.text}"</p>
            ${p.analysis ? `<p style="font-size:var(--text-xs);color:var(--text-muted);line-height:1.6;margin:0">${p.analysis}</p>` : ""}
          </div>`,
          )
          .join("")}
      </div>

      ${
        data.declaration_of_immutability
          ? `
        <div style="margin-top:var(--space-8);padding:var(--space-5);background:var(--bg-card);border:1px solid var(--border-dim);border-radius:var(--radius)">
          <p style="font-family:var(--font-display);font-size:var(--text-xs);color:var(--gold-dim);letter-spacing:0.12em;margin-bottom:var(--space-2)">DECLARATION OF IMMUTABILITY (1926)</p>
          <p style="font-size:var(--text-sm);color:var(--text-secondary);line-height:1.65;margin:0">${data.declaration_of_immutability}</p>
        </div>`
          : ""
      }

      ${renderSources(data.sources)}
    </div>
  `;
}

function renderContentDoc(container, data) {
  const paras = (data.content || data.description || "").split(/\n\n+/).filter(Boolean);
  container.innerHTML = `
    <div style="margin-top:var(--space-6);max-width:780px">
      ${data.title ? `<h2 class="nsdap-section-title">${data.title}</h2>` : ""}
      ${data.description && data.content ? `<p class="nsdap-section-summary"><em>${data.description}</em></p>` : ""}
      <div class="article-body">
        ${paras.map((p) => `<p>${p}</p>`).join("")}
      </div>
      ${renderSources(data.sources)}
    </div>
  `;
}

function renderForeignPolicy(container, data) {
  const objectives = data.objectives || [];
  const milestones = data.milestones || [];
  container.innerHTML = `
    <div style="margin-top:var(--space-6);max-width:780px">
      ${data.title ? `<h2 class="nsdap-section-title">${data.title}</h2>` : ""}
      ${data.description ? `<p class="nsdap-section-summary"><em>${data.description}</em></p>` : ""}
      ${objectives.length ? `
        <h3 style="font-family:var(--font-display);font-size:var(--text-base);color:var(--text-primary);margin:var(--space-6) 0 var(--space-4)">Core Objectives</h3>
        <ul style="display:flex;flex-direction:column;gap:var(--space-2);padding-left:var(--space-5)">
          ${objectives.map((o) => `<li style="font-size:var(--text-sm);color:var(--text-secondary);line-height:1.65">${o}</li>`).join("")}
        </ul>` : ""}
      ${milestones.length ? `
        <h3 style="font-family:var(--font-display);font-size:var(--text-base);color:var(--text-primary);margin:var(--space-8) 0 var(--space-4)">Key Milestones</h3>
        <div style="display:flex;flex-direction:column;gap:0">
          ${milestones.map((m) => `
            <div style="display:grid;grid-template-columns:60px 1fr;gap:var(--space-4);padding:var(--space-4) 0;border-bottom:1px solid var(--border-dim)">
              <span style="font-family:var(--font-display);font-size:var(--text-sm);color:var(--gold);padding-top:2px">${m.year}</span>
              <p style="font-size:var(--text-sm);color:var(--text-secondary);line-height:1.65;margin:0">${m.event}</p>
            </div>`).join("")}
        </div>` : ""}
      ${renderSources(data.sources)}
    </div>
  `;
}

function renderEconomy(container, data) {
  const policies = data.policies || [];
  container.innerHTML = `
    <div style="margin-top:var(--space-6);max-width:780px">
      ${data.title ? `<h2 class="nsdap-section-title">${data.title}</h2>` : ""}
      ${data.description ? `<p class="nsdap-section-summary"><em>${data.description}</em></p>` : ""}
      <div style="display:flex;flex-direction:column;gap:var(--space-5)">
        ${policies.map((p) => `
          <div style="padding:var(--space-5) var(--space-6);background:var(--bg-card);border:1px solid var(--border-dim);border-left:3px solid var(--border-gold);border-radius:var(--radius)">
            <h3 style="font-family:var(--font-display);font-size:var(--text-sm);color:var(--gold-dim);letter-spacing:0.06em;margin-bottom:var(--space-3)">${p.heading}</h3>
            <p style="font-size:var(--text-sm);color:var(--text-secondary);line-height:1.7;margin:0">${p.text}</p>
          </div>`).join("")}
      </div>
      ${renderSources(data.sources)}
    </div>
  `;
}

/* ── Timeline ────────────────────────────────────────────────── */

function renderTimeline(container, data) {
  const events = Array.isArray(data) ? data : data?.events || [];
  if (!events.length) {
    container.innerHTML = renderEmpty("Timeline content is being compiled.");
    return;
  }

  const byYear = {};
  events.forEach((e) => {
    const yr = e.year || (e.date ? parseInt(e.date) : 0);
    if (!byYear[yr]) byYear[yr] = [];
    byYear[yr].push(e);
  });

  const years = Object.keys(byYear).sort((a, b) => +a - +b);
  container.innerHTML = `
    <div style="max-width:780px">
      ${years
        .map(
          (yr) => `
        <div style="margin-bottom:var(--space-8)">
          <h3 style="font-family:var(--font-display);font-size:var(--text-xl);color:var(--gold);border-bottom:1px solid var(--border-base);padding-bottom:var(--space-2);margin-bottom:var(--space-4)">${yr}</h3>
          <div style="display:flex;flex-direction:column;gap:var(--space-4)">
            ${byYear[yr]
              .map(
                (e) => `
              <div style="display:grid;grid-template-columns:120px 1fr;gap:var(--space-4)">
                <div style="font-size:var(--text-xs);color:var(--text-muted);padding-top:3px">${e.date || e.year || ""}</div>
                <div>
                  <div style="font-family:var(--font-display);font-size:var(--text-sm);color:var(--text-primary);margin-bottom:var(--space-1)">${e.title || e.event || ""}</div>
                  <div style="font-size:var(--text-sm);color:var(--text-secondary);line-height:1.65">${e.description || e.summary || ""}</div>
                </div>
              </div>`,
              )
              .join("")}
          </div>
        </div>`,
        )
        .join("")}
    </div>
  `;
}

/* ── Glossary ────────────────────────────────────────────────── */

function renderGlossary(container, data) {
  const terms = Array.isArray(data) ? data : data?.terms || [];
  if (!terms.length) {
    container.innerHTML = renderEmpty("Glossary is being compiled.");
    return;
  }

  container.innerHTML = `
    <div style="max-width:780px">
      ${terms
        .map(
          (t) => `
        <div style="padding:var(--space-5) 0;border-bottom:1px solid var(--border-dim)">
          <h3 style="font-family:var(--font-display);font-size:var(--text-sm);color:var(--gold);letter-spacing:0.06em;margin-bottom:var(--space-1)">${t.term}</h3>
          ${t.origin ? `<p style="font-size:var(--text-xs);color:var(--text-muted);font-style:italic;margin:0 0 var(--space-2)">${t.origin}</p>` : ""}
          <p style="font-size:var(--text-sm);color:var(--text-secondary);line-height:1.65;margin:0">${t.definition}</p>
        </div>`,
        )
        .join("")}
    </div>
  `;
}

/* ── Shared: Sources / Citations ────────────────────────────── */

function renderSources(sources) {
  if (!sources?.length) return "";
  return `
    <div style="margin-top:var(--space-10);padding-top:var(--space-6);border-top:1px solid var(--border-dim)">
      <p style="font-family:var(--font-display);font-size:var(--text-xs);color:var(--gold-dim);letter-spacing:0.15em;text-transform:uppercase;margin-bottom:var(--space-4)">Sources &amp; References</p>
      <ol style="padding-left:var(--space-5);display:flex;flex-direction:column;gap:var(--space-2)">
        ${sources
          .map(
            (s) => `
          <li style="font-size:var(--text-xs);color:var(--text-muted);line-height:1.6">
            ${s.ref || [s.author, s.title, s.year, s.type].filter(Boolean).join(". ")}
            ${s.note ? ` — <em>${s.note}</em>` : ""}
          </li>`,
          )
          .join("")}
      </ol>
    </div>
  `;
}

/* ── Utilities ───────────────────────────────────────────────── */

function renderEmpty(msg = "Content pending compilation.") {
  return `<div class="empty-state">
    <div class="empty-state__icon" aria-hidden="true">✛</div>
    <p class="empty-state__title">${msg}</p>
  </div>`;
}

/* ── Sub-tab CSS injected once ──────────────────────────────── */

const _style = document.createElement("style");
_style.textContent = `
  .nsdap-sub-tabs {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-2);
    padding: var(--space-4) 0;
    margin-bottom: var(--space-2);
    border-bottom: 1px solid var(--border-dim);
  }
  .nsdap-sub-tabs .category-tab { font-size: var(--text-xs); padding: 4px var(--space-4); }
  .nsdap-section-title {
    font-family: var(--font-display);
    font-size: var(--text-xl);
    color: var(--text-primary);
    margin-bottom: var(--space-2);
  }
  .nsdap-section-summary {
    font-size: var(--text-md);
    color: var(--text-secondary);
    line-height: 1.7;
    margin-bottom: var(--space-8);
    display: block;
  }
`;
document.head.appendChild(_style);

init();
