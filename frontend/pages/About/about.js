/**
 * VeteransLedger · About page
 * Loads mission and sources data and renders content.
 */

import { loadTranslation, machineNoticeHtml } from "/pages/shared/translation-loader.js";
import { onLocaleChange } from "/pages/shared/i18n.js";

async function init() {
  const [missionData, sourcesData] = await Promise.allSettled([
    fetch("/public/data/about/mission.json").then((r) =>
      r.ok ? r.json() : null,
    ),
    fetch("/public/data/about/sources.json").then((r) =>
      r.ok ? r.json() : null,
    ),
  ]);

  const missionEl = document.getElementById("mission-content");
  const sourcesEl = document.getElementById("sources-content");
  renderMission(missionEl, missionData.value);
  renderSources(sourcesEl, sourcesData.value);

  const applyTranslations = () => {
    applySiteContentTranslation("about/mission.json", missionEl, renderMission, missionData.value);
    applySiteContentTranslation("about/sources.json", sourcesEl, renderSources, sourcesData.value);
  };
  applyTranslations();
  onLocaleChange(applyTranslations);
}

// site_content translations store the whole source file as one re-translated
// JSON string (see translations.service.ts generate()), so applying one means
// parsing it back and re-running the existing English renderer with the
// translated data. On any miss (no translation for this locale) or parse
// failure, re-renders with the original English data — without this, a
// switch back to English (or to a locale with no translation) would leave
// stale translated content on screen.
async function applySiteContentTranslation(entityId, container, renderFn, englishData) {
  if (!container) return;
  const t = await loadTranslation("site_content", entityId);
  let data = englishData;
  let isMachine = false;
  if (t?.fields?.content) {
    try { data = JSON.parse(t.fields.content); isMachine = t.isMachine; }
    catch { /* translated content isn't valid JSON — keep English */ }
  }
  renderFn(container, data);
  container.querySelector(":scope > .vl-mt-notice")?.remove();
  if (isMachine) container.insertAdjacentHTML("afterbegin", machineNoticeHtml({ isMachine: true }));
}

function renderMission(container, data) {
  if (!container) return;

  if (!data) {
    container.innerHTML = `
      <blockquote class="about-mission">
        A comprehensive archival project dedicated to documenting the military, political, and
        technological history of the Axis powers during World War II.
      </blockquote>
      <div class="article-body">
        <p>
          VeteransLedger is a personal historical archive maintained for educational purposes.
          Our goal is to preserve primary sources, biographies, and operational records that
          might otherwise be lost to history.
        </p>
        <p>
          All content is presented with strict historical objectivity. The archive neither
          promotes nor endorses the ideologies, regimes, or actions documented herein.
        </p>
      </div>
      <p class="about-team-signature">— VeteransLedger Archive Team</p>`;
    return;
  }

  const desc = data.description || data.mission || data.content || "";
  container.innerHTML = `
    ${data.headline ? `<blockquote class="about-mission">${data.headline}</blockquote>` : ""}
    <div class="article-body"><p>${desc.replace(/\n\n/g, "</p><p>")}</p></div>
    <p class="about-team-signature">— VeteransLedger Archive Team</p>`;
}

function renderSources(container, data) {
  if (!container) return;

  if (!data) {
    container.innerHTML = `
      <div class="article-body">
        <p>
          Content in this archive is researched from primary and secondary historical sources
          including official military records, published histories, academic works, and
          contemporary documents.
        </p>
        <p>
          When available, original language documents are provided alongside translations.
          All sources are cited within their respective record entries.
        </p>
      </div>`;
    return;
  }

  const sources = Array.isArray(data) ? data : data.sources || [];
  const intro = data.description || data.methodology || "";

  let html = intro ? `<div class="article-body"><p>${intro}</p></div>` : "";

  if (sources.length) {
    html +=
      `<ul class="sources-list">` +
      sources
        .map(
          (s, i) => `
        <li class="sources-list__item">
          <span class="sources-list__num">${i + 1}.</span>
          <strong>${s.title || s.name || "Unknown"}</strong>
          ${s.author ? ` — ${s.author}` : ""}
          ${s.year ? ` (${s.year})` : ""}
          ${s.notes ? `<br><span style="color:var(--text-muted)">${s.notes}</span>` : ""}
        </li>`,
        )
        .join("") +
      `</ul>`;
  }

  container.innerHTML =
    html ||
    "<p style='color:var(--text-muted)'>Source list being compiled.</p>";
}

init();
