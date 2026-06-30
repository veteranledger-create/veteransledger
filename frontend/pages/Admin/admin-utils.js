/**
 * VeteransLedger · Admin — Shared Utilities
 * Pure helpers shared by every content admin module.
 * No side effects on import — all exports are pure or read sessionStorage only.
 */

export function authHeader() {
  const token = sessionStorage.getItem("vl_admin_token");
  return token ? { Authorization: `Bearer ${token}` } : {};
}

export function escHtml(str = "") {
  return String(str).replace(
    /[&<>"']/g,
    (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]),
  );
}

export function debounce(fn, ms) {
  let t;
  return (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), ms); };
}

export function loader() {
  return `<div class="loader"><span class="loader__dot"></span><span class="loader__dot"></span><span class="loader__dot"></span></div>`;
}

export function toggleModal(id, show) {
  const el = document.getElementById(id);
  if (el) el.hidden = !show;
}

export function makeStatusFn(elementId) {
  return (msg, isError) => {
    const el = document.getElementById(elementId);
    if (!el) return;
    el.textContent = msg;
    el.className = "form-status" + (msg ? (isError ? " form-status--err" : " form-status--ok") : "");
    if (!isError && msg) {
      clearTimeout(el._autoDismiss);
      el._autoDismiss = setTimeout(() => {
        if (el.textContent === msg) { el.textContent = ""; el.className = "form-status"; }
      }, 3500);
    }
  };
}

/**
 * Safe JSON extractor — guards against the "Unexpected token '<'" error that
 * occurs when the server returns an HTML error page instead of JSON.
 * On a non-JSON 401 (session expired / middleware rejection), clears the stored
 * token and throws a user-friendly message. On any other non-JSON response,
 * throws a clean HTTP-status message.
 */
export async function safeJson(res) {
  const ct = res.headers.get("content-type") || "";
  if (!ct.includes("application/json")) {
    if (res.status === 401) {
      sessionStorage.removeItem("vl_admin_token");
      throw new Error("Session expired — please refresh the page to log in again.");
    }
    throw new Error(`Server error (HTTP ${res.status}).`);
  }
  return res.json();
}
