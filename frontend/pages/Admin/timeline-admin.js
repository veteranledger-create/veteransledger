import { TranslationsPanel } from "./translations-panel.js";
import { escHtml } from "./admin-utils.js";
import { initRelatedModal, openRelatedModal } from "./admin-related.js";
import { renderSources as renderSourcesFn, renderRelated as renderRelatedFn } from "./admin-form.js";
import { createContentModule } from "./admin-content-module.js";

/**
 * VeteransLedger · Admin — Timeline Events
 * Timeline-event-specific logic only. No media (Timeline never had a
 * gallery/documents section) and no preview (no generator/conformance
 * checker exists for timeline events). Shared infrastructure lives in
 * admin-content-module and the pre-existing admin-utils / admin-related /
 * admin-form modules.
 */

const translationsPanel = new TranslationsPanel("timeline-translations-panel", "timeline_event");

function renderTimelineList(container, { data, total, page, pages }, { onEdit, onDelete, onPage }) {
  container.innerHTML = `
    <p class="list-meta">${total} event(s) · page ${page} of ${pages}</p>
    <table class="admin-table">
      <thead>
        <tr>
          <th style="width:60px;">Year</th>
          <th style="width:100px;">Date</th>
          <th style="width:90px;">Category</th>
          <th>Title</th>
          <th>Location</th>
          <th style="width:80px;">Status</th>
          <th class="col-actions">Actions</th>
        </tr>
      </thead>
      <tbody>
        ${data.map((ev) => `
          <tr>
            <td class="td-muted">${escHtml(String(ev.year ?? "—"))}</td>
            <td class="td-small">${ev.date ? escHtml(ev.date.slice(0, 10)) : "—"}</td>
            <td>${ev.category ? `<span class="badge">${escHtml(ev.category)}</span>` : "—"}</td>
            <td class="td-primary">${escHtml(ev.title)}</td>
            <td class="td-small">${ev.location ? escHtml(ev.location) : "—"}</td>
            <td>${ev.published ? '<span class="status-published">Published</span>' : '<span class="status-draft">Draft</span>'}</td>
            <td class="col-actions">
              <button class="btn btn-secondary btn--xs" data-edit="${ev.id}">Edit</button>
              <button class="btn btn-secondary btn--xs btn--danger" data-delete="${ev.id}">Delete</button>
            </td>
          </tr>`).join("")}
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
  form.querySelector("[name='year']").value = r.year ?? "";
  form.querySelector("[name='date']").value = r.date ? r.date.slice(0, 10) : "";
  form.querySelector("[name='endDate']").value = r.endDate ? r.endDate.slice(0, 10) : "";
  form.querySelector("[name='category']").value = r.category || "";
  form.querySelector("[name='title']").value = r.title || "";
  form.querySelector("[name='location']").value = r.location || "";
  form.querySelector("[name='summary']").value = r.summary || "";
  form.querySelector("[name='significance']").value = r.significance || "";
  form.querySelector("[name='published']").checked = !!r.published;

  drafts.sources = Array.isArray(meta.sources) ? meta.sources.map((s) => ({ ref: s.ref || "", type: s.type || "" })) : [];
  drafts.related = Array.isArray(meta.related_records) ? [...meta.related_records] : [];
}

function serializeForm(form, drafts) {
  const yearRaw = form.querySelector("[name='year']").value.trim();
  const dateRaw = form.querySelector("[name='date']").value.trim();

  return {
    year: yearRaw ? Number(yearRaw) : (dateRaw ? new Date(dateRaw).getFullYear() : null),
    date: dateRaw || null,
    endDate: form.querySelector("[name='endDate']").value.trim() || null,
    category: form.querySelector("[name='category']").value || null,
    title: form.querySelector("[name='title']").value.trim(),
    location: form.querySelector("[name='location']").value.trim() || null,
    summary: form.querySelector("[name='summary']").value.trim() || null,
    significance: form.querySelector("[name='significance']").value.trim() || null,
    published: form.querySelector("[name='published']").checked,
    metadata: {
      sources: drafts.sources.filter((s) => s.ref),
      related_records: drafts.related,
    },
  };
}

createContentModule({
  idPrefix: "timeline",
  apiBase: "/api/timeline",
  tabPanelId: "tab-timeline",
  tabButtonSelector: '[data-tab="tab-timeline"]',
  pageSize: 50,
  filters: [
    { param: "year", event: "input", debounceMs: 350 },
    { param: "category", event: "change" },
  ],
  renderList: renderTimelineList,
  emptyMessage: 'No timeline events yet. Click "+ New Event" to create one.',
  translationsPanel,
  labels: { new: "New Event", edit: "Edit Event" },
  repeatableGroups: [
    {
      key: "sources",
      addBtnId: "timeline-add-source-btn",
      render: (draft, onUpdate) => renderSourcesFn("timeline-sources-list", draft, onUpdate),
      itemFactory: () => ({ ref: "", type: "" }),
    },
    {
      key: "related",
      addBtnId: "timeline-add-related-btn",
      render: (draft, onUpdate) => renderRelatedFn("timeline-related-list", draft, onUpdate),
      onAdd: (draft, rerender) => openRelatedModal((item) => { draft.push(item); rerender(); }),
    },
  ],
  populateForm,
  serializeForm,
  validate: (body) => {
    if (!body.year && !body.date) return ["At least a Year or Start Date is required."];
    return [];
  },
  onInit: () => {
    initRelatedModal();
  },
});
