/**
 * VeteransLedger · Admin — Icon Picker
 * Centralized, searchable icon selection for every Admin surface that needs
 * an icon. Backed by GET /api/icons, which scans the official project
 * library (public/images/icons/) on the server — so the picker can only ever
 * offer icons that genuinely exist, and admins never type SVG paths by hand.
 *
 * Usage:
 *   import { openIconPicker, iconPath, iconIdFromPath } from "./admin-icon-picker.js";
 *   openIconPicker({ onSelect: (id, path) => { ... } });
 *
 * Stores/returns the icon identifier (e.g. "ui/campaigns"); iconPath() maps
 * it to the served asset URL.
 */

let manifestPromise = null;

async function loadManifest() {
  if (!manifestPromise) {
    manifestPromise = fetch("/api/icons")
      .then((r) => (r.ok ? r.json() : { icons: [] }))
      .catch(() => ({ icons: [] }));
  }
  return manifestPromise;
}

export function iconPath(id) {
  return `/public/images/icons/${id}.svg`;
}

/** Reverse of iconPath — returns null if the path isn't a project icon path. */
export function iconIdFromPath(p) {
  const m = /^\/public\/images\/icons\/(.+)\.svg$/.exec(p || "");
  return m ? m[1] : null;
}

/** True if the given id exists in the official library. */
export async function isValidIconId(id) {
  const { icons } = await loadManifest();
  return icons.some((i) => i.id === id);
}

export async function openIconPicker({ current, onSelect } = {}) {
  const { icons } = await loadManifest();

  // Singleton modal — created on first use, reused afterward.
  let overlay = document.getElementById("icon-picker-modal");
  if (!overlay) {
    overlay = document.createElement("div");
    overlay.id = "icon-picker-modal";
    overlay.className = "modal-overlay";
    overlay.innerHTML = `
      <div class="modal-panel" role="dialog" aria-modal="true" aria-label="Select an icon">
        <div class="modal-header">
          <span class="section-label section-label--flush">Select Icon</span>
          <button type="button" class="btn btn-secondary btn--xs" data-ip-close>Close</button>
        </div>
        <input type="text" class="contact-form__input" data-ip-search placeholder="Search icons…"
          style="margin:var(--space-3) var(--space-5);width:calc(100% - 2 * var(--space-5));" aria-label="Search icons">
        <div class="modal-body" data-ip-body style="max-height:55vh;overflow-y:auto;padding:0 var(--space-5) var(--space-5);"></div>
      </div>`;
    document.body.appendChild(overlay);
    overlay.addEventListener("click", (e) => { if (e.target === overlay) close(); });
    overlay.querySelector("[data-ip-close]").addEventListener("click", close);
    overlay.addEventListener("keydown", (e) => {
      if (e.key === "Escape") { e.stopPropagation(); close(); }
    });
  }

  const searchEl = overlay.querySelector("[data-ip-search]");
  const bodyEl = overlay.querySelector("[data-ip-body]");

  function close() {
    overlay.hidden = true;
  }

  function render(filter) {
    const q = (filter || "").trim().toLowerCase();
    const visible = q ? icons.filter((i) => i.id.toLowerCase().includes(q)) : icons;

    if (!visible.length) {
      bodyEl.innerHTML = `<p class="text-dim" style="padding:var(--space-4) 0;">No icons match "${q}".</p>`;
      return;
    }

    const byCategory = new Map();
    for (const icon of visible) {
      if (!byCategory.has(icon.category)) byCategory.set(icon.category, []);
      byCategory.get(icon.category).push(icon);
    }

    bodyEl.innerHTML = [...byCategory.entries()].map(([category, list]) => `
      <div class="ip-group">
        <div class="form-section-head" style="margin:var(--space-4) 0 var(--space-2);">${category}</div>
        <div class="ip-grid">
          ${list.map((i) => `
            <button type="button" class="ip-item${i.id === current ? " ip-item--selected" : ""}"
              data-ip-id="${i.id}" title="${i.id}" aria-label="Icon: ${i.id}">
              <img src="${iconPath(i.id)}" alt="" loading="lazy">
              <span class="ip-item__name">${i.id.split("/").pop()}</span>
            </button>`).join("")}
        </div>
      </div>`).join("");

    bodyEl.querySelectorAll("[data-ip-id]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const id = btn.dataset.ipId;
        close();
        onSelect?.(id, iconPath(id));
      });
    });
  }

  searchEl.value = "";
  searchEl.oninput = () => render(searchEl.value);
  render("");
  overlay.hidden = false;
  searchEl.focus();
}
