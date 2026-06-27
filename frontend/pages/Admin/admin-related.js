/**
 * VeteransLedger · Admin — Shared Related-Record Modal
 * Singleton ES module. Call initRelatedModal() in every content module's
 * init() — it is idempotent and wires #related-record-modal exactly once.
 * Call openRelatedModal(onPick) to open the modal; onPick is called with
 * { id, title, type, url } when the user selects a record.
 *
 * Fixes a double-listener bug: previously armaments-admin.js and
 * personnel-admin.js each wired the shared modal independently, causing
 * both handlers to fire when a user switched tabs between opening the
 * modal and saving.
 */

import { authHeader, escHtml, debounce } from "./admin-utils.js";

const TYPE_LABEL_MAP = {
  PERSON: "Personnel",
  LETTER: "Letter",
  ARTICLE: "Article",
  CAMPAIGN: "Campaign",
  ARMAMENT: "Armament",
};

let _initialized = false;
let _onPick = null;

export function initRelatedModal() {
  if (_initialized) return;
  _initialized = true;

  document.getElementById("related-record-modal-close")?.addEventListener("click", closeRelatedModal);
  document.getElementById("related-record-search-input")?.addEventListener("input", debounce(runSearch, 350));
  document.getElementById("related-record-modal")?.addEventListener("click", (e) => {
    if (e.target.id === "related-record-modal") closeRelatedModal();
  });
}

export function openRelatedModal(onPick) {
  _onPick = onPick;
  const modal = document.getElementById("related-record-modal");
  if (modal) modal.hidden = false;
  const input = document.getElementById("related-record-search-input");
  if (input) { input.value = ""; input.focus(); }
  const results = document.getElementById("related-record-search-results");
  if (results) results.innerHTML = "";
}

function closeRelatedModal() {
  const modal = document.getElementById("related-record-modal");
  if (modal) modal.hidden = true;
  _onPick = null;
}

async function runSearch(e) {
  const query = e.target.value.trim();
  const resultsEl = document.getElementById("related-record-search-results");
  if (!resultsEl) return;
  if (query.length < 2) { resultsEl.innerHTML = ""; return; }
  resultsEl.innerHTML = `<p style="color:var(--text-muted);">Searching…</p>`;
  try {
    const res = await fetch(`/api/search?q=${encodeURIComponent(query)}`, { headers: authHeader() });
    if (!res.ok) throw new Error();
    const data = await res.json();
    const items = [
      ...(data.entities || []).map((p) => ({ id: p.id, slug: p.slug, title: p.name, type: "PERSON" })),
      ...(data.records || []).map((r) => ({ id: r.id, slug: r.slug, title: r.title, type: r.type })),
    ];
    if (!items.length) {
      resultsEl.innerHTML = `<p style="color:var(--text-muted);">No results.</p>`;
      return;
    }
    resultsEl.innerHTML = items
      .map(
        (item, i) => `
      <div style="display:flex;justify-content:space-between;align-items:center;padding:var(--space-2) var(--space-3);border-bottom:1px solid var(--border-dim);cursor:pointer;" data-pick="${i}">
        <span><span class="badge" style="margin-right:var(--space-2);">${escHtml(item.type)}</span>${escHtml(item.title)}</span>
      </div>`,
      )
      .join("");
    resultsEl.querySelectorAll("[data-pick]").forEach((el) =>
      el.addEventListener("click", async () => {
        const item = items[+el.dataset.pick];
        const type = TYPE_LABEL_MAP[item.type] || item.type;
        const slugOrId = item.slug || item.id;
        let url = null;
        try {
          const r = await fetch(
            `/api/armaments/resolve-url?type=${encodeURIComponent(type)}&id=${encodeURIComponent(slugOrId)}`,
            { headers: authHeader() },
          );
          url = (await r.json()).url;
        } catch (_) {}
        _onPick?.({ id: slugOrId, title: item.title, type, url });
        closeRelatedModal();
      }),
    );
  } catch (_) {
    resultsEl.innerHTML = `<p style="color:var(--text-muted);">Search failed.</p>`;
  }
}
