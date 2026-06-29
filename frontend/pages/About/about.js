/**
 * VeteransLedger · About page
 * Loads mission and sources data and renders content.
 */

async function init() {
  const [missionData, sourcesData] = await Promise.allSettled([
    fetch("/public/data/about/mission.json").then((r) =>
      r.ok ? r.json() : null,
    ),
    fetch("/public/data/about/sources.json").then((r) =>
      r.ok ? r.json() : null,
    ),
  ]);

  renderMission(document.getElementById("mission-content"), missionData.value);
  renderSources(document.getElementById("sources-content"), sourcesData.value);
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
