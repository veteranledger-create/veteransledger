import { escHtml } from "./admin-utils.js";

/**
 * VeteransLedger · Admin — Structured Content Editor
 * Schema-tolerant visual editor for site-content JSON files, so normal
 * administrators never have to touch raw JSON (that stays behind the
 * optional Developer mode toggle in pages-admin.js).
 *
 * Field handling per top-level key:
 *  - string            → labelled text input / textarea
 *  - number, boolean   → typed input
 *  - `content` array   → block editor (paragraph, heading, quote, list,
 *                        image, link/button, table)
 *  - anything else     → per-field JSON area inside a collapsed
 *                        "Advanced" section (still structured per-key,
 *                        never the whole file as one blob)
 *
 * Block shapes match what the public renderers consume (see
 * SitePolicies/site-policies.js renderPolicy): { heading }, { text },
 * { quote }, { list: [] }, { image: { src, caption } },
 * { button: { label, href } }, { table: { headers: [], rows: [[]] } }.
 */

const BLOCK_TYPES = [
  { id: "text",    label: "Paragraph" },
  { id: "heading", label: "Heading" },
  { id: "quote",   label: "Quote" },
  { id: "list",    label: "List" },
  { id: "image",   label: "Image" },
  { id: "button",  label: "Link / Button" },
  { id: "table",   label: "Table" },
];

function blockType(block) {
  if (!block || typeof block !== "object") return "text";
  if (block.table) return "table";
  if (block.image) return "image";
  if (block.button) return "button";
  if (Array.isArray(block.list)) return "list";
  if (block.quote) return "quote";
  if (block.heading && !block.text) return "heading";
  return "text";
}

function emptyBlock(type) {
  switch (type) {
    case "heading": return { heading: "" };
    case "quote":   return { quote: "" };
    case "list":    return { list: [] };
    case "image":   return { image: { src: "", caption: "" } };
    case "button":  return { button: { label: "", href: "" } };
    case "table":   return { table: { headers: [], rows: [] } };
    default:        return { text: "" };
  }
}

// Table ⇄ text serialization: first line = headers, later lines = rows,
// cells separated by " | ". Simple, forgiving, and diff-friendly.
function tableToText(table) {
  const lines = [];
  if (table.headers?.length) lines.push(table.headers.join(" | "));
  for (const row of table.rows || []) lines.push((row || []).join(" | "));
  return lines.join("\n");
}
function textToTable(text) {
  const lines = String(text).split("\n").map((l) => l.trim()).filter(Boolean);
  if (!lines.length) return { headers: [], rows: [] };
  const split = (l) => l.split("|").map((c) => c.trim());
  return { headers: split(lines[0]), rows: lines.slice(1).map(split) };
}

export function createStructuredEditor(container, data) {
  container.innerHTML = "";
  const scalarKeys = [];
  const advancedKeys = [];
  let blocks = null; // working copy of the `content` array
  let blocksListEl = null;

  for (const [key, value] of Object.entries(data ?? {})) {
    if (key === "content" && Array.isArray(value)) {
      blocks = value.map((b) => (typeof b === "object" && b !== null ? { ...b } : { text: String(b) }));
      continue; // rendered after scalars so prose fields lead the form
    }
    if (typeof value === "string") {
      scalarKeys.push(key);
      const group = document.createElement("div");
      group.className = "contact-form__group";
      const long = value.length > 90 || value.includes("\n");
      group.innerHTML = `
        <label class="contact-form__label">${escHtml(key)}</label>
        ${long
          ? `<textarea class="contact-form__input" data-se-key="${escHtml(key)}" rows="3">${escHtml(value)}</textarea>`
          : `<input class="contact-form__input" data-se-key="${escHtml(key)}" value="${escHtml(value)}">`}`;
      container.appendChild(group);
    } else if (typeof value === "number" || typeof value === "boolean") {
      scalarKeys.push(key);
      const group = document.createElement("div");
      group.className = "contact-form__group";
      group.innerHTML = `
        <label class="contact-form__label">${escHtml(key)}</label>
        <input class="contact-form__input" data-se-key="${escHtml(key)}" data-se-type="${typeof value}" value="${escHtml(String(value))}" style="max-width:200px;">`;
      container.appendChild(group);
    } else {
      advancedKeys.push(key);
    }
  }

  // ── Content block editor ────────────────────────────────────────────
  if (blocks) {
    const section = document.createElement("div");
    section.innerHTML = `<div class="form-section-head form-section-head--divided">Content Blocks</div>`;
    blocksListEl = document.createElement("div");
    blocksListEl.style.cssText = "display:flex;flex-direction:column;gap:var(--space-3);";
    section.appendChild(blocksListEl);

    const addBar = document.createElement("div");
    addBar.style.cssText = "display:flex;flex-wrap:wrap;gap:var(--space-2);margin-top:var(--space-3);";
    addBar.innerHTML = BLOCK_TYPES.map((t) =>
      `<button type="button" class="btn btn-secondary btn--xs" data-se-add="${t.id}">+ ${t.label}</button>`).join("");
    addBar.querySelectorAll("[data-se-add]").forEach((btn) =>
      btn.addEventListener("click", () => {
        syncBlocksFromDom();
        blocks.push(emptyBlock(btn.dataset.seAdd));
        renderBlocks();
      }));
    section.appendChild(addBar);
    container.appendChild(section);
    renderBlocks();
  }

  function renderBlocks() {
    blocksListEl.innerHTML = blocks.map((block, i) => {
      const type = blockType(block);
      const label = BLOCK_TYPES.find((t) => t.id === type)?.label ?? type;
      let fields = "";
      switch (type) {
        case "heading":
          fields = `<input class="contact-form__input" data-bf="heading" value="${escHtml(block.heading || "")}" placeholder="Heading text">`;
          break;
        case "quote":
          fields = `<textarea class="contact-form__input" data-bf="quote" rows="2" placeholder="Quote text">${escHtml(block.quote || "")}</textarea>`;
          break;
        case "list":
          fields = `<textarea class="contact-form__input" data-bf="list" rows="3" placeholder="One item per line">${escHtml((block.list || []).join("\n"))}</textarea>`;
          break;
        case "image":
          fields = `
            <input class="contact-form__input mb-2" data-bf="image.src" value="${escHtml(block.image?.src || "")}" placeholder="Image URL (/public/images/…)">
            <input class="contact-form__input" data-bf="image.caption" value="${escHtml(block.image?.caption || "")}" placeholder="Caption (optional)">`;
          break;
        case "button":
          fields = `
            <div class="form-grid-2">
              <input class="contact-form__input" data-bf="button.label" value="${escHtml(block.button?.label || "")}" placeholder="Label">
              <input class="contact-form__input" data-bf="button.href" value="${escHtml(block.button?.href || "")}" placeholder="/destination or https://…">
            </div>`;
          break;
        case "table":
          fields = `
            <textarea class="contact-form__input" data-bf="table" rows="4" placeholder="Header 1 | Header 2\nCell | Cell">${escHtml(tableToText(block.table || {}))}</textarea>
            <p class="field-hint">First line = headers; one row per line; cells separated by "|".</p>`;
          break;
        default: // paragraph — optional heading + text (matches existing policy sections)
          fields = `
            <input class="contact-form__input mb-2" data-bf="heading" value="${escHtml(block.heading || "")}" placeholder="Section heading (optional)">
            <textarea class="contact-form__input" data-bf="text" rows="3" placeholder="Paragraph text — use <a href=&quot;…&quot;>text</a> for inline links">${escHtml(block.text || "")}</textarea>`;
      }
      return `
        <div class="admin-card" data-bi="${i}">
          <div style="display:flex;align-items:center;gap:var(--space-2);margin-bottom:var(--space-2);">
            <span class="badge">${escHtml(label)}</span>
            <span style="flex:1;"></span>
            <button type="button" class="btn btn-secondary btn--xs" data-bmove="-1" ${i === 0 ? "disabled" : ""} aria-label="Move block up"><svg class="icon-inline" width="10" height="10" viewBox="0 0 640 640" aria-hidden="true" xmlns="http://www.w3.org/2000/svg"><path fill="currentColor" d="M342.6 73.4C330.1 60.9 309.8 60.9 297.3 73.4L137.3 233.4C124.8 245.9 124.8 266.2 137.3 278.7C149.8 291.2 170.1 291.2 182.6 278.7L288 173.3L288 544C288 561.7 302.3 576 320 576C337.7 576 352 561.7 352 544L352 173.3L457.4 278.7C469.9 291.2 490.2 291.2 502.7 278.7C515.2 266.2 515.2 245.9 502.7 233.4L342.7 73.4z"/></svg></button>
            <button type="button" class="btn btn-secondary btn--xs" data-bmove="1" ${i === blocks.length - 1 ? "disabled" : ""} aria-label="Move block down"><svg class="icon-inline" width="10" height="10" viewBox="0 0 640 640" aria-hidden="true" xmlns="http://www.w3.org/2000/svg"><path fill="currentColor" d="M297.4 566.6C309.9 579.1 330.2 579.1 342.7 566.6L502.7 406.6C515.2 394.1 515.2 373.8 502.7 361.3C490.2 348.8 469.9 348.8 457.4 361.3L352 466.7L352 96C352 78.3 337.7 64 320 64C302.3 64 288 78.3 288 96L288 466.7L182.6 361.3C170.1 348.8 149.8 348.8 137.3 361.3C124.8 373.8 124.8 394.1 137.3 406.6L297.3 566.6z"/></svg></button>
            <button type="button" class="btn btn-secondary btn--xs btn--danger" data-bdelete aria-label="Delete block"><svg class="icon-inline" width="10" height="10" viewBox="0 0 24 24" aria-hidden="true" xmlns="http://www.w3.org/2000/svg"><path fill="currentColor" fill-rule="evenodd" clip-rule="evenodd" d="M5.29289 5.29289C5.68342 4.90237 6.31658 4.90237 6.70711 5.29289L12 10.5858L17.2929 5.29289C17.6834 4.90237 18.3166 4.90237 18.7071 5.29289C19.0976 5.68342 19.0976 6.31658 18.7071 6.70711L13.4142 12L18.7071 17.2929C19.0976 17.6834 19.0976 18.3166 18.7071 18.7071C18.3166 19.0976 17.6834 19.0976 17.2929 18.7071L12 13.4142L6.70711 18.7071C6.31658 19.0976 5.68342 19.0976 5.29289 18.7071C4.90237 18.3166 4.90237 17.6834 5.29289 17.2929L10.5858 12L5.29289 6.70711C4.90237 6.31658 4.90237 5.68342 5.29289 5.29289Z"/></svg></button>
          </div>
          ${fields}
        </div>`;
    }).join("") || `<p class="text-dim">No content blocks — add one below.</p>`;

    blocksListEl.querySelectorAll("[data-bi]").forEach((row) => {
      const i = +row.dataset.bi;
      row.querySelectorAll("[data-bmove]").forEach((btn) =>
        btn.addEventListener("click", () => {
          syncBlocksFromDom();
          const j = i + +btn.dataset.bmove;
          if (j < 0 || j >= blocks.length) return;
          [blocks[i], blocks[j]] = [blocks[j], blocks[i]];
          renderBlocks();
        }));
      row.querySelector("[data-bdelete]")?.addEventListener("click", () => {
        syncBlocksFromDom();
        blocks.splice(i, 1);
        renderBlocks();
      });
    });
  }

  function syncBlocksFromDom() {
    if (!blocksListEl) return;
    blocksListEl.querySelectorAll("[data-bi]").forEach((row) => {
      const i = +row.dataset.bi;
      if (!blocks[i]) return;
      row.querySelectorAll("[data-bf]").forEach((input) => {
        const path = input.dataset.bf;
        const v = input.value;
        if (path === "list") blocks[i].list = v.split("\n").map((s) => s.trim()).filter(Boolean);
        else if (path === "table") blocks[i].table = textToTable(v);
        else if (path.includes(".")) {
          const [outer, inner] = path.split(".");
          blocks[i][outer] = { ...(blocks[i][outer] || {}), [inner]: v };
        } else {
          // Paragraph blocks: drop an empty optional heading instead of storing ""
          if (path === "heading" && !v.trim() && blockType(blocks[i]) === "text") delete blocks[i].heading;
          else blocks[i][path] = v;
        }
      });
    });
  }

  // ── Advanced (non-scalar, non-content keys) ─────────────────────────
  if (advancedKeys.length) {
    const details = document.createElement("details");
    details.className = "attr-details";
    details.innerHTML = `
      <summary style="cursor:pointer;font-size:var(--text-xs);color:var(--text-muted);letter-spacing:.08em;text-transform:uppercase;margin:var(--space-4) 0 var(--space-2);">Advanced fields (structured data)</summary>
      ${advancedKeys.map((key) => `
        <div class="contact-form__group">
          <label class="contact-form__label">${escHtml(key)}</label>
          <textarea class="contact-form__input code-editor" data-se-adv="${escHtml(key)}" rows="5">${escHtml(JSON.stringify(data[key], null, 2))}</textarea>
        </div>`).join("")}`;
    container.appendChild(details);
  }

  return {
    /** Rebuild the full JSON object from the current editor state. Throws on invalid Advanced-field JSON. */
    read() {
      const out = { ...data };
      container.querySelectorAll("[data-se-key]").forEach((input) => {
        const key = input.dataset.seKey;
        const t = input.dataset.seType;
        out[key] = t === "number" ? Number(input.value)
          : t === "boolean" ? input.value.trim().toLowerCase() === "true"
          : input.value;
      });
      container.querySelectorAll("[data-se-adv]").forEach((ta) => {
        out[ta.dataset.seAdv] = JSON.parse(ta.value); // caller surfaces parse errors
      });
      if (blocks) {
        syncBlocksFromDom();
        out.content = blocks;
      }
      return out;
    },
  };
}
