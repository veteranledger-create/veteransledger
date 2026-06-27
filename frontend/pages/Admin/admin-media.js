/**
 * VeteransLedger · Admin — Shared Media Management
 * Singleton ES module — all imports share the same state and the single
 * attribution modal. Call initMediaAdmin() from every content admin tab's
 * init() — it is idempotent and wires the modal buttons exactly once.
 * Call registerCallbacks(uploadFn, setStatusFn) whenever a content tab
 * becomes active so the replace-file handler uses the right module's functions.
 */

export const ATTR_FIELDS = [
  { key: "photographer", label: "Photographer / Creator",   types: ["image", "blueprint"] },
  { key: "archive",      label: "Archive / Collection",     types: ["image", "blueprint", "video", "document"] },
  { key: "license",      label: "License / Copyright",      types: ["image", "blueprint", "video", "document"] },
  { key: "capture_date", label: "Capture Date",             types: ["image", "blueprint"] },
  { key: "location",     label: "Location",                 types: ["image", "blueprint", "video"] },
  { key: "scale",        label: "Scale",                    types: ["blueprint"] },
  { key: "resolution",   label: "Resolution",               types: ["image", "video"] },
  { key: "codec",        label: "Codec",                    types: ["video"] },
  { key: "file_size",    label: "File Size",                types: ["image", "blueprint", "video", "document"] },
  { key: "manufacturer", label: "Manufacturer / Publisher", types: ["document"] },
  { key: "language",     label: "Language",                 types: ["document"] },
  { key: "notes",        label: "Notes",                    types: ["image", "blueprint", "video", "document"] },
];

export const REPLACE_ACCEPT = {
  image: "image/*",
  blueprint: "image/*",
  video: "video/mp4,video/webm",
  document: ".pdf,.doc,.docx,application/pdf,application/msword",
};

export const DOC_TYPE_OPTIONS = [
  { value: "pdf_manual",         label: "PDF Manual" },
  { value: "technical_document", label: "Technical Document" },
  { value: "crew_manual",        label: "Crew Manual" },
  { value: "field_manual",       label: "Field Manual" },
  { value: "original_document",  label: "Original Document" },
];

let _attrContext = null;   // { draft, index, renderFn, type }
let _replaceContext = null; // { draft, index, renderFn }
let _initialized = false;
let _uploadFn = null;
let _setStatusFn = null;

// Register the active content module's upload and status functions.
// Must be called whenever a content tab becomes active (and once at init).
export function registerCallbacks(uploadFn, setStatusFn) {
  _uploadFn = uploadFn;
  _setStatusFn = setStatusFn;
}

// Wire the shared attribution modal and replace-file input. Idempotent.
export function initMediaAdmin() {
  if (_initialized) return;
  _initialized = true;

  document.getElementById("admin-attr-modal-close")?.addEventListener("click", closeAdminAttributionModal);
  document.getElementById("admin-attr-modal-save")?.addEventListener("click", saveAdminAttribution);
  document.getElementById("admin-attr-modal-clear")?.addEventListener("click", clearAdminAttributionInputs);
  document.getElementById("admin-attribution-modal")?.addEventListener("click", (e) => {
    if (e.target.id === "admin-attribution-modal") closeAdminAttributionModal();
  });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && !document.getElementById("admin-attribution-modal")?.hidden) {
      closeAdminAttributionModal();
    }
  });
  document.getElementById("admin-attr-technical-details")?.addEventListener("toggle", (e) => {
    const arrow = document.getElementById("admin-attr-technical-arrow");
    if (arrow) arrow.style.transform = e.target.open ? "rotate(90deg)" : "";
  });
  document.getElementById("admin-replace-file-input")?.addEventListener("change", async (e) => {
    const file = e.target.files[0];
    if (!file || !_replaceContext) return;
    const { draft, index, renderFn } = _replaceContext;
    _replaceContext = null;
    e.target.value = "";
    _setStatusFn?.("Replacing file…", false);
    try {
      const asset = await _uploadFn(file);
      draft[index].file = asset.url;
      renderFn();
      _setStatusFn?.("File replaced. Save to persist.", false);
    } catch (_) {
      _setStatusFn?.("Replace failed. Try again.", true);
    }
  });
}

export function mediaItemControls(draft, i, renderFn, type) {
  const hasAttr = ATTR_FIELDS.some((f) => f.types.includes(type) && draft[i][f.key]);
  return `
    <div class="media-card__actions">
      <button type="button" data-attr-open="${i}" class="btn btn-secondary media-action-btn${hasAttr ? " media-action-btn--attr-active" : ""}" title="Source &amp; Attribution">ℹ Attribution</button>
      <button type="button" data-replace="${i}" class="btn btn-secondary media-action-btn" title="Replace file">↺ Replace</button>
      <span class="media-action-sep"></span>
      <button type="button" data-mv-up="${i}" class="btn btn-secondary media-action-btn" ${i === 0 ? "disabled" : ""} title="Move up">↑</button>
      <button type="button" data-mv-dn="${i}" class="btn btn-secondary media-action-btn" ${i === draft.length - 1 ? "disabled" : ""} title="Move down">↓</button>
      <span class="media-action-sep"></span>
      <button type="button" data-rm="${i}" class="btn btn-secondary media-action-btn media-action-btn--danger" title="Remove">✕ Remove</button>
    </div>`;
}

export function updateSectionCount(id, n, sing, plur) {
  const el = document.getElementById(id);
  if (el) el.textContent = n === 0 ? `No ${plur}` : `${n} ${n === 1 ? sing : plur}`;
}

export function wireMediaItemControls(container, draft, renderFn, type) {
  container.querySelectorAll("[data-mv-up]").forEach((btn) => btn.addEventListener("click", () => {
    const i = +btn.dataset.mvUp;
    if (i > 0) { [draft[i - 1], draft[i]] = [draft[i], draft[i - 1]]; renderFn(); }
  }));
  container.querySelectorAll("[data-mv-dn]").forEach((btn) => btn.addEventListener("click", () => {
    const i = +btn.dataset.mvDn;
    if (i < draft.length - 1) { [draft[i], draft[i + 1]] = [draft[i + 1], draft[i]]; renderFn(); }
  }));
  container.querySelectorAll("[data-rm]").forEach((btn) => btn.addEventListener("click", () => {
    draft.splice(+btn.dataset.rm, 1); renderFn();
  }));
  container.querySelectorAll("[data-attr-open]").forEach((btn) => btn.addEventListener("click", () => {
    openAdminAttributionModal(draft, +btn.dataset.attrOpen, renderFn, type);
  }));
  container.querySelectorAll("[data-replace]").forEach((btn) => btn.addEventListener("click", () => {
    triggerReplaceFile(draft, +btn.dataset.replace, renderFn, type);
  }));
}

export function openAdminAttributionModal(draft, index, renderFn, type) {
  _attrContext = { draft, index, renderFn, type };
  const item = draft[index];

  const heading = document.getElementById("admin-attr-modal-heading");
  if (heading) heading.textContent = item.title ? `Attribution — ${item.title}` : "Source & Attribution";

  ATTR_FIELDS.forEach((f) => {
    const row = document.getElementById(`admin-attr-row-${f.key}`);
    if (row) row.hidden = !f.types.includes(type);
    const input = document.getElementById(`admin-attr-${f.key}`);
    if (input) input.value = item[f.key] || "";
  });

  const locSection = document.getElementById("admin-attr-section-location");
  if (locSection) locSection.hidden = type === "document";
  const pubSection = document.getElementById("admin-attr-section-publishing");
  if (pubSection) pubSection.hidden = type !== "document";

  document.getElementById("admin-attribution-modal").hidden = false;
}

function closeAdminAttributionModal() {
  document.getElementById("admin-attribution-modal").hidden = true;
  _attrContext = null;
}

function saveAdminAttribution() {
  if (!_attrContext) return;
  const { draft, index, renderFn, type } = _attrContext;
  const item = draft[index];
  ATTR_FIELDS.forEach((f) => {
    if (!f.types.includes(type)) return;
    const input = document.getElementById(`admin-attr-${f.key}`);
    const val = input?.value.trim();
    if (val) item[f.key] = val;
    else delete item[f.key];
  });
  renderFn();
  closeAdminAttributionModal();
}

function clearAdminAttributionInputs() {
  ATTR_FIELDS.forEach((f) => {
    const input = document.getElementById(`admin-attr-${f.key}`);
    if (input) input.value = "";
  });
}

export function clearSectionAttribution(draft, renderFn, type) {
  if (!draft.length) { _setStatusFn?.("No items to clear.", false); return; }
  draft.forEach((item) => {
    ATTR_FIELDS.forEach((f) => { if (f.types.includes(type)) delete item[f.key]; });
  });
  renderFn();
  _setStatusFn?.(`Attribution cleared from all ${draft.length} item(s). Save to persist.`, false);
}

export function triggerReplaceFile(draft, index, renderFn, type) {
  _replaceContext = { draft, index, renderFn };
  const input = document.getElementById("admin-replace-file-input");
  if (input) {
    input.accept = REPLACE_ACCEPT[type] || "*";
    input.click();
  }
}

export async function validateMediaUrls(draft, renderFn) {
  if (!draft.length) { _setStatusFn?.("No items to validate.", false); return; }
  _setStatusFn?.(`Checking ${draft.length} URL(s)…`, false);
  const results = await Promise.all(
    draft.map(async (item, i) => {
      try {
        const r = await fetch(item.file, { method: "HEAD" });
        return { i, ok: r.ok, status: r.status };
      } catch { return { i, ok: false, status: 0 }; }
    }),
  );
  const broken = results.filter((r) => !r.ok);
  if (!broken.length) { _setStatusFn?.(`All ${draft.length} URL(s) reachable.`, false); return; }
  const detail = broken.map((b) => `  ${draft[b.i].file || "(no URL)"} [${b.status || "network error"}]`).join("\n");
  if (confirm(`Found ${broken.length} unreachable file(s):\n\n${detail}\n\nRemove these items?`)) {
    broken.sort((a, b) => b.i - a.i).forEach(({ i }) => draft.splice(i, 1));
    renderFn();
    _setStatusFn?.(`Removed ${broken.length} broken item(s). Save to persist.`, false);
  } else {
    _setStatusFn?.(`${broken.length} broken URL(s) found — kept. Verify manually.`, true);
  }
}
