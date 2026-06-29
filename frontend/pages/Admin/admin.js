import { authHeader, escHtml, loader } from "./admin-utils.js";

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

  // Tab wiring
  document.getElementById("admin-tabs")?.addEventListener("click", (e) => {
    const btn = e.target.closest(".admin-tab-btn");
    if (!btn) return;
    const panel = btn.dataset.tab;
    document
      .querySelectorAll(".admin-tab-btn")
      .forEach((b) => b.classList.toggle("is-active", b === btn));
    document
      .querySelectorAll(".admin-tab-panel")
      .forEach((p) => (p.hidden = p.id !== panel));
    if (panel === "tab-media") loadMedia();
  });
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
    const data = await res.json();
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
    const data = await res.json();
    const metrics = [
      { label: "Records", value: data.records ?? "—" },
      { label: "Personnel", value: data.entities ?? "—" },
      { label: "Media", value: data.media ?? "—" },
      { label: "Events", value: data.events ?? "—" },
    ];
    statsGrid.innerHTML = metrics
      .map(
        (m) => `
      <div style="background:var(--bg-card);border:1px solid var(--border-dim);border-radius:var(--radius);padding:var(--space-6);">
        <div style="font-family:var(--font-display);font-size:var(--text-2xl);font-weight:700;color:var(--gold);">${m.value}</div>
        <div style="font-size:var(--text-xs);color:var(--text-muted);letter-spacing:0.1em;text-transform:uppercase;margin-top:var(--space-1);">${m.label}</div>
      </div>`,
      )
      .join("");
  } catch (_) {
    statsGrid.innerHTML = `<p style="color:var(--text-muted)">Stats unavailable — database not connected.</p>`;
  }
}

async function loadActivity() {
  if (!activityLog) return;
  try {
    const res = await fetch("/api/dashboard/recent", { headers: authHeader() });
    if (!res.ok) throw new Error();
    const logs = await res.json();
    if (!logs.length) {
      activityLog.innerHTML = `<p style="color:var(--text-muted)">No activity recorded yet.</p>`;
      return;
    }
    activityLog.innerHTML =
      `<div style="display:flex;flex-direction:column;gap:var(--space-3);">` +
      logs
        .map(
          (log) => `
        <div style="display:flex;gap:var(--space-4);padding:var(--space-3);background:var(--bg-card);border:1px solid var(--border-dim);border-radius:var(--radius);flex-wrap:wrap;">
          <span class="badge">${log.action}</span>
          <span style="font-size:var(--text-sm);color:var(--text-secondary);">${log.entity} ${log.entityId ? `— ${log.entityId.slice(0, 8)}…` : ""}</span>
          <span style="font-size:var(--text-xs);color:var(--text-muted);margin-left:auto;">${new Date(log.createdAt).toLocaleString()}</span>
        </div>`,
        )
        .join("") +
      `</div>`;
  } catch (_) {
    activityLog.innerHTML = `<p style="color:var(--text-muted)">Activity log unavailable — database not connected.</p>`;
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
    const { data, total } = await res.json();
    renderMediaGrid(container, data, total);
  } catch (_) {
    container.innerHTML = `<p style="color:var(--text-muted)">Media unavailable.</p>`;
  }
}

function renderMediaGrid(container, assets, total) {
  if (!assets.length) {
    container.innerHTML = `<p style="color:var(--text-muted)">No media uploaded yet.</p>`;
    return;
  }
  container.innerHTML = `
    <p style="font-size:var(--text-xs);color:var(--text-muted);margin-bottom:var(--space-5);">${total} assets total</p>
    <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(140px,1fr));gap:var(--space-4);">
      ${assets
        .map(
          (a) => `
        <div style="background:var(--bg-card);border:1px solid var(--border-dim);border-radius:var(--radius);overflow:hidden;position:relative;">
          ${
            a.mimeType.startsWith("image/")
              ? `<img src="${a.thumbnailUrl || a.url}" alt="${escHtml(a.originalName)}" style="width:100%;aspect-ratio:4/3;object-fit:cover;display:block;">`
              : a.mimeType.startsWith("audio/")
                ? `<audio controls src="${a.url}" style="width:100%;display:block;padding:var(--space-2);" preload="metadata"></audio>`
                : a.mimeType.startsWith("video/")
                  ? `<video controls src="${a.url}" style="width:100%;aspect-ratio:4/3;display:block;object-fit:cover;" preload="metadata"></video>`
                  : `<div style="aspect-ratio:4/3;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:4px;color:var(--text-muted);font-size:var(--text-xs);">📄<span>${escHtml(a.mimeType)}</span></div>`
          }
          <div style="padding:var(--space-2) var(--space-3);">
            <p style="font-size:10px;color:var(--text-muted);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;" title="${escHtml(a.originalName)}">${escHtml(a.originalName)}</p>
            <button onclick="deleteMedia('${a.id}')" style="font-size:10px;color:#e06060;background:none;border:none;cursor:pointer;margin-top:4px;padding:0;">Delete</button>
          </div>
        </div>`,
        )
        .join("")}
    </div>`;
}

window.deleteMedia = async (id) => {
  if (!confirm("Delete this asset?")) return;
  try {
    const res = await fetch(`/api/media/${id}`, {
      method: "DELETE",
      headers: authHeader(),
    });
    if (!res.ok) throw new Error();
    loadMedia();
    loadStats();
  } catch (_) {
    alert("Delete failed.");
  }
};

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
        statusEl.style.color = "#60c060";
      }
      loadMedia();
      loadStats();
    } catch (_) {
      if (statusEl) {
        statusEl.textContent = "Upload failed.";
        statusEl.style.color = "#e06060";
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
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || `${action} failed.`);
    if (action === "history") {
      renderPublishHistory(data, type);
    } else {
      renderPublishResult(data, action, type);
    }
  } catch (err) {
    if (resultEl) resultEl.innerHTML = `<p style="color:#e06060;">${escHtml(err.message || "Request failed.")}</p>`;
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
  const statusColor = (report.invalid > 0 || hasIssues) ? "#e0a060" : "#60c060";
  const statusText = (report.invalid > 0 || hasIssues) ? "Completed with issues" : "Completed successfully";

  const statCards = typeof report.recordsChecked === "number" ? `
    <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(130px,1fr));gap:var(--space-3);margin-bottom:var(--space-6);">
      <div style="background:var(--bg-card);border:1px solid var(--border-dim);border-radius:var(--radius);padding:var(--space-4);">
        <div style="font-family:var(--font-display);font-size:var(--text-xl);font-weight:700;color:var(--gold);">${report.recordsChecked ?? "—"}</div>
        <div style="font-size:10px;color:var(--text-muted);letter-spacing:0.08em;text-transform:uppercase;">Checked</div>
      </div>
      <div style="background:var(--bg-card);border:1px solid var(--border-dim);border-radius:var(--radius);padding:var(--space-4);">
        <div style="font-family:var(--font-display);font-size:var(--text-xl);font-weight:700;color:#60c060;">${report.valid ?? "—"}</div>
        <div style="font-size:10px;color:var(--text-muted);letter-spacing:0.08em;text-transform:uppercase;">Valid</div>
      </div>
      <div style="background:var(--bg-card);border:1px solid var(--border-dim);border-radius:var(--radius);padding:var(--space-4);">
        <div style="font-family:var(--font-display);font-size:var(--text-xl);font-weight:700;color:${statusColor};">${report.invalid ?? "—"}</div>
        <div style="font-size:10px;color:var(--text-muted);letter-spacing:0.08em;text-transform:uppercase;">Invalid</div>
      </div>
    </div>` : "";

  const issuesList = hasIssues ? `
    <div style="margin-bottom:var(--space-6);">
      <p style="font-size:var(--text-xs);color:var(--text-muted);letter-spacing:0.08em;text-transform:uppercase;margin-bottom:var(--space-3);">Issues</p>
      <div style="display:flex;flex-direction:column;gap:var(--space-2);">
        ${report.issues.map((i) => `
          <div style="padding:var(--space-3);background:var(--bg-card);border:1px solid #4a1515;border-radius:var(--radius);font-size:var(--text-sm);">
            <span class="badge">${escHtml(i.field || i.severity || "issue")}</span>
            <span style="color:var(--text-muted);margin-left:var(--space-2);">${escHtml(i.recordId || "")}</span>
            <p style="color:var(--text-secondary);margin-top:var(--space-1);">${escHtml(i.message)}</p>
          </div>`).join("")}
      </div>
    </div>` : "";

  const stagedList = Array.isArray(report.staged) ? `
    <div>
      <p style="font-size:var(--text-xs);color:var(--text-muted);letter-spacing:0.08em;text-transform:uppercase;margin-bottom:var(--space-3);">Staged Files</p>
      ${report.staged.length
        ? `<ul style="font-size:var(--text-sm);color:var(--text-secondary);padding-left:var(--space-5);">${report.staged.map((s) => `<li>${escHtml(s)}</li>`).join("")}</ul>`
        : `<p style="color:var(--text-muted);">Nothing staged — no valid records to publish.</p>`}
    </div>` : "";

  const message = report.message ? `<p style="font-size:var(--text-sm);color:var(--text-secondary);margin-bottom:var(--space-4);">${escHtml(report.message)}</p>` : "";

  container.innerHTML = `
    <div style="display:flex;align-items:center;gap:var(--space-3);padding:var(--space-3) var(--space-4);background:var(--bg-card);border:1px solid var(--border-dim);border-radius:var(--radius);margin-bottom:var(--space-5);">
      <span class="badge">${escHtml(type)}</span>
      <span style="font-size:var(--text-sm);color:var(--text-secondary);">${actionLabel}</span>
      <span style="font-size:var(--text-xs);color:${statusColor};margin-left:auto;">${statusText}</span>
    </div>
    ${message}${statCards}${issuesList}${stagedList}`;
}

function renderPublishHistory(entries, type) {
  const container = document.getElementById("publish-result");
  if (!container) return;
  const list = Array.isArray(entries) ? entries : (entries?.history || []);
  if (!list.length) {
    container.innerHTML = `
      <div style="display:flex;align-items:center;gap:var(--space-3);padding:var(--space-3) var(--space-4);background:var(--bg-card);border:1px solid var(--border-dim);border-radius:var(--radius);margin-bottom:var(--space-5);">
        <span class="badge">${escHtml(type)}</span>
        <span style="font-size:var(--text-sm);color:var(--text-secondary);">History</span>
      </div>
      <p style="color:var(--text-muted);font-size:var(--text-sm);">No publish history yet.</p>`;
    return;
  }
  container.innerHTML = `
    <div style="display:flex;align-items:center;gap:var(--space-3);padding:var(--space-3) var(--space-4);background:var(--bg-card);border:1px solid var(--border-dim);border-radius:var(--radius);margin-bottom:var(--space-5);">
      <span class="badge">${escHtml(type)}</span>
      <span style="font-size:var(--text-sm);color:var(--text-secondary);">History — ${list.length} run(s)</span>
    </div>
    <div style="display:flex;flex-direction:column;gap:var(--space-2);">
      ${list.map((entry) => {
        const ts = entry.timestamp || entry.createdAt || entry.runAt;
        const date = ts ? new Date(ts).toLocaleString() : "Unknown date";
        const mode = entry.mode || entry.action || "run";
        const valid = entry.valid ?? entry.validCount ?? "—";
        const invalid = entry.invalid ?? entry.invalidCount ?? "—";
        return `
        <div style="padding:var(--space-3) var(--space-4);background:var(--bg-card);border:1px solid var(--border-dim);border-radius:var(--radius);display:flex;align-items:center;gap:var(--space-4);flex-wrap:wrap;font-size:var(--text-sm);">
          <span class="badge">${escHtml(mode)}</span>
          <span style="color:var(--text-secondary);">${escHtml(date)}</span>
          <span style="color:#60c060;">${valid} valid</span>
          ${+invalid > 0 ? `<span style="color:#e0a060;">${invalid} invalid</span>` : ""}
          ${entry.id ? `<span style="color:var(--text-muted);font-size:11px;font-family:monospace;margin-left:auto;">${entry.id.slice(0, 8)}…</span>` : ""}
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
