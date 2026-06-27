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
    if (el) { el.textContent = msg; el.style.color = isError ? "#e06060" : "#60c060"; }
  };
}
