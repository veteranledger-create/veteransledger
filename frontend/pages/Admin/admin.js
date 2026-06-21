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
    if (panel === "tab-records") loadRecords();
    if (panel === "tab-timeline") loadTimelineEvents();
    if (panel === "tab-media") loadMedia();
    if (panel === "tab-publish") renderPublishResult(lastPublishReport);
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

// ── Records CRUD ────────────────────────────────────────────
let recordsPage = 1;

async function loadRecords(page = 1) {
  recordsPage = page;
  const container = document.getElementById("records-list");
  if (!container) return;
  container.innerHTML = loader();
  try {
    const res = await fetch(`/api/records?page=${page}&limit=20`, {
      headers: authHeader(),
    });
    if (!res.ok) throw new Error();
    const { data, total, pages } = await res.json();
    renderRecordsTable(container, data, total, pages);
  } catch (_) {
    container.innerHTML = `<p style="color:var(--text-muted)">Records unavailable.</p>`;
  }
}

function renderRecordsTable(container, records, total, pages) {
  if (!records.length) {
    container.innerHTML = `<p style="color:var(--text-muted)">No records yet. Create one above.</p>`;
    return;
  }
  container.innerHTML = `
    <p style="font-size:var(--text-xs);color:var(--text-muted);margin-bottom:var(--space-4);">${total} records · page ${recordsPage} of ${pages}</p>
    <table style="width:100%;border-collapse:collapse;font-size:var(--text-sm);">
      <thead>
        <tr style="border-bottom:1px solid var(--border-dim);color:var(--text-muted);text-align:left;">
          <th style="padding:var(--space-3) var(--space-4);font-weight:600;letter-spacing:0.08em;">Title</th>
          <th style="padding:var(--space-3) var(--space-4);">Type</th>
          <th style="padding:var(--space-3) var(--space-4);">Date</th>
          <th style="padding:var(--space-3) var(--space-4);text-align:right;">Actions</th>
        </tr>
      </thead>
      <tbody>
        ${records
          .map(
            (r) => `
          <tr style="border-bottom:1px solid var(--border-dim);" data-id="${r.id}">
            <td style="padding:var(--space-3) var(--space-4);color:var(--text-primary);">${escHtml(r.title)}</td>
            <td style="padding:var(--space-3) var(--space-4);"><span class="badge">${r.type}</span></td>
            <td style="padding:var(--space-3) var(--space-4);color:var(--text-muted);">${r.date ? new Date(r.date).getFullYear() : "—"}</td>
            <td style="padding:var(--space-3) var(--space-4);text-align:right;display:flex;gap:var(--space-2);justify-content:flex-end;">
              <button class="btn btn-secondary" style="padding:4px var(--space-3);font-size:11px;" onclick="editRecord('${r.id}', this.closest('tr'))">Edit</button>
              <button class="btn btn-secondary" style="padding:4px var(--space-3);font-size:11px;color:#e06060;border-color:#4a1515;" onclick="deleteRecord('${r.id}')">Delete</button>
            </td>
          </tr>`,
          )
          .join("")}
      </tbody>
    </table>
    ${
      pages > 1
        ? `<div style="display:flex;gap:var(--space-2);margin-top:var(--space-5);">
      ${recordsPage > 1 ? `<button class="btn btn-secondary" onclick="loadRecords(${recordsPage - 1})">← Prev</button>` : ""}
      ${recordsPage < pages ? `<button class="btn btn-secondary" onclick="loadRecords(${recordsPage + 1})">Next →</button>` : ""}
    </div>`
        : ""
    }`;
}

window.deleteRecord = async (id) => {
  if (!confirm("Delete this record? This cannot be undone.")) return;
  try {
    const res = await fetch(`/api/records/${id}`, {
      method: "DELETE",
      headers: authHeader(),
    });
    if (!res.ok) throw new Error();
    loadRecords(recordsPage);
    loadStats();
  } catch (_) {
    alert("Delete failed. Try again.");
  }
};

window.editRecord = async (id, row) => {
  const title = prompt("New title:", row.cells[0].textContent.trim());
  if (!title) return;
  try {
    const res = await fetch(`/api/records/${id}`, {
      method: "PUT",
      headers: { ...authHeader(), "Content-Type": "application/json" },
      body: JSON.stringify({ title }),
    });
    if (!res.ok) throw new Error();
    loadRecords(recordsPage);
  } catch (_) {
    alert("Update failed. Try again.");
  }
};

// Create record form
document
  .getElementById("create-record-form")
  ?.addEventListener("submit", async (e) => {
    e.preventDefault();
    const form = e.target;
    const body = {
      title: form.querySelector("[name='title']")?.value.trim(),
      type: form.querySelector("[name='type']")?.value,
      content: form.querySelector("[name='content']")?.value.trim(),
      tags: [],
    };
    if (!body.title || !body.type) return;
    try {
      const res = await fetch("/api/records", {
        method: "POST",
        headers: { ...authHeader(), "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) throw new Error();
      form.reset();
      loadRecords(1);
      loadStats();
    } catch (_) {
      alert("Create failed. Try again.");
    }
  });

// ── Timeline Events CRUD ────────────────────────────────────
async function loadTimelineEvents() {
  const container = document.getElementById("timeline-list");
  if (!container) return;
  container.innerHTML = loader();
  try {
    const res = await fetch("/api/timeline", { headers: authHeader() });
    if (!res.ok) throw new Error();
    const events = await res.json();
    renderTimelineTable(container, events);
  } catch (_) {
    container.innerHTML = `<p style="color:var(--text-muted)">Timeline events unavailable.</p>`;
  }
}

function renderTimelineTable(container, events) {
  if (!events.length) {
    container.innerHTML = `<p style="color:var(--text-muted)">No events yet.</p>`;
    return;
  }
  container.innerHTML = `
    <table style="width:100%;border-collapse:collapse;font-size:var(--text-sm);">
      <thead>
        <tr style="border-bottom:1px solid var(--border-dim);color:var(--text-muted);text-align:left;">
          <th style="padding:var(--space-3) var(--space-4);">Date</th>
          <th style="padding:var(--space-3) var(--space-4);">Title</th>
          <th style="padding:var(--space-3) var(--space-4);">Category</th>
          <th style="padding:var(--space-3) var(--space-4);text-align:right;">Actions</th>
        </tr>
      </thead>
      <tbody>
        ${events
          .map(
            (ev) => `
          <tr style="border-bottom:1px solid var(--border-dim);">
            <td style="padding:var(--space-3) var(--space-4);color:var(--text-muted);">${ev.date ? new Date(ev.date).toLocaleDateString("en-GB") : "—"}</td>
            <td style="padding:var(--space-3) var(--space-4);color:var(--text-primary);">${escHtml(ev.title)}</td>
            <td style="padding:var(--space-3) var(--space-4);"><span class="badge">${ev.category || "—"}</span></td>
            <td style="padding:var(--space-3) var(--space-4);text-align:right;">
              <button class="btn btn-secondary" style="padding:4px var(--space-3);font-size:11px;color:#e06060;border-color:#4a1515;" onclick="deleteTimelineEvent('${ev.id}')">Delete</button>
            </td>
          </tr>`,
          )
          .join("")}
      </tbody>
    </table>`;
}

window.deleteTimelineEvent = async (id) => {
  if (!confirm("Delete this event?")) return;
  try {
    const res = await fetch(`/api/timeline/${id}`, {
      method: "DELETE",
      headers: authHeader(),
    });
    if (!res.ok) throw new Error();
    loadTimelineEvents();
  } catch (_) {
    alert("Delete failed.");
  }
};

document
  .getElementById("create-event-form")
  ?.addEventListener("submit", async (e) => {
    e.preventDefault();
    const form = e.target;
    const body = {
      title: form.querySelector("[name='title']")?.value.trim(),
      date: form.querySelector("[name='date']")?.value,
      category: form.querySelector("[name='category']")?.value.trim() || null,
      summary: form.querySelector("[name='summary']")?.value.trim() || null,
    };
    if (!body.title || !body.date) return;
    try {
      const res = await fetch("/api/timeline", {
        method: "POST",
        headers: { ...authHeader(), "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) throw new Error();
      form.reset();
      loadTimelineEvents();
    } catch (_) {
      alert("Create failed.");
    }
  });

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

// ── Publish pipeline (Phase 0 — writes to storage/publish-staging only) ──
let lastPublishReport = null;

document
  .getElementById("publish-form")
  ?.addEventListener("submit", async (e) => {
    e.preventDefault();
    const form = e.target;
    const action = e.submitter?.dataset.action === "run" ? "run" : "validate";
    const type = form.querySelector("[name='type']")?.value;
    if (!type) return;

    const resultEl = document.getElementById("publish-result");
    if (resultEl) resultEl.innerHTML = loader();
    const buttons = form.querySelectorAll("[type='submit']");
    buttons.forEach((b) => (b.disabled = true));

    try {
      const method = action === "run" ? "POST" : "GET";
      const res = await fetch(`/api/publish/${type}/${action}`, {
        method,
        headers: authHeader(),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Request failed.");
      lastPublishReport = data;
      renderPublishResult(data);
    } catch (err) {
      if (resultEl) {
        resultEl.innerHTML = `<p style="color:#e06060;">${escHtml(err.message || "Publish request failed.")}</p>`;
      }
    } finally {
      buttons.forEach((b) => (b.disabled = false));
    }
  });

function renderPublishResult(report) {
  const container = document.getElementById("publish-result");
  if (!container) return;
  if (!report) {
    container.innerHTML = `<p style="color:var(--text-muted)">No publish run yet.</p>`;
    return;
  }

  const statusColor = report.invalid > 0 ? "#e0a060" : "#60c060";
  container.innerHTML = `
    <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(140px,1fr));gap:var(--space-4);margin-bottom:var(--space-6);">
      <div style="background:var(--bg-card);border:1px solid var(--border-dim);border-radius:var(--radius);padding:var(--space-4);">
        <div style="font-family:var(--font-display);font-size:var(--text-xl);font-weight:700;color:var(--gold);">${report.recordsChecked}</div>
        <div style="font-size:10px;color:var(--text-muted);letter-spacing:0.08em;text-transform:uppercase;">Checked</div>
      </div>
      <div style="background:var(--bg-card);border:1px solid var(--border-dim);border-radius:var(--radius);padding:var(--space-4);">
        <div style="font-family:var(--font-display);font-size:var(--text-xl);font-weight:700;color:#60c060;">${report.valid}</div>
        <div style="font-size:10px;color:var(--text-muted);letter-spacing:0.08em;text-transform:uppercase;">Valid</div>
      </div>
      <div style="background:var(--bg-card);border:1px solid var(--border-dim);border-radius:var(--radius);padding:var(--space-4);">
        <div style="font-family:var(--font-display);font-size:var(--text-xl);font-weight:700;color:${statusColor};">${report.invalid}</div>
        <div style="font-size:10px;color:var(--text-muted);letter-spacing:0.08em;text-transform:uppercase;">Invalid</div>
      </div>
    </div>
    ${
      report.issues.length
        ? `<div style="margin-bottom:var(--space-6);">
        <p style="font-size:var(--text-xs);color:var(--text-muted);letter-spacing:0.08em;text-transform:uppercase;margin-bottom:var(--space-3);">Issues</p>
        <div style="display:flex;flex-direction:column;gap:var(--space-2);">
          ${report.issues
            .map(
              (i) => `
            <div style="padding:var(--space-3);background:var(--bg-card);border:1px solid #4a1515;border-radius:var(--radius);font-size:var(--text-sm);">
              <span class="badge">${escHtml(i.field)}</span>
              <span style="color:var(--text-muted);margin-left:var(--space-2);">${escHtml(i.recordId)}</span>
              <p style="color:var(--text-secondary);margin-top:var(--space-1);">${escHtml(i.message)}</p>
            </div>`,
            )
            .join("")}
        </div>
      </div>`
        : ""
    }
    ${
      report.mode === "run"
        ? `<div>
        <p style="font-size:var(--text-xs);color:var(--text-muted);letter-spacing:0.08em;text-transform:uppercase;margin-bottom:var(--space-3);">Staged Files</p>
        ${
          report.staged.length
            ? `<ul style="font-size:var(--text-sm);color:var(--text-secondary);padding-left:var(--space-5);">${report.staged.map((s) => `<li>${escHtml(s)}</li>`).join("")}</ul>`
            : `<p style="color:var(--text-muted);">Nothing staged — no valid records to publish.</p>`
        }
      </div>`
        : ""
    }`;
}

// ── Helpers ─────────────────────────────────────────────────
function authHeader() {
  return { Authorization: `Bearer ${token}` };
}

function setLoginError(msg) {
  if (!loginError) return;
  loginError.textContent = msg;
  loginError.className = msg
    ? "contact-form__status is-error"
    : "contact-form__status";
}

function loader() {
  return `<div class="loader"><span class="loader__dot"></span><span class="loader__dot"></span><span class="loader__dot"></span></div>`;
}

function escHtml(str = "") {
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

init();
