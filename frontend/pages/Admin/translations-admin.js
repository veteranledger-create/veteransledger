import { authHeader, escHtml, safeJson } from "./admin-utils.js";

/**
 * VeteransLedger · Admin — Translation Dashboard
 * Global coverage + bulk-action view across every translatable content type.
 * Complements (does not replace) the per-record TranslationsPanel embedded
 * in each module — this tab answers "what's missing" across the whole site;
 * the per-record panel is where an editor does the detailed field editing.
 */

const LOCALE_NAMES = {
  de: "German", ja: "Japanese", it: "Italian", ru: "Russian",
  es: "Spanish", fr: "French", uk: "Ukrainian", ar: "Arabic",
};
const TYPE_LABELS = {
  record: "Records",
  entity: "Personnel",
  timeline_event: "Timeline Events",
  site_content: "Global Site Content",
};
const STATUS_LABELS = { missing: "Missing", machine: "Machine Translated", human: "Human Reviewed", published: "Published" };
const STATUS_CLASSES = {
  missing: "tl-badge--none",
  machine: "tl-badge--machine",
  human: "tl-badge--human",
  published: "tl-badge--published",
};

// Global, single-file site_content keys. Per-page content (About, NSDAP
// chapters, legal pages, etc.) already has its own TranslationsPanel inside
// the Pages and NSDAP admin tabs — duplicating that full manifest here would
// create two sources of truth, so this dashboard's site_content scope is
// the global config files plus aggregate counts from the summary endpoint.
const SITE_CONTENT_KEYS = [
  { id: "homepage.json", title: "Homepage" },
  { id: "navigation.json", title: "Navigation & Footer" },
  { id: "site-settings.json", title: "Site Settings" },
  { id: "page-content.json", title: "Page Content (hero/meta for every page)" },
];

const PAGE_SIZE = 20;
let currentPage = 1;
let mtAvailable = true; // refreshed from /api/translations/status on tab open

function init() {
  document.getElementById("admin-tabs")?.addEventListener("click", (e) => {
    if (e.target.closest('[data-tab="tab-translations"]')) {
      loadMtStatus().then(() => {
        loadSummary();
        currentPage = 1;
        loadItems();
      });
    }
  });

  document.getElementById("tl-dash-type")?.addEventListener("change", () => { currentPage = 1; loadItems(); });
  document.getElementById("tl-dash-locale")?.addEventListener("change", () => loadItems());
  document.getElementById("tl-dash-status-filter")?.addEventListener("change", () => loadItems());

  let searchTimer;
  document.getElementById("tl-dash-search")?.addEventListener("input", () => {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(() => { currentPage = 1; loadItems(); }, 350);
  });

  document.getElementById("tl-dash-bulk-generate")?.addEventListener("click", bulkGenerateMissing);
}

// ── Machine-translation availability ─────────────────────────────────────────

async function loadMtStatus() {
  try {
    const res = await fetch("/api/translations/status", { headers: authHeader() });
    mtAvailable = res.ok ? (await safeJson(res)).available === true : false;
  } catch {
    mtAvailable = false; // fail safe: manual-only mode, never broken buttons
  }
  const banner = document.getElementById("tl-dash-mt-banner");
  if (banner) {
    banner.innerHTML = mtAvailable ? "" : `
      <p class="tl-mt-unavailable">Translation service not configured — automatic translation is disabled.
      Translations can still be written manually from each record's translation panel.</p>`;
  }
  const bulkBtn = document.getElementById("tl-dash-bulk-generate");
  if (bulkBtn) {
    bulkBtn.disabled = !mtAvailable;
    bulkBtn.title = mtAvailable ? "" : "Automatic translation is disabled — no provider is configured.";
  }
}

// ── Summary ──────────────────────────────────────────────────────────────────

async function loadSummary() {
  const el = document.getElementById("tl-dash-summary");
  if (!el) return;
  el.innerHTML = `<p class="text-dim">Loading coverage…</p>`;
  try {
    const res = await fetch("/api/translations/dashboard", { headers: authHeader() });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const rows = await safeJson(res);
    el.innerHTML = renderSummaryTable(rows);
  } catch (err) {
    el.innerHTML = `<p class="text-dim" style="color:#e0a060;">Failed to load summary: ${escHtml(err.message)}</p>`;
  }
}

function renderSummaryTable(rows) {
  if (!rows.length) return `<p class="text-dim">No translation data yet.</p>`;
  const locales = Object.keys(LOCALE_NAMES);
  return `
    <table class="admin-table">
      <thead><tr>
        <th>Content Type</th><th>Source Total</th>
        ${locales.map((l) => `<th>${LOCALE_NAMES[l]}</th>`).join("")}
      </tr></thead>
      <tbody>
        ${rows.map((row) => `
          <tr>
            <td>${escHtml(TYPE_LABELS[row.entityType] || row.entityType)}</td>
            <td>${row.sourceTotal ?? "—"}</td>
            ${locales.map((l) => {
              const c = row.locales[l] || {};
              const missing = c.missing;
              const hasMissing = typeof missing === "number" && missing > 0;
              return `<td>
                <div style="display:flex;flex-direction:column;gap:2px;font-size:11px;">
                  ${typeof missing === "number"
                    ? `<span style="color:${hasMissing ? "#e0a060" : "#70b070"};font-weight:600;">${missing} missing</span>`
                    : ""}
                  <span class="text-dim">${c.machine || 0} machine · ${c.human || 0} human · ${c.published || 0} published</span>
                </div>
              </td>`;
            }).join("")}
          </tr>
        `).join("")}
      </tbody>
    </table>`;
}

// ── Item drill-down ────────────────────────────────────────────────────────

async function fetchSourceItems(entityType, page, search) {
  if (entityType === "site_content") {
    const filtered = search
      ? SITE_CONTENT_KEYS.filter((k) => k.title.toLowerCase().includes(search.toLowerCase()))
      : SITE_CONTENT_KEYS;
    return { items: filtered, pages: 1, page: 1 };
  }

  const endpoint =
    entityType === "record" ? "/api/records"
    : entityType === "entity" ? "/api/personnel"
    : "/api/timeline";
  const params = new URLSearchParams({ page: String(page), limit: String(PAGE_SIZE), ...(search ? { search } : {}) });
  const res = await fetch(`${endpoint}?${params}`, { headers: authHeader() });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const data = await safeJson(res);
  return {
    items: (data.data || []).map((r) => ({ id: r.id, title: r.title || r.name || r.id })),
    pages: data.pages || 1,
    page: data.page || 1,
  };
}

async function loadItems() {
  const type = document.getElementById("tl-dash-type")?.value || "record";
  const locale = document.getElementById("tl-dash-locale")?.value || "de";
  const search = document.getElementById("tl-dash-search")?.value.trim() || "";
  const statusFilter = document.getElementById("tl-dash-status-filter")?.value || "";
  const tableEl = document.getElementById("tl-dash-table");
  if (!tableEl) return;
  tableEl.innerHTML = `<p class="text-dim">Loading…</p>`;

  try {
    const { items, pages, page } = await fetchSourceItems(type, currentPage, search);
    if (!items.length) {
      tableEl.innerHTML = `<p class="text-dim">No items found.</p>`;
      renderPagination(0, 1);
      return;
    }

    const statusRes = await fetch("/api/translations/dashboard/items", {
      method: "POST",
      headers: { ...authHeader(), "Content-Type": "application/json" },
      body: JSON.stringify({ entityType: type, entityIds: items.map((i) => i.id) }),
    });
    if (!statusRes.ok) throw new Error(`HTTP ${statusRes.status}`);
    const statuses = await safeJson(statusRes);
    const statusMap = new Map(statuses.map((s) => [s.entityId, s.locales]));

    let rows = items.map((item) => {
      const locales = statusMap.get(item.id) || {};
      const entry = locales[locale];
      return { ...item, status: entry?.status || "missing" };
    });

    if (statusFilter) rows = rows.filter((r) => r.status === statusFilter);

    tableEl.innerHTML = renderItemsTable(rows);
    wireItemActions(type, locale);
    renderPagination(pages, page);
  } catch (err) {
    tableEl.innerHTML = `<p class="text-dim" style="color:#e0a060;">Failed to load: ${escHtml(err.message)}</p>`;
  }
}

function renderItemsTable(rows) {
  if (!rows.length) return `<p class="text-dim">No items match the current filters.</p>`;
  return `
    <table class="admin-table">
      <thead><tr><th>Title</th><th>Status</th><th class="col-actions">Actions</th></tr></thead>
      <tbody>
        ${rows.map((r) => `
          <tr>
            <td>${escHtml(r.title)}</td>
            <td><span class="tl-badge ${STATUS_CLASSES[r.status]}">${STATUS_LABELS[r.status]}</span></td>
            <td class="col-actions">
              ${mtAvailable ? `
              <button type="button" class="btn btn-secondary btn--xs" data-tl-generate="${escHtml(r.id)}" data-tl-was-missing="${r.status === "missing"}">
                ${r.status === "missing" ? "Generate" : "Regenerate"}
              </button>` : `
              <span class="text-dim" style="font-size:var(--text-xs);" title="Automatic translation is disabled — edit manually from the record's translation panel.">manual only</span>`}
            </td>
          </tr>
        `).join("")}
      </tbody>
    </table>`;
}

function wireItemActions(type, locale) {
  document.querySelectorAll("[data-tl-generate]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const id = btn.dataset.tlGenerate;
      const wasMissing = btn.dataset.tlWasMissing === "true";
      btn.disabled = true;
      btn.textContent = "Working…";
      try {
        await generateOne(type, id, locale, !wasMissing);
        loadItems();
      } catch (err) {
        alert(`Generate failed: ${err.message}`);
        btn.disabled = false;
      }
    });
  });
}

async function generateOne(type, id, locale, force) {
  const res = await fetch(`/api/translations/${type}/${encodeURIComponent(id)}/${locale}/generate`, {
    method: "POST",
    headers: { ...authHeader(), "Content-Type": "application/json" },
    body: JSON.stringify({ force }),
  });
  // 409 = human/published translation exists and force wasn't set — skip silently in bulk mode
  if (!res.ok && res.status !== 409) {
    const d = await res.json().catch(() => ({}));
    throw new Error(d.error || `HTTP ${res.status}`);
  }
}

async function bulkGenerateMissing() {
  if (!mtAvailable) return; // button is disabled; belt-and-braces
  const type = document.getElementById("tl-dash-type")?.value || "record";
  const locale = document.getElementById("tl-dash-locale")?.value || "de";
  const statusEl = document.getElementById("tl-dash-bulk-status");
  const missingBtns = Array.from(document.querySelectorAll("[data-tl-generate]"))
    .filter((btn) => btn.dataset.tlWasMissing === "true");

  if (!missingBtns.length) {
    if (statusEl) statusEl.textContent = "Nothing missing on this page.";
    return;
  }

  if (statusEl) statusEl.textContent = `Generating 0/${missingBtns.length}…`;
  let ok = 0;
  let failed = 0;
  let firstError = "";
  for (const btn of missingBtns) {
    const id = btn.dataset.tlGenerate;
    try { await generateOne(type, id, locale, false); ok++; }
    catch (err) { failed++; if (!firstError) firstError = err.message; }
    if (statusEl) statusEl.textContent = `Generating ${ok + failed}/${missingBtns.length}…`;
    // Provider unavailable fails identically for every item — stop after the
    // first such failure instead of hammering it N more times.
    if (failed && /not configured|unreachable/i.test(firstError)) break;
  }
  if (statusEl) {
    statusEl.textContent = failed
      ? `Generated ${ok}, failed ${failed}: ${firstError}`
      : `Done — generated ${ok} translation(s).`;
  }
  loadItems();
}

// ── Pagination ───────────────────────────────────────────────────────────────

function renderPagination(pages, page) {
  const el = document.getElementById("tl-dash-pagination");
  if (!el) return;
  if (pages <= 1) { el.innerHTML = ""; return; }
  el.innerHTML = `
    <div style="display:flex;gap:var(--space-3);align-items:center;">
      <button type="button" class="btn btn-secondary btn--xs" id="tl-dash-prev" ${page <= 1 ? "disabled" : ""}>← Prev</button>
      <span class="text-dim" style="font-size:12px;">Page ${page} of ${pages}</span>
      <button type="button" class="btn btn-secondary btn--xs" id="tl-dash-next" ${page >= pages ? "disabled" : ""}>Next →</button>
    </div>`;
  document.getElementById("tl-dash-prev")?.addEventListener("click", () => { currentPage = Math.max(1, page - 1); loadItems(); });
  document.getElementById("tl-dash-next")?.addEventListener("click", () => { currentPage = page + 1; loadItems(); });
}

init();
