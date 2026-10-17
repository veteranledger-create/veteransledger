/**
 * VeteransLedger · Admin — section navigation and page header
 *
 * Replaces the former flat 20-item tablist with a grouped, collapsible
 * sidebar (desktop) / drawer (mobile), plus a contextual page header.
 *
 * Deliberately additive: every button it renders keeps the existing
 * `.admin-tab-btn[data-tab="…"]` contract, so admin.js's activateTab(),
 * its delegated click/keyboard handlers, the dirty-guard integration and
 * all 20 panel modules keep working with no changes of their own.
 *
 * The active section is observed rather than intercepted — a MutationObserver
 * on the panels' `hidden` attribute drives the header, mirroring the passive
 * approach admin-modal-stack.js already uses. That means any other code path
 * that switches tabs (keyboard nav, programmatic activation) updates the
 * header for free.
 *
 * English-only by design: the Admin has no locale system (see
 * layouts/AdminLayout/admin-layout.js). No i18n hooks are introduced here.
 */

// Each entry maps an existing panel to its place in the information
// architecture. `store` records which persistence mechanism actually owns
// the data, because the Admin edits two different ones and conflating them
// has caused real incidents (see storage/admin-restructure/).
//   db   — PostgreSQL via Prisma
//   file — JSON under public/data, written through /api/site-content
//   mixed/tool — operational tooling rather than a single content store
const NAV = [
  {
    group: "Overview",
    items: [
      { tab: "tab-overview", label: "Dashboard", store: "tool",
        desc: "Archive totals and recent administrative activity." },
    ],
  },
  {
    group: "Archive",
    items: [
      { tab: "tab-personnel",  label: "Personnel",       store: "db",   desc: "Individual service records and biographies." },
      { tab: "tab-armaments",  label: "Armaments",       store: "db",   desc: "Weapons, vehicles, aircraft and naval vessels." },
      { tab: "tab-formations", label: "Formations",      store: "db",   desc: "Units, divisions and volunteer formations." },
      { tab: "tab-campaigns",  label: "Campaigns",       store: "db",   desc: "Operations and campaign records by theatre." },
      { tab: "tab-timeline",   label: "Timeline",        store: "db",   desc: "Dated events across the archive period." },
      { tab: "tab-articles",   label: "Articles",        store: "db",   desc: "Long-form written archive articles." },
      { tab: "tab-letters",    label: "Letters",         store: "db",   desc: "Correspondence and personal documents." },
      { tab: "tab-awards",     label: "Awards",          store: "db",   desc: "Decorations and awards records." },
      { tab: "tab-maps",       label: "Maps",            store: "db",   desc: "Historical maps and cartographic material." },
      { tab: "tab-poldocs",    label: "Political Docs",  store: "db",   desc: "Political documents and official papers." },
      { tab: "tab-nsdap",      label: "NSDAP",           store: "file", desc: "NSDAP reference content: overview, timeline and glossary." },
    ],
  },
  {
    group: "Content Operations",
    items: [
      { tab: "tab-pages",        label: "Content Pages", store: "file", desc: "About, legal and site-policy page content." },
      { tab: "tab-homepage",     label: "Homepage",      store: "file", desc: "Homepage hero text and archive cards." },
      { tab: "tab-navigation",   label: "Navigation",    store: "file", desc: "Primary navigation, brand and footer links." },
      { tab: "tab-page-content", label: "Page Content",  store: "file", desc: "Per-page hero and meta text for public pages." },
      { tab: "tab-settings",     label: "Site Settings", store: "file", desc: "Site identity, contact details and disclaimers." },
      { tab: "tab-translations", label: "Translations",  store: "db",   desc: "Translation coverage across the eight public locales." },
      { tab: "tab-media",        label: "Media Library", store: "db",   desc: "Uploaded media assets and their attribution." },
    ],
  },
  {
    group: "System",
    items: [
      { tab: "tab-publish", label: "Publish", store: "tool",
        desc: "Validate, stage and promote archive content to the public site." },
    ],
  },
];

const STORE_LABEL = { db: "Database", file: "File-backed", tool: "Operations" };
const STORE_TITLE = {
  db: "Saved to PostgreSQL through this section's own API.",
  file: "Saved as JSON under public/data via the site-content API.",
  tool: "Operational tooling — does not own a content store of its own.",
};

const byTab = new Map();
NAV.forEach((g) => g.items.forEach((i) => byTab.set(i.tab, { ...i, group: g.group })));

function el(id) { return document.getElementById(id); }

function renderNav() {
  const nav = el("admin-nav");
  if (!nav) return;
  nav.innerHTML = NAV.map((g) => `
    <div class="admin-nav__group">
      <p class="admin-nav__group-label">${g.group}</p>
      <ul class="admin-nav__list" role="tablist" aria-label="${g.group}">
        ${g.items.map((i) => `
          <li>
            <button type="button" class="admin-tab-btn admin-nav__item" data-tab="${i.tab}"
              role="tab" aria-selected="false">
              <span class="admin-nav__item-label">${i.label}</span>
            </button>
          </li>`).join("")}
      </ul>
    </div>`).join("");
}

// Keeps the header, the stats grid and the drawer in step with whichever
// panel is currently visible, whatever caused the change.
function syncToActivePanel() {
  const active = document.querySelector(".admin-tab-panel:not([hidden])");
  const meta = active ? byTab.get(active.id) : null;

  // activateTab() already sets this on click; doing it here too is
  // idempotent and covers first paint, where the default panel is visible
  // but no button has been clicked yet.
  if (active) {
    document.querySelectorAll(".admin-tab-btn").forEach((b) => {
      const on = b.dataset.tab === active.id;
      b.classList.toggle("is-active", on);
      b.setAttribute("aria-selected", on ? "true" : "false");
    });
  }

  const crumb = el("admin-crumb");
  const title = el("admin-page-title");
  const desc = el("admin-page-desc");
  if (meta) {
    // The store badge makes the persistence boundary visible: this archive
    // edits PostgreSQL-backed records and file-backed JSON through different
    // mechanisms, and conflating them has caused real data loss before.
    if (crumb) {
      crumb.innerHTML =
        `Admin · ${meta.group}` +
        `<span class="admin-store-badge admin-store-badge--${meta.store}"` +
        ` title="${STORE_TITLE[meta.store]}">${STORE_LABEL[meta.store]}</span>`;
    }
    if (title) title.textContent = meta.label;
    if (desc) {
      desc.textContent = meta.desc;
      desc.hidden = !meta.desc;
    }
  }

  // Dashboard metrics belong to Overview; they used to render above every
  // section regardless of where the administrator actually was.
  const stats = el("stats-grid");
  if (stats) stats.hidden = !active || active.id !== "tab-overview";

  closeDrawer();
}

// ── Mobile drawer ───────────────────────────────────────────
function setDrawer(open) {
  const nav = el("admin-nav");
  const toggle = el("admin-nav-toggle");
  if (!nav) return;
  nav.classList.toggle("is-open", open);
  toggle?.setAttribute("aria-expanded", String(open));
  document.body.classList.toggle("admin-nav-open", open);
}
function closeDrawer() { setDrawer(false); }

export function initAdminNav() {
  renderNav();

  el("admin-nav-toggle")?.addEventListener("click", () => {
    const nav = el("admin-nav");
    setDrawer(!nav?.classList.contains("is-open"));
  });

  // Escape closes the drawer; it never traps focus because the drawer is a
  // navigation surface, not a dialog.
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") closeDrawer();
  });

  // Passive observation of panel visibility — no interception of activateTab.
  const observer = new MutationObserver(syncToActivePanel);
  document.querySelectorAll(".admin-tab-panel").forEach((p) => {
    observer.observe(p, { attributes: true, attributeFilter: ["hidden"] });
  });

  syncToActivePanel();
}

// Runs during module evaluation so the buttons exist before admin.js's
// init() wires aria-controls across them.
initAdminNav();
