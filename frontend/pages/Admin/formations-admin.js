import { TranslationsPanel } from "./translations-panel.js";
import { escHtml } from "./admin-utils.js";
import { initRelatedModal, openRelatedModal } from "./admin-related.js";
import { renderSources as renderSourcesFn, renderRelated as renderRelatedFn } from "./admin-form.js";
import { createContentModule } from "./admin-content-module.js";

/**
 * VeteransLedger · Admin — Formations
 * Full CRUD against /api/formations; structured form fields replace the old
 * raw-JSON textarea. Each formation maps to a DB record (type=FORMATION).
 *
 * Phase 3 pilot: this is the first module built on createContentModule().
 * Every behavior below matches the pre-Phase-3 module exactly (same fields,
 * same request shapes, same preview-refreshes-on-save loop) except where
 * noted — the shared factory adds dirty-state protection, submit-state
 * protection, and slug-format validation that didn't exist before.
 */

const SECTIONS = [
  { value: "army-groups",  label: "Army Groups" },
  { value: "armies",       label: "Armies" },
  { value: "corps",        label: "Corps" },
  { value: "divisions",    label: "Divisions" },
  { value: "waffen-ss",    label: "Waffen-SS" },
  { value: "luftwaffe",    label: "Luftwaffe" },
  { value: "kriegsmarine", label: "Kriegsmarine" },
  { value: "brigades",     label: "Brigades" },
  { value: "regiments",    label: "Regiments" },
  { value: "battalions",   label: "Battalions" },
  { value: "companies",    label: "Companies" },
  { value: "volunteers",   label: "Volunteer Formations" },
  { value: "allies",       label: "Axis Allies" },
];

const SLUG_PATTERN = /^[a-z0-9]+(-[a-z0-9]+)*$/;

const translationsPanel = new TranslationsPanel("formation-translations-panel", "record");

initRelatedModal();

function renderCommanders(draft, onUpdate) {
  const list = document.getElementById("formation-commanders-list");
  if (!list) return;
  if (!draft.length) {
    list.innerHTML = `<p class="empty-note">No commanders added yet.</p>`;
    return;
  }
  list.innerHTML = draft.map((c, i) => `
    <div class="commander-row">
      <input class="input" placeholder="Name" value="${escHtml(c.name || "")}" data-ci="${i}" data-field="name">
      <input class="input" placeholder="Period (e.g. Jun 1941–Jan 1942)" value="${escHtml(c.period || "")}" data-ci="${i}" data-field="period">
      <button type="button" class="btn btn-secondary btn--xs btn--danger" data-rm-cmd="${i}"><svg class="icon-inline" width="10" height="10" viewBox="0 0 24 24" aria-hidden="true" xmlns="http://www.w3.org/2000/svg"><path fill="currentColor" fill-rule="evenodd" clip-rule="evenodd" d="M5.29289 5.29289C5.68342 4.90237 6.31658 4.90237 6.70711 5.29289L12 10.5858L17.2929 5.29289C17.6834 4.90237 18.3166 4.90237 18.7071 5.29289C19.0976 5.68342 19.0976 6.31658 18.7071 6.70711L13.4142 12L18.7071 17.2929C19.0976 17.6834 19.0976 18.3166 18.7071 18.7071C18.3166 19.0976 17.6834 19.0976 17.2929 18.7071L12 13.4142L6.70711 18.7071C6.31658 19.0976 5.68342 19.0976 5.29289 18.7071C4.90237 18.3166 4.90237 17.6834 5.29289 17.2929L10.5858 12L5.29289 6.70711C4.90237 6.31658 4.90237 5.68342 5.29289 5.29289Z"/></svg></button>
    </div>`).join("");

  list.querySelectorAll("[data-ci]").forEach((inp) => {
    inp.addEventListener("input", (e) => {
      const { ci, field } = e.target.dataset;
      draft[+ci][field] = e.target.value;
    });
  });
  list.querySelectorAll("[data-rm-cmd]").forEach((btn) => {
    btn.addEventListener("click", () => {
      draft.splice(+btn.dataset.rmCmd, 1);
      onUpdate();
    });
  });
}

function renderFormationsList(container, { data, total, page, pages }, { onEdit, onDelete, onPage }) {
  container.innerHTML = `
    <p class="list-meta">${total} formations · page ${page} of ${pages}</p>
    <table class="admin-table">
      <thead><tr>
        <th>Name</th>
        <th>Section</th>
        <th>Nation</th>
        <th>Status</th>
        <th class="col-actions">Actions</th>
      </tr></thead>
      <tbody>
        ${data.map((r) => {
          const meta = r.metadata || {};
          const sectionLabel = SECTIONS.find((s) => s.value === meta.section)?.label || meta.section || "—";
          return `
          <tr>
            <td class="td-primary">${escHtml(r.title)}</td>
            <td class="td-muted">${escHtml(sectionLabel)}</td>
            <td class="td-muted">${escHtml(r.nationality || "—")}</td>
            <td>${r.published ? '<span class="status-published">Published</span>' : '<span class="status-draft">Draft</span>'}</td>
            <td class="col-actions">
              <button class="btn btn-secondary btn--xs" data-edit="${r.id}">Edit</button>
              <button class="btn btn-secondary btn--xs btn--danger" data-delete="${r.id}">Delete</button>
            </td>
          </tr>`;
        }).join("")}
      </tbody>
    </table>
    ${pages > 1 ? `<div class="pagination">
      ${page > 1 ? `<button class="btn btn-secondary" data-page="${page - 1}">← Prev</button>` : ""}
      ${page < pages ? `<button class="btn btn-secondary" data-page="${page + 1}">Next →</button>` : ""}
    </div>` : ""}`;

  container.querySelectorAll("[data-edit]").forEach((btn) => btn.addEventListener("click", () => onEdit(btn.dataset.edit)));
  container.querySelectorAll("[data-delete]").forEach((btn) => btn.addEventListener("click", () => onDelete(btn.dataset.delete)));
  container.querySelectorAll("[data-page]").forEach((btn) => btn.addEventListener("click", () => onPage(+btn.dataset.page)));
}

function populateForm(form, r, drafts) {
  const meta = r.metadata || {};
  form.querySelector("[name='title']").value = r.title || "";
  form.querySelector("[name='slug']").value = r.slug || "";
  form.querySelector("[name='section']").value = meta.section || "";
  form.querySelector("[name='formation_type']").value = meta.formation_type || "";
  form.querySelector("[name='nation']").value = r.nationality || "Germany";
  form.querySelector("[name='service']").value = meta.service || "";
  form.querySelector("[name='theater']").value = meta.theater || "";
  form.querySelector("[name='active_from']").value = meta.active?.from || "";
  form.querySelector("[name='active_to']").value = meta.active?.to || "";
  form.querySelector("[name='peak_strength']").value = meta.peak_strength || "";
  form.querySelector("[name='summary']").value = r.summary || "";
  form.querySelector("[name='context']").value = meta.context || "";
  form.querySelector("[name='published']").checked = !!r.published;

  drafts.commanders = Array.isArray(meta.commanders)
    ? meta.commanders.map((c) => ({ name: c.name || "", period: c.period || "" }))
    : [];
  drafts.sources = Array.isArray(meta.sources)
    ? meta.sources.map((s) => ({ ref: s.ref || "", type: s.type || "" }))
    : [];
  drafts.related = Array.isArray(meta.related_records) ? [...meta.related_records] : [];
}

function serializeForm(form, drafts) {
  const activeFrom = form.querySelector("[name='active_from']").value.trim();
  const activeTo   = form.querySelector("[name='active_to']").value.trim();
  const contextText = form.querySelector("[name='context']").value.trim();

  return {
    title:       form.querySelector("[name='title']").value.trim(),
    slug:        form.querySelector("[name='slug']").value.trim() || undefined,
    nationality: form.querySelector("[name='nation']").value.trim() || "Germany",
    summary:     form.querySelector("[name='summary']").value.trim() || undefined,
    published:   form.querySelector("[name='published']").checked,
    metadata: {
      section:        form.querySelector("[name='section']").value,
      formation_type: form.querySelector("[name='formation_type']").value.trim() || undefined,
      service:        form.querySelector("[name='service']").value.trim() || undefined,
      theater:        form.querySelector("[name='theater']").value.trim() || undefined,
      active: (activeFrom || activeTo) ? { from: activeFrom || undefined, to: activeTo || undefined } : undefined,
      peak_strength:  form.querySelector("[name='peak_strength']").value.trim() || undefined,
      context:        contextText || undefined,
      commanders:     drafts.commanders.filter((c) => c.name),
      sources:        drafts.sources.filter((s) => s.ref),
      related_records: drafts.related,
    },
  };
}

function validate(body) {
  const errors = [];
  if (!body.title) errors.push("Name is required.");
  if (!body.slug) errors.push("ID / Slug is required.");
  else if (!SLUG_PATTERN.test(body.slug)) errors.push("Slug must be lowercase letters, numbers, and dashes only (e.g. army-group-north).");
  if (!body.metadata.section) errors.push("Section is required.");
  return errors;
}

function renderPreview(rendered, issues) {
  const errors = issues.filter((i) => i.severity === "error");
  return `
    ${errors.length ? `<div class="preview-error">
      <strong>Cannot publish — ${errors.length} blocking issue(s):</strong>
      <ul>${errors.map((e) => `<li>${escHtml(e.message)}</li>`).join("")}</ul>
    </div>` : ""}
    <h3 class="preview-title">${escHtml(rendered.name || "—")}</h3>
    ${rendered.type ? `<p class="gold-dim mb-1">${escHtml(rendered.type)}</p>` : ""}
    ${rendered.nation ? `<p class="text-dim mb-1">Nation: ${escHtml(rendered.nation)}</p>` : ""}
    ${rendered.summary ? `<p class="mb-4">${escHtml(String(rendered.summary).slice(0, 300))}</p>` : ""}
    <pre class="preview-json">${escHtml(JSON.stringify(rendered, null, 2))}</pre>`;
}

createContentModule({
  idPrefix: "formation",
  apiBase: "/api/formations",
  tabPanelId: "tab-formations",
  tabButtonSelector: '[data-tab="tab-formations"]',
  pageSize: 50,
  filters: [
    { param: "section", event: "change" },
    { param: "search", event: "input", debounceMs: 350 },
  ],
  renderList: renderFormationsList,
  emptyMessage: "No formations yet. Create one above or run the data import.",
  translationsPanel,
  labels: { new: "New Formation", edit: "Edit Formation" },
  repeatableGroups: [
    {
      key: "commanders",
      addBtnId: "formation-add-commander-btn",
      render: renderCommanders,
      itemFactory: () => ({ name: "", period: "" }),
    },
    {
      key: "sources",
      addBtnId: "formation-add-source-btn",
      render: (draft, onUpdate) => renderSourcesFn("formation-sources-list", draft, onUpdate),
      itemFactory: () => ({ ref: "", type: "" }),
    },
    {
      key: "related",
      addBtnId: "formation-add-related-btn",
      render: (draft, onUpdate) => renderRelatedFn("formation-related-list", draft, onUpdate),
      onAdd: (draft, rerender) => openRelatedModal((item) => { draft.push(item); rerender(); }),
    },
  ],
  populateForm,
  serializeForm,
  validate,
  renderPreview,
});
