/**
 * VeteransLedger · Search page
 * Full client-side search across all JSON data files.
 */

const form = document.getElementById("search-form");
const input = document.getElementById("search-input");
const results = document.getElementById("search-results");
const filterBtns = document.querySelectorAll("[data-type]");

const PLACEHOLDER = "/public/images/covers/placeholder-cards.webp";

let activeType = "all";
let searchIndex = null;

// ── Data source manifests ──────────────────────────────────────

const CAMPAIGN_FILES = [
  ["eastern-front", "barbarossa.json"], ["eastern-front", "blue.json"],
  ["eastern-front", "caucasus.json"],   ["eastern-front", "kharkov.json"],
  ["eastern-front", "kiev.json"],       ["eastern-front", "leningrad.json"],
  ["eastern-front", "moscow.json"],     ["eastern-front", "stalingrad.json"],
  ["western-front", "britain.json"],    ["western-front", "bulge.json"],
  ["western-front", "bzura.json"],      ["western-front", "dieppe.json"],
  ["western-front", "dunkirk.json"],    ["western-front", "france.json"],
  ["western-front", "market-garden.json"], ["western-front", "normandy.json"],
  ["western-front", "norway.json"],     ["western-front", "poland.json"],
  ["western-front", "warsaw.json"],
  ["africa",   "alamein-1.json"], ["africa",   "alamein-2.json"],
  ["africa",   "gazala.json"],    ["africa",   "sonnenblume.json"],
  ["africa",   "tobruk.json"],
  ["italy",    "cassino.json"],   ["italy",    "crete.json"],
  ["italy",    "gothic-line.json"], ["italy",  "sicily.json"],
  ["italy",    "taranto.json"],
  ["atlantic", "altmark.json"],   ["atlantic", "atlantic.json"],
  ["atlantic", "convoy-war.json"], ["atlantic", "rheinubung.json"],
  ["atlantic", "river-plate.json"], ["atlantic", "uboat-campaing.json"],
];

// Armaments has no hardcoded file list — like Formations below, the real
// (category, nation) pairs are read from index.json, regenerated at
// publish-promotion time from an actual directory scan. A newly promoted
// file (e.g. naval/romania.json) becomes searchable automatically.

const ARTICLE_FILES = [
  ["military",  "poland-1939.json"],
  ["military",  "rearmament.json"],
  ["political", "anschluss.json"],
  ["political", "july-20.json"],
  ["political", "rise-nsdap.json"],
  ["legal",     "nuremberg.json"],
];

const LETTER_FILES     = ["german.json", "italian.json", "japanese.json", "volunteers.json"];
const PERSONNEL_FILES  = ["army.json", "luftwaffe.json", "kriegsmarine.json", "waffen-ss.json", "foreign.json"];

// Formations loaded dynamically from index.json

// Known abbreviations / aliases not present in the source text
const FORMATION_ALIASES = {
  "leibstandarte-ss-ah":   "lssah lah 1st ss leibstandarte",
  "ss-division-das-reich": "dr 2nd ss das reich",
  "ss-division-totenkopf": "totenkopf death head skull 3rd ss",
  "ss-division-wiking":    "wiking 5th ss viking",
  "i-ss-panzer-corps":     "i ss panzer corps 1st ss panzer corps",
  "ii-ss-panzer-corps":    "ii ss panzer corps 2nd ss panzer corps",
  "army-group-north":      "agn heeresgruppe nord",
  "army-group-centre":     "agc heeresgruppe mitte army group center",
  "army-group-south":      "ags heeresgruppe sud sue heeresgruppe south",
  "6th-army":              "sixth army stalingrad paulus 6. armee",
  "4th-panzer-army":       "4th panzer hoth 4. panzerarmee",
  "panzergruppe-2":        "panzer group 2 guderian pzgr 2nd panzer army",
  "panzerarmee-afrika":    "dak deutsches afrikakorps rommel africa korps",
};

// Classification icon for a formation search result — mirrors the same
// shield > flag > star / branch / echelon priority used on the Formations
// listing and record pages, so identity stays visually consistent everywhere.
const FORMATION_ICON_BASE = "/public/images/icons/formations";
const FORMATION_BRANCH_ICON_BASE = "/public/images/icons/branches";

function getSearchFormationIcon(f, section) {
  const type = (f.type || "").toLowerCase();

  if (section === "waffen-ss")    return { src: `${FORMATION_BRANCH_ICON_BASE}/ss.svg`, alt: "Waffen-SS" };
  if (section === "luftwaffe")    return { src: `${FORMATION_BRANCH_ICON_BASE}/luftwaffe.svg`, alt: "Luftwaffe" };
  if (section === "kriegsmarine") return { src: `${FORMATION_BRANCH_ICON_BASE}/marine.svg`, alt: "Kriegsmarine" };
  if (section === "volunteers") {
    if (f.shield) return { src: f.shield, alt: `${f.nation || "Volunteer"} legion shield` };
    if (f.flag)   return { src: f.flag,   alt: f.nation || "Volunteer formation" };
    return { src: `${FORMATION_ICON_BASE}/volunteer.svg`, alt: "Volunteer formation" };
  }

  if (type.includes("army group")) return { src: `${FORMATION_ICON_BASE}/army-group.svg`, alt: "Army Group" };
  if (type.includes("army"))       return { src: `${FORMATION_ICON_BASE}/army.svg`,       alt: "Army" };
  if (type.includes("corps"))      return { src: `${FORMATION_ICON_BASE}/corps.svg`,      alt: "Corps" };
  if (type.includes("division"))  return { src: `${FORMATION_ICON_BASE}/division.svg`,   alt: "Division" };
  if (type.includes("brigade"))   return { src: `${FORMATION_ICON_BASE}/brigade.svg`,    alt: "Brigade" };
  if (type.includes("regiment"))  return { src: `${FORMATION_ICON_BASE}/regiment.svg`,   alt: "Regiment" };
  if (type.includes("battalion")) return { src: `${FORMATION_ICON_BASE}/battalion.svg`,  alt: "Battalion" };
  if (type.includes("company"))   return { src: `${FORMATION_ICON_BASE}/company.svg`,    alt: "Company" };
  return null;
}

// Normalise umlauts so users can type without them
function normalise(str) {
  return String(str).toLowerCase()
    .replace(/ü/g, "u").replace(/ö/g, "o").replace(/ä/g, "a")
    .replace(/ß/g, "ss");
}

// ── Index builder ──────────────────────────────────────────────

async function buildIndex() {
  const index = [];

  const safeFetch = async (url) => {
    try {
      const r = await fetch(url);
      return r.ok ? r.json() : null;
    } catch (_) { return null; }
  };

  // Load formation index and armaments index first, then all their real
  // files in parallel with everything else — same pattern for both, since
  // neither has a list that can be safely hardcoded.
  const formationIndex = await safeFetch("/public/data/formations/index.json");
  const formationCategories = formationIndex?.categories || [];

  const armamentsIndex = await safeFetch("/public/data/armaments/index.json");
  const armamentFiles = (armamentsIndex?.categories || []).flatMap(
    (cat) => (cat.nations || []).map((nation) => [cat.id, nation]),
  );

  const [
    personnelResults,
    campaignResults,
    armamentResults,
    articleResults,
    letterResults,
    formationResults,
  ] = await Promise.all([
    Promise.all(PERSONNEL_FILES.map((f) => safeFetch(`/public/data/personnel/${f}`))),
    Promise.all(CAMPAIGN_FILES.map(([t, f]) => safeFetch(`/public/data/campaigns/${t}/${f}`))),
    Promise.all(armamentFiles.map(([c, n]) => safeFetch(`/public/data/armaments/${c}/${n}.json`))),
    Promise.all(ARTICLE_FILES.map(([c, f]) => safeFetch(`/public/data/articles/${c}/${f}`))),
    Promise.all(LETTER_FILES.map((f) => safeFetch(`/public/data/letters/${f}`))),
    Promise.all(formationCategories.map((cat) => safeFetch(cat.file))),
  ]);

  // Personnel
  personnelResults.forEach((data) => {
    const people = Array.isArray(data) ? data : data?.personnel || data?.people || [];
    people.forEach((p) => {
      if (!p?.id) return;
      index.push({
        type: "PERSON",
        title: p.name || p.fullName || "Unknown",
        summary: p.summary || p.biography || "",
        image: p.portrait || p.image || p.photo || null,
        url: `/personnel/${p.id}`,
        category: "Personnel",
        searchText: [
          p.name, p.fullName, p.rank, p.title, p.nation, p.nationality,
          p.summary, p.biography, p.born, p.died, p.id,
        ].filter(Boolean).join(" ").toLowerCase(),
      });
    });
  });

  // Campaigns — each file is a single campaign object
  campaignResults.forEach((data) => {
    if (!data?.id) return;
    const context = typeof data.historical_context === "string"
      ? data.historical_context
      : Array.isArray(data.historical_context)
        ? data.historical_context.join(" ")
        : "";
    index.push({
      type: "CAMPAIGN",
      title: data.title || "Unknown",
      summary: data.summary || "",
      image: data.image || null,
      url: `/campaigns/${data.id}`,
      category: data.theater || "Campaign",
      searchText: [
        data.title, data.summary, data.theater, data.location, data.id,
        Array.isArray(data.commanders) ? data.commanders.join(" ") : data.commanders,
        context,
      ].filter(Boolean).join(" ").toLowerCase(),
    });
  });

  // Armaments — full-schema files are a plain array; minor-schema files
  // wrap their array under a category-specific key (vehicles/aircraft/
  // vessels/weapons/equipment), never a single generic one — find
  // whichever property actually holds an array rather than guessing.
  armamentResults.forEach((data, i) => {
    const arr = Array.isArray(data) ? data : Object.values(data || {}).find((v) => Array.isArray(v)) ?? [];
    const [cat] = armamentFiles[i];
    arr.forEach((a) => {
      // Minor-schema records have no stable id in the static source data
      // — without one there's no working /armaments/:id destination to
      // index, so these are correctly excluded rather than given a link
      // that would 404. They'll become searchable once that category is
      // migrated to the database and a real id exists.
      if (!a?.id) return;
      index.push({
        type: "ARMAMENT",
        title: a.name || "Unknown",
        summary: a.summary || "",
        image: a.image || null,
        url: `/armaments/${a.id}`,
        category: cat.charAt(0).toUpperCase() + cat.slice(1),
        searchText: [
          a.name, a.type, a.nation, a.designation, a.summary,
          a.manufacturer, a.id,
        ].filter(Boolean).join(" ").toLowerCase(),
      });
    });
  });

  // Articles — each file is a single article object
  articleResults.forEach((data) => {
    if (!data?.id) return;
    const bodyText = Array.isArray(data.body)
      ? data.body.map((b) => b.text || "").join(" ")
      : (typeof data.body === "string" ? data.body : "");
    const summary = data.summary
      || (Array.isArray(data.body) ? (data.body.find((b) => b.type === "paragraph")?.text || "") : "");
    index.push({
      type: "ARTICLE",
      title: data.title || "Unknown",
      summary,
      image: data.image || (Array.isArray(data.images) ? data.images[0] : null) || null,
      url: `/articles/${data.id}`,
      category: (data.category || "Article").replace(/-/g, " "),
      searchText: [
        data.title, data.subtitle, data.summary, data.author, data.id,
        Array.isArray(data.tags) ? data.tags.join(" ") : "",
        bodyText,
      ].filter(Boolean).join(" ").toLowerCase(),
    });
  });

  // Letters — each file is an array
  letterResults.forEach((data) => {
    const letters = Array.isArray(data) ? data : data?.letters || [];
    letters.forEach((l) => {
      if (!l?.id) return;
      index.push({
        type: "LETTER",
        title: l.subject || `Letter from ${l.from || "Unknown"}`,
        summary: l.excerpt || (typeof l.full_text === "string" ? l.full_text.slice(0, 160) : ""),
        image: null,
        url: `/letters/${l.id}`,
        category: "Letter",
        searchText: normalise([
          l.subject, l.from, l.from_unit, l.to, l.location_written,
          l.nation, l.excerpt, l.context, l.notes, l.id,
        ].filter(Boolean).join(" ")),
      });
    });
  });

  // Formations — loaded dynamically from index.json categories
  formationResults.forEach((data, i) => {
    const section = formationCategories[i]?.section;
    const arr = Array.isArray(data) ? data : [];
    arr.forEach((f) => {
      if (!f?.id) return;
      const commanders = Array.isArray(f.commanders)
        ? f.commanders.map((c) => (typeof c === "string" ? c : c.name || "")).join(" ")
        : "";
      const divisions = Array.isArray(f.constituent_divisions)
        ? f.constituent_divisions.map((d) => (typeof d === "string" ? d : d.title || "")).join(" ")
        : "";
      index.push({
        type: "FORMATION",
        title: f.name || "Unknown",
        summary: f.summary || "",
        image: null,
        icon: getSearchFormationIcon(f, section),
        url: `/formations/${f.id}`,
        category: f.service || f.type || "Formation",
        searchText: normalise([
          f.name, f.type, f.service, f.nation, f.theater, f.region,
          f.summary, f.context, commanders, divisions,
          f.id, FORMATION_ALIASES[f.id] || "",
        ].filter(Boolean).join(" ")),
      });
    });
  });

  return index;
}

// ── Search controller ──────────────────────────────────────────

const urlParams = new URLSearchParams(location.search);
const initialQuery = urlParams.get("q") || "";
if (input && initialQuery) {
  input.value = initialQuery;
  runSearch(initialQuery);
}

filterBtns.forEach((btn) => {
  btn.addEventListener("click", () => {
    activeType = btn.dataset.type;
    filterBtns.forEach((b) => b.classList.toggle("is-active", b === btn));
    if (input?.value.trim()) runSearch(input.value.trim());
  });
});

form?.addEventListener("submit", (e) => {
  e.preventDefault();
  const q = input?.value.trim();
  if (q) runSearch(q);
});

async function runSearch(query) {
  if (!results) return;
  results.innerHTML = `<div class="loader"><span class="loader__dot"></span><span class="loader__dot"></span><span class="loader__dot"></span></div>`;

  const url = new URL(location.href);
  url.searchParams.set("q", query);
  history.replaceState({}, "", url.toString());

  if (!searchIndex) {
    searchIndex = await buildIndex();
  }

  const words = normalise(query).trim().split(/\s+/).filter(Boolean);

  const matched = searchIndex.filter((item) => {
    if (activeType !== "all" && item.type !== activeType) return false;
    return words.every((word) => item.searchText.includes(word));
  });

  renderResults(matched, query);
}

// ── Renderer ───────────────────────────────────────────────────

function renderResults(items, query) {
  if (!results) return;

  if (!items.length) {
    results.innerHTML = `<div class="empty-state">
      <div class="empty-state__icon" aria-hidden="true">⌕</div>
      <p class="empty-state__title">No results for "${escapeHtml(query)}"</p>
      <p class="empty-state__text">Try different keywords or browse the archive sections.</p>
    </div>`;
    return;
  }

  const heading = document.createElement("p");
  heading.style.cssText = "font-size:var(--text-sm);color:var(--text-muted);margin-bottom:var(--space-6);";
  heading.textContent = `${items.length} result${items.length !== 1 ? "s" : ""} for "${query}"`;

  const grid = document.createElement("div");
  grid.className = "record-grid";

  items.forEach((item) => {
    const card = document.createElement("a");
    card.className = "record-card";
    card.href = item.url;

    if (item.image) {
      const imageDiv = document.createElement("div");
      imageDiv.className = "record-card__image";
      const img = document.createElement("img");
      img.alt = item.title;
      img.loading = "lazy";
      img.decoding = "async";
      img.addEventListener("error", () => { img.src = PLACEHOLDER; }, { once: true });
      img.addEventListener("load", () => { if (!img.naturalWidth) img.src = PLACEHOLDER; }, { once: true });
      img.src = item.image;
      imageDiv.appendChild(img);
      card.appendChild(imageDiv);
    }

    const body = document.createElement("div");
    body.className = "record-card__body";
    body.innerHTML = `
      <div class="record-card__header">
        <span class="record-card__type">
          ${item.icon ? `<img class="record-card__icon" src="${item.icon.src}" alt="${escapeHtml(item.icon.alt)}">` : ""}
          <span class="record-card__badge">${escapeHtml(item.category || item.type)}</span>
        </span>
      </div>
      <h3 class="record-card__title">${escapeHtml(item.title)}</h3>
      ${item.summary ? `<p class="record-card__summary">${escapeHtml(item.summary.slice(0, 160))}${item.summary.length > 160 ? "…" : ""}</p>` : ""}`;

    const footer = document.createElement("div");
    footer.className = "record-card__footer";
    footer.innerHTML = `<span class="record-card__read-more">View record →</span>`;

    card.appendChild(body);
    card.appendChild(footer);
    grid.appendChild(card);

    const iconImg = card.querySelector(".record-card__icon");
    if (iconImg) iconImg.addEventListener("error", () => iconImg.remove(), { once: true });
  });

  results.innerHTML = "";
  results.appendChild(heading);
  results.appendChild(grid);
}

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
