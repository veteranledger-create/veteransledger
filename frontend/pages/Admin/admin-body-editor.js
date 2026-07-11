import { escHtml } from "./admin-utils.js";

/**
 * VeteransLedger · Admin — Block-based body editor
 * Shared component for structured content authoring.
 *
 * API:
 *   initBodyEditor(containerId, blocks)  — renders editor into #containerId
 *   readBodyBlocks(containerId)          — reads current blocks as JSON array
 *
 * Block schema (stored in metadata.body):
 *   { type: "paragraph"|"heading"|"quote"|"list"|"numbered-list"|"image", text: "…" }
 *   Image also accepts: { url, caption, source }
 *   List types: text is newline-separated items (compatible with existing data)
 */

const BLOCK_TYPES = [
  { value: "paragraph",     label: "Paragraph" },
  { value: "heading",       label: "Heading" },
  { value: "quote",         label: "Quote" },
  { value: "list",          label: "Bullet List" },
  { value: "numbered-list", label: "Numbered List" },
  { value: "image",         label: "Image" },
];

const PLACEHOLDERS = {
  paragraph:       "Paragraph text…",
  heading:         "Section heading…",
  quote:           "Quote or excerpt…",
  list:            "Item 1\nItem 2\nItem 3",
  "numbered-list": "Step 1\nStep 2\nStep 3",
  image:           "Image URL (https://…)",
};

const ROWS = {
  paragraph:       5,
  heading:         1,
  quote:           3,
  list:            4,
  "numbered-list": 4,
  image:           1,
};

function typeOptions(selected) {
  return BLOCK_TYPES.map(
    (t) => `<option value="${t.value}"${selected === t.value ? " selected" : ""}>${t.label}</option>`,
  ).join("");
}

function blockHtml(block) {
  const type = block.type || "paragraph";
  const isImage = type === "image";
  const isList = type === "list" || type === "numbered-list";
  let textVal = isImage
    ? (block.url || block.src || "")
    : isList && Array.isArray(block.items)
      ? block.items.join("\n")
      : (block.text || "");

  return `
    <div class="body-block">
      <div class="body-block__header">
        <select class="body-block__type contact-form__input" style="flex:0 0 auto;width:auto;padding:3px 6px;font-size:var(--text-xs);">${typeOptions(type)}</select>
        <span style="flex:1"></span>
        <button type="button" class="btn btn-secondary body-block__up"     style="padding:2px 8px;font-size:11px;" title="Move up" aria-label="Move block up"><svg class="icon-inline" width="10" height="10" viewBox="0 0 640 640" aria-hidden="true" xmlns="http://www.w3.org/2000/svg"><path fill="currentColor" d="M342.6 73.4C330.1 60.9 309.8 60.9 297.3 73.4L137.3 233.4C124.8 245.9 124.8 266.2 137.3 278.7C149.8 291.2 170.1 291.2 182.6 278.7L288 173.3L288 544C288 561.7 302.3 576 320 576C337.7 576 352 561.7 352 544L352 173.3L457.4 278.7C469.9 291.2 490.2 291.2 502.7 278.7C515.2 266.2 515.2 245.9 502.7 233.4L342.7 73.4z"/></svg></button>
        <button type="button" class="btn btn-secondary body-block__down"   style="padding:2px 8px;font-size:11px;" title="Move down" aria-label="Move block down"><svg class="icon-inline" width="10" height="10" viewBox="0 0 640 640" aria-hidden="true" xmlns="http://www.w3.org/2000/svg"><path fill="currentColor" d="M297.4 566.6C309.9 579.1 330.2 579.1 342.7 566.6L502.7 406.6C515.2 394.1 515.2 373.8 502.7 361.3C490.2 348.8 469.9 348.8 457.4 361.3L352 466.7L352 96C352 78.3 337.7 64 320 64C302.3 64 288 78.3 288 96L288 466.7L182.6 361.3C170.1 348.8 149.8 348.8 137.3 361.3C124.8 373.8 124.8 394.1 137.3 406.6L297.3 566.6z"/></svg></button>
        <button type="button" class="btn btn-secondary body-block__delete" style="padding:2px 8px;font-size:11px;color:#e06060;border-color:#4a1515;" title="Remove"><svg class="icon-inline" width="10" height="10" viewBox="0 0 24 24" aria-hidden="true" xmlns="http://www.w3.org/2000/svg"><path fill="currentColor" fill-rule="evenodd" clip-rule="evenodd" d="M5.29289 5.29289C5.68342 4.90237 6.31658 4.90237 6.70711 5.29289L12 10.5858L17.2929 5.29289C17.6834 4.90237 18.3166 4.90237 18.7071 5.29289C19.0976 5.68342 19.0976 6.31658 18.7071 6.70711L13.4142 12L18.7071 17.2929C19.0976 17.6834 19.0976 18.3166 18.7071 18.7071C18.3166 19.0976 17.6834 19.0976 17.2929 18.7071L12 13.4142L6.70711 18.7071C6.31658 19.0976 5.68342 19.0976 5.29289 18.7071C4.90237 18.3166 4.90237 17.6834 5.29289 17.2929L10.5858 12L5.29289 6.70711C4.90237 6.31658 4.90237 5.68342 5.29289 5.29289Z"/></svg></button>
      </div>
      <textarea class="body-block__text contact-form__input" rows="${ROWS[type] || 3}"
        placeholder="${escHtml(PLACEHOLDERS[type] || "")}"
        style="margin-top:var(--space-2);resize:vertical;">${escHtml(textVal)}</textarea>
      ${isImage ? `
      <div class="body-block__img-extras" style="display:grid;grid-template-columns:1fr 1fr;gap:var(--space-2);margin-top:var(--space-2);">
        <input class="body-block__caption contact-form__input" type="text" placeholder="Caption (optional)" value="${escHtml(block.caption || "")}" style="font-size:var(--text-xs);">
        <input class="body-block__source contact-form__input"  type="text" placeholder="Source attribution (optional)" value="${escHtml(block.source || "")}" style="font-size:var(--text-xs);">
      </div>` : ""}
      ${isList ? `<p class="body-block__hint">One item per line</p>` : ""}
    </div>`;
}

function attachBlockEvents(el) {
  el.querySelector(".body-block__up").addEventListener("click", () => {
    const prev = el.previousElementSibling;
    if (prev) el.parentNode.insertBefore(el, prev);
  });
  el.querySelector(".body-block__down").addEventListener("click", () => {
    const next = el.nextElementSibling;
    if (next) next.after(el);
  });
  el.querySelector(".body-block__delete").addEventListener("click", () => el.remove());
  el.querySelector(".body-block__type").addEventListener("change", (e) => {
    const type = e.target.value;
    const isImage = type === "image";
    const isList = type === "list" || type === "numbered-list";
    const textarea = el.querySelector(".body-block__text");
    textarea.placeholder = PLACEHOLDERS[type] || "";
    textarea.rows = ROWS[type] || 3;

    let imgExtras = el.querySelector(".body-block__img-extras");
    if (isImage && !imgExtras) {
      imgExtras = document.createElement("div");
      imgExtras.className = "body-block__img-extras";
      imgExtras.style.cssText = "display:grid;grid-template-columns:1fr 1fr;gap:var(--space-2);margin-top:var(--space-2);";
      imgExtras.innerHTML = `
        <input class="body-block__caption contact-form__input" type="text" placeholder="Caption (optional)" style="font-size:var(--text-xs);">
        <input class="body-block__source contact-form__input"  type="text" placeholder="Source attribution (optional)" style="font-size:var(--text-xs);">`;
      textarea.after(imgExtras);
    } else if (!isImage && imgExtras) {
      imgExtras.remove();
    }

    let hint = el.querySelector(".body-block__hint");
    if (isList && !hint) {
      hint = document.createElement("p");
      hint.className = "body-block__hint";
      hint.textContent = "One item per line";
      el.appendChild(hint);
    } else if (!isList && hint) {
      hint.remove();
    }
  });
}

function makeBlockEl(block) {
  const wrap = document.createElement("div");
  wrap.innerHTML = blockHtml(block).trim();
  const el = wrap.firstElementChild;
  attachBlockEvents(el);
  return el;
}

export function initBodyEditor(containerId, blocks = []) {
  const container = document.getElementById(containerId);
  if (!container) return;
  container.innerHTML = "";

  const list = document.createElement("div");
  list.className = "body-editor__blocks";

  const toolbar = document.createElement("div");
  toolbar.className = "body-editor__toolbar";
  toolbar.innerHTML = `
    <button type="button" class="btn btn-secondary" data-add="paragraph"     style="font-size:11px;"><svg class="icon-inline" width="10" height="10" viewBox="0 0 640 640" aria-hidden="true" xmlns="http://www.w3.org/2000/svg"><path fill="currentColor" d="M352 128C352 110.3 337.7 96 320 96C302.3 96 288 110.3 288 128L288 288L128 288C110.3 288 96 302.3 96 320C96 337.7 110.3 352 128 352L288 352L288 512C288 529.7 302.3 544 320 544C337.7 544 352 529.7 352 512L352 352L512 352C529.7 352 544 337.7 544 320C544 302.3 529.7 288 512 288L352 288L352 128z"/></svg> Paragraph</button>
    <button type="button" class="btn btn-secondary" data-add="heading"       style="font-size:11px;"><svg class="icon-inline" width="10" height="10" viewBox="0 0 640 640" aria-hidden="true" xmlns="http://www.w3.org/2000/svg"><path fill="currentColor" d="M352 128C352 110.3 337.7 96 320 96C302.3 96 288 110.3 288 128L288 288L128 288C110.3 288 96 302.3 96 320C96 337.7 110.3 352 128 352L288 352L288 512C288 529.7 302.3 544 320 544C337.7 544 352 529.7 352 512L352 352L512 352C529.7 352 544 337.7 544 320C544 302.3 529.7 288 512 288L352 288L352 128z"/></svg> Heading</button>
    <button type="button" class="btn btn-secondary" data-add="list"          style="font-size:11px;"><svg class="icon-inline" width="10" height="10" viewBox="0 0 640 640" aria-hidden="true" xmlns="http://www.w3.org/2000/svg"><path fill="currentColor" d="M352 128C352 110.3 337.7 96 320 96C302.3 96 288 110.3 288 128L288 288L128 288C110.3 288 96 302.3 96 320C96 337.7 110.3 352 128 352L288 352L288 512C288 529.7 302.3 544 320 544C337.7 544 352 529.7 352 512L352 352L512 352C529.7 352 544 337.7 544 320C544 302.3 529.7 288 512 288L352 288L352 128z"/></svg> List</button>
    <button type="button" class="btn btn-secondary" data-add="quote"         style="font-size:11px;"><svg class="icon-inline" width="10" height="10" viewBox="0 0 640 640" aria-hidden="true" xmlns="http://www.w3.org/2000/svg"><path fill="currentColor" d="M352 128C352 110.3 337.7 96 320 96C302.3 96 288 110.3 288 128L288 288L128 288C110.3 288 96 302.3 96 320C96 337.7 110.3 352 128 352L288 352L288 512C288 529.7 302.3 544 320 544C337.7 544 352 529.7 352 512L352 352L512 352C529.7 352 544 337.7 544 320C544 302.3 529.7 288 512 288L352 288L352 128z"/></svg> Quote</button>
    <button type="button" class="btn btn-secondary" data-add="image"         style="font-size:11px;"><svg class="icon-inline" width="10" height="10" viewBox="0 0 640 640" aria-hidden="true" xmlns="http://www.w3.org/2000/svg"><path fill="currentColor" d="M352 128C352 110.3 337.7 96 320 96C302.3 96 288 110.3 288 128L288 288L128 288C110.3 288 96 302.3 96 320C96 337.7 110.3 352 128 352L288 352L288 512C288 529.7 302.3 544 320 544C337.7 544 352 529.7 352 512L352 352L512 352C529.7 352 544 337.7 544 320C544 302.3 529.7 288 512 288L352 288L352 128z"/></svg> Image</button>`;

  container.appendChild(list);
  container.appendChild(toolbar);

  toolbar.addEventListener("click", (e) => {
    const type = e.target.closest("[data-add]")?.dataset.add;
    if (!type) return;
    const el = makeBlockEl({ type });
    list.appendChild(el);
    el.querySelector(".body-block__text")?.focus();
    el.scrollIntoView({ behavior: "smooth", block: "nearest" });
  });

  blocks.forEach((block) => list.appendChild(makeBlockEl(block)));
}

export function readBodyBlocks(containerId) {
  const container = document.getElementById(containerId);
  if (!container) return [];
  const blocks = [];
  container.querySelectorAll(".body-block").forEach((el) => {
    const type    = el.querySelector(".body-block__type")?.value    || "paragraph";
    const text    = el.querySelector(".body-block__text")?.value?.trim()    || "";
    const caption = el.querySelector(".body-block__caption")?.value?.trim() || "";
    const source  = el.querySelector(".body-block__source")?.value?.trim()  || "";
    if (!text) return;
    if (type === "image") {
      const block = { type, url: text };
      if (caption) block.caption = caption;
      if (source)  block.source  = source;
      blocks.push(block);
    } else {
      blocks.push({ type, text });
    }
  });
  return blocks;
}
