import { authHeader, escHtml, loader, safeJson } from "./admin-utils.js";
import { initAdminSelects } from "./admin-select.js";

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

  // Tab wiring — click
  document.getElementById("admin-tabs")?.addEventListener("click", (e) => {
    const btn = e.target.closest(".admin-tab-btn");
    if (!btn) return;
    activateTab(btn);
  });

  // Tab wiring — keyboard (WAI-ARIA tablist pattern)
  document.getElementById("admin-tabs")?.addEventListener("keydown", (e) => {
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

  // Mobile tab select — same sections as #admin-tabs, single dropdown
  // instead of a horizontal row, kept in sync via activateTab().
  const mobileTabSelect = document.getElementById("admin-tabs-mobile");
  mobileTabSelect?.addEventListener("change", () => {
    const btn = document.querySelector(`.admin-tab-btn[data-tab="${mobileTabSelect.value}"]`);
    if (btn) activateTab(btn);
  });

  // Modal backdrop click and Escape close
  const MODAL_IDS = [
    "related-record-modal", "media-attach-modal", "armament-preview-modal",
    "personnel-preview-modal", "letter-preview-modal", "campaign-preview-modal",
    "article-preview-modal", "award-preview-modal", "map-preview-modal",
    "poldoc-preview-modal", "admin-attribution-modal", "formation-preview-modal",
    "translation-editor-modal",
  ];
  MODAL_IDS.forEach((id) => {
    const el = document.getElementById(id);
    if (!el) return;
    el.addEventListener("click", (e) => { if (e.target === el) el.hidden = true; });
  });
  document.addEventListener("keydown", (e) => {
    if (e.key !== "Escape") return;
    const anyModalOpen = MODAL_IDS.some((id) => { const el = document.getElementById(id); return el && !el.hidden; });
    MODAL_IDS.forEach((id) => { const el = document.getElementById(id); if (el && !el.hidden) el.hidden = true; });
    // Escape also closes open form panels when no modal was open
    if (!anyModalOpen) {
      document.querySelectorAll(".form-panel:not([hidden])").forEach((panel) => { panel.hidden = true; });
    }
  });

  // Ctrl+S / Cmd+S: save the active form panel
  document.addEventListener("keydown", (e) => {
    if (!(e.ctrlKey || e.metaKey) || e.key !== "s") return;
    e.preventDefault();
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
  document.querySelectorAll(".admin-tab-btn").forEach((b) => {
    b.classList.toggle("is-active", b === btn);
    b.setAttribute("aria-selected", b === btn ? "true" : "false");
  });
  document
    .querySelectorAll(".admin-tab-panel")
    .forEach((p) => (p.hidden = p.id !== panel));
  const mobileTabSelect = document.getElementById("admin-tabs-mobile");
  if (mobileTabSelect && mobileTabSelect.value !== panel) mobileTabSelect.value = panel;
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
  if (loginPanel) loginPanel.style.display = "flex";
  if (dashboard) dashboard.hidden = true;
  loginForm?.reset();
});

async function showDashboard() {
  if (loginPanel) loginPanel.style.display = "none";
  if (dashboard) dashboard.hidden = false;
  await Promise.allSettled([loadStats(), loadActivity()]);
}

// ── Stats ───────────────────────────────────────────────────
async function loadStats() {
  if (!statsGrid) return;
  try {
    const res = await fetch("/api/dashboard/stats", { headers: authHeader() });
    if (!res.ok) throw new Error();
    const data = await safeJson(res);
    const ICON_FILE = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/><polyline points="10 9 9 9 8 9"/></svg>`;
    const ICON_PERSONNEL = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 7a4 4 0 1 0 8 0a4 4 0 1 0 -8 0" /><path d="M3 21v-2a4 4 0 0 1 4 -4h4a4 4 0 0 1 4 4v2" /><path d="M16 3.13a4 4 0 0 1 0 7.75" /><path d="M21 21v-2a4 4 0 0 0 -3 -3.85" /></svg>`;
    const ICON_MEDIA = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="9" cy="9" r="2"/><path d="M21 15l-5-5L5 21"/></svg>`;
    const ICON_EVENTS = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11.795 21h-6.795a2 2 0 0 1 -2 -2v-12a2 2 0 0 1 2 -2h12a2 2 0 0 1 2 2v4" /><path d="M18 14v4h4" /><path d="M14 18a4 4 0 1 0 8 0a4 4 0 1 0 -8 0" /><path d="M15 3v4" /><path d="M7 3v4" /><path d="M3 11h16" /></svg>`;
    const metrics = [
      { label: "Records", value: data.records ?? "—", icon: ICON_FILE },
      { label: "Personnel", value: data.entities ?? "—", icon: ICON_PERSONNEL },
      { label: "Media", value: data.media ?? "—", icon: ICON_MEDIA },
      { label: "Events", value: data.events ?? "—", icon: ICON_EVENTS },
    ];
    statsGrid.innerHTML = metrics
      .map(
        (m) => `
      <div class="stat-card">
        <span class="stat-card__icon" aria-hidden="true">${m.icon}</span>
        <div class="stat-card__body">
          <div class="stat-card__value">${m.value}</div>
          <div class="stat-card__label">${m.label}</div>
        </div>
      </div>`,
      )
      .join("");
  } catch (_) {
    statsGrid.innerHTML = `<p class="text-dim">Stats unavailable — database not connected.</p>`;
  }
}

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
              ? `<img src="${a.thumbnailUrl || a.url}" alt="${escHtml(a.originalName)}" class="media-grid-card__thumb">`
              : a.mimeType.startsWith("audio/")
                ? `<audio controls src="${a.url}" class="media-grid-card__audio" preload="metadata"></audio>`
                : a.mimeType.startsWith("video/")
                  ? `<video controls src="${a.url}" class="media-grid-card__video" preload="metadata"></video>`
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
    if (!res.ok) throw new Error(data.error || `${action} failed.`);
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

  const actionLabel = { validate: "Validation", run: "Staging", promote: "Promotion", rollback: "Rollback" }[action] || action;
  const hasIssues = Array.isArray(report.issues) && report.issues.length;
  const hasProblems = report.invalid > 0 || hasIssues;
  const statusText = hasProblems ? "Completed with issues" : "Completed successfully";

  const statCards = typeof report.recordsChecked === "number" ? `
    <div class="result-stat-grid">
      <div class="result-stat-card">
        <div class="result-stat-card__value" style="color:var(--gold);">${report.recordsChecked ?? "—"}</div>
        <div class="result-stat-card__label">Checked</div>
      </div>
      <div class="result-stat-card">
        <div class="result-stat-card__value" style="color:#60c060;">${report.valid ?? "—"}</div>
        <div class="result-stat-card__label">Valid</div>
      </div>
      <div class="result-stat-card">
        <div class="result-stat-card__value" style="color:${hasProblems ? "#e0a060" : "#60c060"};">${report.invalid ?? "—"}</div>
        <div class="result-stat-card__label">Invalid</div>
      </div>
    </div>` : "";

  const issuesList = hasIssues ? `
    <div class="mb-6">
      <p class="section-label mb-3">Issues</p>
      <div class="result-issues-list">
        ${report.issues.map((i) => `
          <div class="result-issue">
            <span class="badge">${escHtml(i.field || i.severity || "issue")}</span>
            <span class="result-issue__record">${escHtml(i.recordId || "")}</span>
            <p class="result-issue__msg">${escHtml(i.message)}</p>
          </div>`).join("")}
      </div>
    </div>` : "";

  const stagedList = Array.isArray(report.staged) ? `
    <div>
      <p class="section-label mb-3">Staged Files</p>
      ${report.staged.length
        ? `<ul class="result-staged-list">${report.staged.map((s) => `<li>${escHtml(s)}</li>`).join("")}</ul>`
        : `<p class="text-dim">Nothing staged — no valid records to publish.</p>`}
    </div>` : "";

  const message = report.message ? `<p class="text-secondary text-sm mb-4">${escHtml(report.message)}</p>` : "";

  container.innerHTML = `
    <div class="result-header">
      <span class="badge">${escHtml(type)}</span>
      <span class="text-secondary text-sm">${actionLabel}</span>
      <span class="result-header__status" style="color:${hasProblems ? "#e0a060" : "#60c060"};">${statusText}</span>
    </div>
    ${message}${statCards}${issuesList}${stagedList}`;
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
