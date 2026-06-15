/**
 * VeteransLedger · Letters page
 * Loads letter collections and renders a list + inline viewer.
 */

const COLLECTIONS = [
  { id: "german", label: "German", file: "german.json" },
  { id: "italian", label: "Italian", file: "italian.json" },
  { id: "japanese", label: "Japanese", file: "japanese.json" },
  { id: "volunteers", label: "Volunteers", file: "volunteers.json" },
];

const listEl = document.getElementById("letters-list");
const viewerEl = document.getElementById("letter-viewer");

let allLetters = [];
let activeLang = "all";

async function init() {
  // Load all collections
  const results = await Promise.allSettled(
    COLLECTIONS.map((c) =>
      fetch(`/public/data/letters/${c.file}`)
        .then((r) => (r.ok ? r.json() : []))
        .then((data) => {
          const letters = Array.isArray(data) ? data : data?.letters || [];
          return letters.map((l) => ({ ...l, _lang: c.id }));
        }),
    ),
  );

  allLetters = results
    .filter((r) => r.status === "fulfilled")
    .flatMap((r) => r.value);

  // Wire language filter
  document.querySelector(".filter-bar")?.addEventListener("click", (e) => {
    const btn = e.target.closest(".filter-btn");
    if (!btn) return;
    activeLang = btn.dataset.lang || "all";
    document
      .querySelectorAll(".filter-btn")
      .forEach((b) => b.classList.toggle("is-active", b === btn));
    renderList();
  });

  renderList();
}

function renderList() {
  if (!listEl) return;

  const letters =
    activeLang === "all"
      ? allLetters
      : allLetters.filter((l) => l._lang === activeLang);

  if (!letters.length) {
    listEl.innerHTML = `<div class="empty-state"><div class="empty-state__icon" aria-hidden="true">✉</div><p class="empty-state__title">No letters found</p><p class="empty-state__text">This collection is being compiled.</p></div>`;
    return;
  }

  listEl.innerHTML = "";
  letters.forEach((letter, idx) => {
    const card = document.createElement("article");
    card.className = "letter-card";
    card.setAttribute("tabindex", "0");
    card.setAttribute("role", "button");
    card.setAttribute("aria-label", `Letter from ${letter.from || "unknown"}`);

    const excerpt = (
      letter.excerpt ||
      letter.content ||
      letter.text ||
      ""
    ).slice(0, 200);

    card.innerHTML = `
      <div class="letter-card__header">
        <span class="letter-card__from">${letter.from || "Unknown soldier"}</span>
        <span class="letter-card__date">${letter.date || letter.year || ""}</span>
      </div>
      ${excerpt ? `<p class="letter-card__excerpt">"${excerpt}${excerpt.length >= 200 ? "…" : ""}"</p>` : ""}
      ${letter.id ? `<a class="letter-card__deep-link" href="/letters/${letter.id}" style="display:inline-block;margin-top:8px;font-size:11px;color:var(--gold-dim);text-decoration:none;letter-spacing:0.06em;" onclick="event.stopPropagation()">Read full letter →</a>` : ""}`;

    card.addEventListener("click", () => openLetter(letter));
    card.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        openLetter(letter);
      }
    });
    listEl.appendChild(card);
  });
}

function openLetter(letter) {
  if (!viewerEl) return;
  const body = letter.content || letter.text || letter.translation || "";
  const original = letter.original || letter.originalText || "";

  viewerEl.innerHTML = `
    <p class="letter-viewer__from">${letter.from || "Unknown soldier"}</p>
    <p class="letter-viewer__date">${[letter.date, letter.location].filter(Boolean).join(" · ")}</p>
    <div class="letter-viewer__body">${body.replace(/\n/g, "<br>") || "<em>Translation pending.</em>"}</div>
    ${original ? `<div class="letter-viewer__original"><strong>Original:</strong><br>${original.replace(/\n/g, "<br>")}</div>` : ""}`;

  viewerEl.scrollIntoView({ behavior: "smooth", block: "nearest" });
}

init();
