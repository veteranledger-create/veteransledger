// Renders the grouped section sidebar/drawer and the contextual page header.
// Imported first so its buttons exist before init() wires aria-controls.
import "./admin-nav.js";
import { authHeader, escHtml, loader, safeJson } from "./admin-utils.js";
import { publishResultMarkup, isStructuredFailure } from "./publish-result-view.js";
import { initAdminSelects } from "./admin-select.js";
import { initModalStack, getTopModalSaveButton } from "./admin-modal-stack.js";
import { isTabDirty, anyDirty } from "./admin-dirty-guard.js";

/**
 * VeteransLedger · Admin Dashboard
 * Handles login, dashboard stats, activity log, and CRUD management.
 */

const loginPanel = document.getElementById("admin-login");
const dashboard = document.getElementById("admin-dashboard");
const loginForm = document.getElementById("login-form");
const loginError = document.getElementById("login-error");
const logoutBtn = document.getElementById("logout-btn");
const statsGrid = document.getElementById("stats-grid");
const activityLog = document.getElementById("activity-log");

let token = null;

// ── Admin shell topbar ──────────────────────────────────────
// The topbar belongs to the authenticated dashboard. On the login screen
// it is detached from the DOM entirely — not hidden — so the full-viewport
// login composition centres against the real viewport instead of being
// pushed down by a 52px bar. A comment node holds its position so it can be
// re-attached in the same place on sign-in.
const topbarEl = document.getElementById("admin-topbar");
const topbarSlot = document.createComment("admin-topbar");
topbarEl?.before(topbarSlot);

function setTopbarAttached(attached) {
  if (!topbarEl) return;
  if (attached) { if (!topbarEl.isConnected) topbarSlot.after(topbarEl); }
  else if (topbarEl.isConnected) topbarEl.remove();
}

// Applied before init() so the bar never flashes on an unauthenticated load.
setTopbarAttached(!!sessionStorage.getItem("vl_admin_token"));

// ── Init ────────────────────────────────────────────────────
async function init() {
  token = sessionStorage.getItem("vl_admin_token");
  if (token) await showDashboard();

  // Wire aria-controls / aria-labelledby between tab buttons and panels
  document.querySelectorAll(".admin-tab-btn[data-tab]").forEach((btn) => {
    const panelId = btn.dataset.tab;
    btn.setAttribute("aria-controls", panelId);
    const panel = document.getElementById(panelId);
    if (panel) {
      if (!panel.id) panel.id = panelId;
      panel.setAttribute("aria-labelledby", btn.id || (() => {
        const id = `tab-btn-${panelId}`;
        btn.id = id;
        return id;
      })());
    }
  });

  // Tab wiring — click. Delegated on the section navigation container
  // (#admin-nav, rendered by admin-nav.js), which replaced the former
  // #admin-tabs row. The .admin-tab-btn[data-tab] contract is unchanged.
  document.getElementById("admin-nav")?.addEventListener("click", (e) => {
    const btn = e.target.closest(".admin-tab-btn");
    if (!btn) return;
    activateTab(btn);
  });

  // Tab wiring — keyboard (WAI-ARIA tablist pattern)
  document.getElementById("admin-nav")?.addEventListener("keydown", (e) => {
    const btn = e.target.closest(".admin-tab-btn");
    if (!btn) return;
    const tabs = Array.from(document.querySelectorAll(".admin-tab-btn"));
    const idx = tabs.indexOf(btn);
    let next = null;
    if (e.key === "ArrowRight" || e.key === "ArrowDown") {
      next = tabs[(idx + 1) % tabs.length];
    } else if (e.key === "ArrowLeft" || e.key === "ArrowUp") {
      next = tabs[(idx - 1 + tabs.length) % tabs.length];
    } else if (e.key === "Home") {
      next = tabs[0];
    } else if (e.key === "End") {
      next = tabs[tabs.length - 1];
    } else if (e.key === "Enter" || e.key === " ") {
      activateTab(btn);
      e.preventDefault();
    }
    if (next) { next.focus(); activateTab(next); e.preventDefault(); }
  });

  // (The former mobile <select> was replaced by the navigation drawer in
  // admin-nav.js, which renders the same .admin-tab-btn buttons as desktop.)

  // Modal stack: open/close tracking, focus trap, focus restoration, and
  // Escape closes only the topmost modal. Passive (hidden-attribute based),
  // so every existing modal below gets this for free with zero changes to
  // its own module's JS. translation-editor-modal's saveSelector lets the
  // Ctrl+S handler below route to it instead of the form behind it.
  initModalStack(
    [
      { id: "related-record-modal" },
      { id: "media-attach-modal" },
      { id: "armament-preview-modal" },
      { id: "personnel-preview-modal" },
      { id: "letter-preview-modal" },
      { id: "campaign-preview-modal" },
      { id: "article-preview-modal" },
      { id: "award-preview-modal" },
      { id: "map-preview-modal" },
      { id: "poldoc-preview-modal" },
      { id: "admin-attribution-modal" },
      { id: "formation-preview-modal" },
      { id: "translation-editor-modal", saveSelector: "#tl-modal-save-human" },
    ],
    {
      // Escape closes an open form panel only when no modal was open on
      // this keypress (unchanged end-user behavior; race-free by construction).
      onEscapeWithNoModal: () => {
        document.querySelectorAll(".form-panel:not([hidden])").forEach((panel) => { panel.hidden = true; });
      },
    },
  );

  // Ctrl+S / Cmd+S: modal-aware — if the topmost open modal has a
  // configured save action, use it (e.g. the translation editor). Otherwise
  // (no modal open, or the topmost one is read-only like a preview) fall
  // through to the active form panel, exactly as before — this preserves
  // Formations' existing "Save while Preview is open refreshes the preview"
  // behavior, since formation-preview-modal has no saveSelector.
  document.addEventListener("keydown", (e) => {
    if (!(e.ctrlKey || e.metaKey) || e.key !== "s") return;
    e.preventDefault();
    const modalSaveBtn = getTopModalSaveButton();
    if (modalSaveBtn) { modalSaveBtn.click(); return; }
    const panel = document.querySelector(".form-panel:not([hidden])");
    if (panel) {
      const btn = panel.querySelector("[type='submit']") || panel.querySelector(".btn-primary");
      btn?.click();
    } else {
      // Sidebar editors (NSDAP, Pages) expose a save button by ID convention
      const activeTab = document.querySelector(".admin-tab-panel:not([hidden])");
      if (activeTab) {
        const btn = activeTab.querySelector(".btn-primary[id$='-save-btn'], .btn-primary[id$='-save']");
        btn?.click();
      }
    }
  });

  // Unsaved-changes protection: only tabs that opt in via registerDirtyGuard
  // (currently Formations) ever block navigation — every other tab is
  // unaffected. Covers both leaving the browser and switching Admin tabs.
  window.addEventListener("beforeunload", (e) => {
    if (!anyDirty()) return;
    e.preventDefault();
    e.returnValue = "";
  });

  // Enhance all native selects with the custom dropdown
  initAdminSelects();

  // Scroll to + autofocus first interactive field whenever a form panel is revealed
  const _fpObserver = new MutationObserver((muts) => {
    for (const m of muts) {
      if (m.attributeName === "hidden" && !m.target.hasAttribute("hidden")) {
        m.target.scrollIntoView({ behavior: "smooth", block: "start" });
        initAdminSelects(m.target); // enhance any selects rendered since page load
        const first = m.target.querySelector(
          "input:not([type=hidden]):not([type=checkbox]):not([type=file])," +
          " select:not(.a-select__native), .a-select__trigger, textarea"
        );
        if (first) setTimeout(() => first.focus({ preventScroll: true }), 120);
      }
    }
  });
  document.querySelectorAll(".form-panel").forEach((fp) =>
    _fpObserver.observe(fp, { attributes: true, attributeFilter: ["hidden"] })
  );
}

function activateTab(btn) {
  const panel = btn.dataset.tab;
  const currentPanel = document.querySelector(".admin-tab-panel:not([hidden])")?.id;

  // Only tabs that registered a dirty guard (currently Formations) can ever
  // block a switch — every other tab behaves exactly as before.
  if (currentPanel && currentPanel !== panel && isTabDirty(currentPanel)) {
    if (!confirm("You have unsaved changes on this tab. Leave without saving?")) {
      document.querySelector(`.admin-tab-btn[data-tab="${currentPanel}"]`)?.focus();
      return;
    }
  }

  document.querySelectorAll(".admin-tab-btn").forEach((b) => {
    b.classList.toggle("is-active", b === btn);
    b.setAttribute("aria-selected", b === btn ? "true" : "false");
  });
  document
    .querySelectorAll(".admin-tab-panel")
    .forEach((p) => (p.hidden = p.id !== panel));
  if (panel === "tab-media") loadMedia();
}

// ── Auth ────────────────────────────────────────────────────
loginForm?.addEventListener("submit", async (e) => {
  e.preventDefault();
  const email = document.getElementById("admin-email")?.value;
  const password = document.getElementById("admin-password")?.value;
  setLoginError("");
  const submitBtn = loginForm.querySelector("[type='submit']");
  if (submitBtn) submitBtn.disabled = true;
  try {
    const res = await fetch("/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password }),
    });
    const data = await safeJson(res);
    if (!res.ok) throw new Error(data.error || "Login failed");
    token = data.token;
    sessionStorage.setItem("vl_admin_token", token);
    await showDashboard();
  } catch (err) {
    setLoginError(err.message || "Authentication failed.");
  } finally {
    if (submitBtn) submitBtn.disabled = false;
  }
});

logoutBtn?.addEventListener("click", () => {
  token = null;
  sessionStorage.removeItem("vl_admin_token");
  setTopbarAttached(false);
  if (loginPanel) loginPanel.style.display = "flex";
  if (dashboard) dashboard.hidden = true;
  loginForm?.reset();
});

async function showDashboard() {
  setTopbarAttached(true);
  if (loginPanel) loginPanel.style.display = "none";
  if (dashboard) dashboard.hidden = false;
  await Promise.allSettled([loadStats(), loadActivity()]);
}

// ── Stats ───────────────────────────────────────────────────
// ── Dashboard ───────────────────────────────────────────────
// Every figure shown here comes from /api/dashboard/stats (database
// aggregates) or /api/dashboard/content-health (a direct scan of the
// file-backed content under public/data). Nothing is estimated and nothing
// is hard-coded — when a value cannot be measured, its row is omitted
// rather than filled with a placeholder.

const num = (n) => (typeof n === "number" ? n.toLocaleString("en-GB") : "—");

const TYPE_LABEL = {
  ARMAMENT: "Armaments", CAMPAIGN: "Campaigns", FORMATION: "Formations",
  LETTER: "Letters", ARTICLE: "Articles", AWARD: "Awards",
  MAP: "Maps", POLITICAL_DOCUMENT: "Political Documents", PERSON: "Personnel",
};

function figure(label, value, note) {
  return `
    <div class="dash-figure">
      <dt class="dash-figure__label">${escHtml(label)}</dt>
      <dd class="dash-figure__value">${escHtml(String(value))}</dd>
      ${note ? `<p class="dash-figure__note">${escHtml(note)}</p>` : ""}
    </div>`;
}

// state: "ok" | "attention" | "info". Paired with a text label and a distinct
// mark shape so status is never carried by colour alone.
function healthRow({ label, value, state, detail, goto, action }) {
  const STATE_TEXT = { ok: "OK", attention: "Needs attention", info: "For review" };
  return `
    <li class="dash-health__row dash-health__row--${state}">
      <span class="dash-health__mark dash-health__mark--${state}" aria-hidden="true"></span>
      <div class="dash-health__body">
        <p class="dash-health__label">${escHtml(label)}</p>
        ${detail ? `<p class="dash-health__detail">${escHtml(detail)}</p>` : ""}
      </div>
      <span class="dash-health__value">${escHtml(String(value))}</span>
      <span class="dash-health__state">${STATE_TEXT[state]}</span>
      ${goto ? `<button type="button" class="dash-health__go" data-goto="${goto}">${escHtml(action || "Open")}</button>` : "<span></span>"}
    </li>`;
}

async function loadStats() {
  if (!statsGrid) return;
  statsGrid.innerHTML = `<p class="dash-loading" role="status">Loading archive status…</p>`;

  const [statsRes, healthRes] = await Promise.allSettled([
    fetch("/api/dashboard/stats", { headers: authHeader() }).then((r) => (r.ok ? safeJson(r) : Promise.reject(new Error(String(r.status))))),
    fetch("/api/dashboard/content-health", { headers: authHeader() }).then((r) => (r.ok ? safeJson(r) : Promise.reject(new Error(String(r.status))))),
  ]);

  const stats = statsRes.status === "fulfilled" ? statsRes.value : null;
  const health = healthRes.status === "fulfilled" ? healthRes.value : null;

  if (!stats && !health) {
    statsGrid.innerHTML = `<p class="dash-error" role="alert">Archive status unavailable — the dashboard API did not respond. Database-backed sections may also be affected.</p>`;
    return;
  }

  const sections = [];

  // ── Archive Overview ──────────────────────────────────────
  if (stats) {
    const byType = stats.recordsByType || {};
    const breakdown = Object.entries(byType)
      .sort((a, b) => b[1] - a[1])
      .map(([t, n]) => `<li><span>${escHtml(TYPE_LABEL[t] || t)}</span><span>${num(n)}</span></li>`)
      .join("");

    sections.push(`
      <section class="dash-section">
        <h2 class="dash-section__title">Archive Overview</h2>
        <p class="dash-section__source">Database aggregates · /api/dashboard/stats</p>
        <dl class="dash-figures">
          ${figure("Records", num(stats.records), `${num(stats.published?.records)} published`)}
          ${figure("Personnel", num(stats.entities), `${num(stats.published?.entities)} published`)}
          ${figure("Timeline Events", num(stats.events), `${num(stats.published?.events)} published`)}
          ${figure("Media Assets", num(stats.media), "Uploaded via Media Library")}
        </dl>
        ${breakdown ? `<ul class="dash-breakdown">${breakdown}</ul>` : ""}
      </section>`);
  }

  // ── Content Health ────────────────────────────────────────
  const rows = [];
  if (health) {
    const { imageReferences: img, provenance: prov } = health;
    rows.push(healthRow({
      label: "Image references that resolve to a file",
      value: `${num(img.resolved)} / ${num(img.unique)}`,
      state: img.missing > 0 ? "attention" : "ok",
      detail: img.missing > 0
        ? `${num(img.missing)} referenced images are not present on disk.`
        : "Every referenced image is present.",
      goto: "tab-media", action: "Media",
    }));
    rows.push(healthRow({
      label: "Images with unverified source",
      value: num(prov.unverifiedSource),
      state: prov.unverifiedSource > 0 ? "info" : "ok",
      detail: "Marked in the content data as awaiting archival review.",
    }));
    rows.push(healthRow({
      label: "Images declared AI-generated",
      value: num(prov.declaredAiGenerated),
      state: prov.declaredAiGenerated > 0 ? "attention" : "ok",
      detail: "Counted from the is_ai_generated flag in content data.",
    }));
    rows.push(healthRow({
      label: "Images with no provenance recorded",
      value: num(prov.noProvenanceRecorded),
      state: prov.noProvenanceRecorded > 0 ? "info" : "ok",
      detail: "No source, credit, licence, archive or status field present.",
    }));
  }
  if (stats?.translations) {
    const t = stats.translations;
    const cov = t.recordCoverage || {};
    rows.push(healthRow({
      label: "Record translations",
      value: `${num(cov.translated)} / ${num(cov.possible)}`,
      state: cov.translated < cov.possible ? "info" : "ok",
      detail: `${num(stats.published?.records)} published records × ${t.supportedLocales} locales.`,
      goto: "tab-translations", action: "Translations",
    }));
    rows.push(healthRow({
      label: "Site content translations",
      value: num(t.byEntityType?.site_content ?? 0),
      state: "info",
      detail: `${num(t.total)} translation rows in total across ${Object.keys(t.byLocale || {}).length} locales.`,
      goto: "tab-translations", action: "Translations",
    }));
  }

  if (rows.length) {
    sections.push(`
      <section class="dash-section">
        <h2 class="dash-section__title">Content Health</h2>
        <p class="dash-section__source">${health ? `Scan of ${num(health.scannedFiles)} content files · /api/dashboard/content-health` : "Database aggregates"}</p>
        <ul class="dash-health">${rows.join("")}</ul>
      </section>`);
  }

  // ── Not measured ──────────────────────────────────────────
  // Stated explicitly so an absent figure is never mistaken for a zero.
  const notMeasured = [];
  if (!health) notMeasured.push("Content health (image references and provenance) — the content-health request failed.");
  if (!stats) notMeasured.push("Archive totals and translation coverage — the stats request failed.");
  notMeasured.push("Record field completeness — no validation rule set exists yet to measure it against.");
  sections.push(`
    <section class="dash-section dash-section--muted">
      <h2 class="dash-section__title">Not measured</h2>
      <ul class="dash-notes">${notMeasured.map((n) => `<li>${escHtml(n)}</li>`).join("")}</ul>
    </section>`);

  statsGrid.innerHTML = sections.join("");
}

// Jump straight to the section a health row refers to, reusing the shared
// navigation buttons so the dirty guard and header stay in step.
statsGrid?.addEventListener("click", (e) => {
  const go = e.target.closest("[data-goto]");
  if (!go) return;
  document.querySelector(`.admin-tab-btn[data-tab="${go.dataset.goto}"]`)?.click();
});

async function loadActivity() {
  if (!activityLog) return;
  try {
    const res = await fetch("/api/dashboard/recent", { headers: authHeader() });
    if (!res.ok) throw new Error();
    const logs = await safeJson(res);
    if (!logs.length) {
      activityLog.innerHTML = `<p class="text-dim">No activity recorded yet.</p>`;
      return;
    }
    activityLog.innerHTML =
      `<div class="activity-log-list">` +
      logs
        .map(
          (log) => `
        <div class="activity-entry">
          <span class="badge">${escHtml(log.action)}</span>
          <span class="activity-entry__detail">${escHtml(log.entity)}${log.entityId ? ` — ${log.entityId.slice(0, 8)}…` : ""}</span>
          <span class="activity-entry__time">${new Date(log.createdAt).toLocaleString()}</span>
        </div>`,
        )
        .join("") +
      `</div>`;
  } catch (_) {
    activityLog.innerHTML = `<p class="text-dim">Activity log unavailable — database not connected.</p>`;
  }
}

// ── Media ───────────────────────────────────────────────────
async function loadMedia() {
  const container = document.getElementById("media-list");
  if (!container) return;
  container.innerHTML = loader();
  try {
    const res = await fetch("/api/media?limit=24", { headers: authHeader() });
    if (!res.ok) throw new Error();
    const { data, total } = await safeJson(res);
    renderMediaGrid(container, data, total);
  } catch (_) {
    container.innerHTML = `<p style="color:var(--text-muted)">Media unavailable.</p>`;
  }
}

function renderMediaGrid(container, assets, total) {
  if (!assets.length) {
    container.innerHTML = `<p class="text-dim">No media uploaded yet.</p>`;
    return;
  }
  container.innerHTML = `
    <p class="list-meta mb-5">${total} assets total</p>
    <div class="media-grid">
      ${assets
        .map(
          (a) => `
        <div class="media-grid-card">
          ${
            a.mimeType.startsWith("image/")
              ? `<img src="${escHtml(a.thumbnailUrl || a.url)}" alt="${escHtml(a.originalName)}" class="media-grid-card__thumb">`
              : a.mimeType.startsWith("audio/")
                ? `<audio controls src="${escHtml(a.url)}" class="media-grid-card__audio" preload="metadata"></audio>`
                : a.mimeType.startsWith("video/")
                  ? `<video controls src="${escHtml(a.url)}" class="media-grid-card__video" preload="metadata"></video>`
                  : `<div class="media-grid-card__doc">📄<span>${escHtml(a.mimeType)}</span></div>`
          }
          <div class="media-grid-card__info">
            <p class="media-grid-card__name" title="${escHtml(a.originalName)}">${escHtml(a.originalName)}</p>
            <button class="media-grid-card__delete" data-delete-media="${a.id}">Delete</button>
          </div>
        </div>`,
        )
        .join("")}
    </div>`;

  // Attach delegation only once — the container element persists across re-renders
  if (!container.dataset.mediaDelegate) {
    container.dataset.mediaDelegate = "1";
    container.addEventListener("click", async (e) => {
      const btn = e.target.closest("[data-delete-media]");
      if (!btn || btn.disabled) return;
      if (!confirm("Delete this asset? This cannot be undone.")) return;
      const id = btn.dataset.deleteMedia;
      btn.disabled = true;
      try {
        const res = await fetch(`/api/media/${id}`, { method: "DELETE", headers: authHeader() });
        if (!res.ok) throw new Error();
        loadMedia();
        loadStats();
      } catch (_) {
        alert("Delete failed.");
        btn.disabled = false;
      }
    });
  }
}

// Upload media
document
  .getElementById("media-upload-form")
  ?.addEventListener("submit", async (e) => {
    e.preventDefault();
    const form = e.target;
    const fileInput = form.querySelector("[name='file']");
    if (!fileInput?.files?.length) return;

    const fd = new FormData();
    fd.append("file", fileInput.files[0]);

    const statusEl = document.getElementById("upload-status");
    const submitBtn = form.querySelector("[type='submit']");
    if (submitBtn) submitBtn.disabled = true;
    if (statusEl) statusEl.textContent = "Uploading…";

    try {
      const res = await fetch("/api/media/upload", {
        method: "POST",
        headers: authHeader(),
        body: fd,
      });
      if (!res.ok) throw new Error();
      form.reset();
      if (statusEl) {
        statusEl.textContent = "Uploaded successfully.";
        statusEl.className = "form-status form-status--ok";
        setTimeout(() => { if (statusEl.textContent === "Uploaded successfully.") { statusEl.textContent = ""; statusEl.className = "form-status"; } }, 3500);
      }
      loadMedia();
      loadStats();
    } catch (_) {
      if (statusEl) {
        statusEl.textContent = "Upload failed.";
        statusEl.className = "form-status form-status--err";
      }
    } finally {
      if (submitBtn) submitBtn.disabled = false;
    }
  });

// ── Publish pipeline ─────────────────────────────────────────

function publishType() {
  return document.getElementById("publish-type-select")?.value || "armaments";
}

function publishSetLoading(busy) {
  ["validate", "run", "promote", "rollback", "history"].forEach((a) => {
    const btn = document.getElementById(`publish-btn-${a}`);
    if (btn) btn.disabled = busy;
  });
  const resultEl = document.getElementById("publish-result");
  if (busy && resultEl) resultEl.innerHTML = loader();
}

async function runPublishAction(action) {
  const type = publishType();
  publishSetLoading(true);
  const resultEl = document.getElementById("publish-result");
  try {
    const isGet = action === "validate" || action === "history";
    const res = await fetch(`/api/publish/${type}/${action}`, {
      method: isGet ? "GET" : "POST",
      headers: authHeader(),
    });
    const data = await safeJson(res);
    if (!res.ok) {
      // A promotion that aborted returns a structured body saying whether the
      // files were put back. That is far more use than one line of text, so
      // it is rendered like any other result.
      if (isStructuredFailure(data)) {
        renderPublishResult(data, action, type);
        return;
      }
      throw new Error(data.error || `${action} failed.`);
    }
    if (action === "history") {
      renderPublishHistory(data, type);
    } else {
      renderPublishResult(data, action, type);
    }
  } catch (err) {
    if (resultEl) resultEl.innerHTML = `<p class="result-error">${escHtml(err.message || "Request failed.")}</p>`;
  } finally {
    publishSetLoading(false);
  }
}

document.getElementById("publish-btn-validate")?.addEventListener("click", () => runPublishAction("validate"));
document.getElementById("publish-btn-run")?.addEventListener("click", () => {
  if (!confirm(`Stage the ${publishType()} section? This writes output to the staging directory.`)) return;
  runPublishAction("run");
});
document.getElementById("publish-btn-promote")?.addEventListener("click", () => {
  if (!confirm(`Promote ${publishType()} to the live archive? The public site will reflect this immediately.`)) return;
  runPublishAction("promote");
});
document.getElementById("publish-btn-rollback")?.addEventListener("click", () => {
  if (!confirm(`Roll back ${publishType()} to the previous snapshot? This will overwrite the current live files.`)) return;
  runPublishAction("rollback");
});
document.getElementById("publish-btn-history")?.addEventListener("click", () => runPublishAction("history"));

function renderPublishResult(report, action, type) {
  const container = document.getElementById("publish-result");
  if (!container || !report) return;
  // All wording and colour logic lives in publish-result-view.js, which is a
  // pure string-builder so the promotion branches can actually be tested.
  container.innerHTML = publishResultMarkup(report, action, type);
}
function renderPublishHistory(entries, type) {
  const container = document.getElementById("publish-result");
  if (!container) return;
  const list = Array.isArray(entries) ? entries : (entries?.history || []);
  if (!list.length) {
    container.innerHTML = `
      <div class="result-header">
        <span class="badge">${escHtml(type)}</span>
        <span class="text-secondary text-sm">History</span>
      </div>
      <p class="text-dim text-sm">No publish history yet.</p>`;
    return;
  }
  container.innerHTML = `
    <div class="result-header">
      <span class="badge">${escHtml(type)}</span>
      <span class="text-secondary text-sm">History — ${list.length} run(s)</span>
    </div>
    <div class="result-history-list">
      ${list.map((entry) => {
        const ts = entry.timestamp || entry.createdAt || entry.runAt;
        const date = ts ? new Date(ts).toLocaleString() : "Unknown date";
        const mode = entry.mode || entry.action || "run";
        const valid = entry.valid ?? entry.validCount ?? "—";
        const invalid = entry.invalid ?? entry.invalidCount ?? "—";
        return `
        <div class="result-history-entry">
          <span class="badge">${escHtml(mode)}</span>
          <span class="text-secondary">${escHtml(date)}</span>
          <span style="color:#60c060;">${valid} valid</span>
          ${+invalid > 0 ? `<span style="color:#e0a060;">${invalid} invalid</span>` : ""}
          ${entry.id ? `<span class="result-history-entry__id">${entry.id.slice(0, 8)}…</span>` : ""}
        </div>`;
      }).join("")}
    </div>`;
}

// ── Helpers ─────────────────────────────────────────────────
function setLoginError(msg) {
  if (!loginError) return;
  loginError.textContent = msg;
  loginError.className = msg
    ? "contact-form__status is-error"
    : "contact-form__status";
}

init();
