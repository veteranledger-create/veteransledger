/**
 * AdminSelect — cross-browser custom dropdown enhancing native <select> elements.
 *
 * Usage:
 *   import { initAdminSelects } from "./admin-select.js";
 *   initAdminSelects();              // enhance all selects on the page
 *   initAdminSelects(formPanelEl);   // enhance selects inside a specific container
 *
 * The native <select> remains in DOM (visually hidden) so form submission
 * and constraint validation continue to work unchanged.
 *
 * Features:
 *  - CSS animation: fade + slide on open/close, chevron rotation
 *  - Full ARIA: aria-haspopup, aria-expanded, aria-controls, aria-activedescendant,
 *               aria-selected, aria-disabled, aria-hidden on menu
 *  - Keyboard: Arrow keys, Enter/Space, Escape, Home/End, Tab-to-close
 *  - Viewport flip: opens upward automatically when insufficient space below
 *  - Long options: ellipsis truncation + title tooltip for full text
 *  - Dynamic options: MutationObserver keeps label in sync
 *  - Programmatic value/selectedIndex writes sync the label synchronously
 *  - Label[for] association: clicking a linked <label> focuses the trigger
 */

const SELECTOR = "select.contact-form__input:not(.a-select__native), select.input:not(.a-select__native)";
let _uid = 0;
let _globalObserverActive = false;

export function initAdminSelects(root = document) {
  root.querySelectorAll(SELECTOR).forEach(enhanceSelect);

  // Global auto-enhancement: watches for selects added to the DOM after page load
  // (e.g. body-editor block type selects, dynamically rendered form rows).
  // Guard ensures this observer is set up exactly once per page.
  if (root === document && !_globalObserverActive) {
    _globalObserverActive = true;
    new MutationObserver((muts) => {
      for (const m of muts) {
        for (const node of m.addedNodes) {
          if (node.nodeType !== 1) continue;
          if (node.matches?.(SELECTOR)) enhanceSelect(node);
          node.querySelectorAll?.(SELECTOR).forEach(enhanceSelect);
        }
      }
    }).observe(document.body, { childList: true, subtree: true });
  }
}

export function enhanceSelect(native) {
  if (native.closest(".a-select")) return;

  const uid = ++_uid;
  const menuId    = `asel-menu-${uid}`;
  const triggerId = `asel-trig-${uid}`;

  // ── Wrapper ───────────────────────────────────────────────────
  const wrapper = document.createElement("div");
  wrapper.className = "a-select";

  const s = native.style;
  if (s.width)    wrapper.style.width    = s.width;
  if (s.maxWidth) wrapper.style.maxWidth = s.maxWidth;
  if (s.minWidth) wrapper.style.minWidth = s.minWidth;
  if (s.flex)     wrapper.style.flex     = s.flex;

  // ── Trigger ───────────────────────────────────────────────────
  const trigger = document.createElement("button");
  trigger.type = "button";
  trigger.id   = triggerId;
  trigger.className = "a-select__trigger";
  trigger.setAttribute("aria-haspopup", "listbox");
  trigger.setAttribute("aria-expanded", "false");
  trigger.setAttribute("aria-controls", menuId);
  if (native.disabled) trigger.disabled = true;

  // Wire any existing <label for="nativeId"> to focus the trigger instead
  if (native.id) {
    const assocLabel = document.querySelector(`label[for="${native.id}"]`);
    if (assocLabel) {
      if (!assocLabel.id) assocLabel.id = `asel-lbl-${uid}`;
      trigger.setAttribute("aria-labelledby", assocLabel.id);
      assocLabel.addEventListener("click", (e) => {
        e.preventDefault();
        trigger.focus();
      });
    }
  }

  const visLabel = document.createElement("span");
  visLabel.className = "a-select__label";
  visLabel.setAttribute("aria-hidden", "true");

  const chevron = document.createElement("span");
  chevron.className = "a-select__chevron";
  chevron.setAttribute("aria-hidden", "true");
  chevron.innerHTML =
    `<svg width="10" height="6" viewBox="0 0 10 6" fill="none" xmlns="http://www.w3.org/2000/svg">` +
    `<path d="M1 1l4 4 4-4" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>` +
    `</svg>`;

  trigger.append(visLabel, chevron);

  // ── Menu ──────────────────────────────────────────────────────
  const menu = document.createElement("div");
  menu.id = menuId;
  menu.className = "a-select__menu";
  menu.setAttribute("role", "listbox");
  menu.setAttribute("aria-hidden", "true");

  let focusedIdx = -1;
  let isOpen = false;

  // ── Helpers ───────────────────────────────────────────────────
  function getOpts() {
    return Array.from(menu.querySelectorAll(".a-select__opt"));
  }

  function syncLabel() {
    const sel = native.options[native.selectedIndex];
    if (!sel) { visLabel.textContent = ""; return; }
    visLabel.textContent = sel.text;
    // Accessible name for screen readers (trigger reads selected value aloud)
    trigger.setAttribute("aria-label", sel.text);
    visLabel.dataset.placeholder = sel.value === "" ? "true" : "";
  }

  function buildMenu() {
    menu.innerHTML = "";
    Array.from(native.options).forEach((opt, idx) => {
      const item = document.createElement("div");
      item.id = `${menuId}-o${idx}`;
      item.className = "a-select__opt";
      item.setAttribute("role", "option");
      item.dataset.idx = String(idx);
      item.dataset.value = opt.value;
      item.textContent = opt.text;
      item.title = opt.text;         // tooltip for truncated long names
      const disabled = opt.disabled || (opt.value === "" && idx === 0);
      if (disabled) item.setAttribute("aria-disabled", "true");
      item.setAttribute("aria-selected", opt.selected ? "true" : "false");
      if (opt.selected) item.classList.add("a-select__opt--selected");

      item.addEventListener("click", (e) => {
        e.stopPropagation();
        if (item.getAttribute("aria-disabled") === "true") return;
        pickIdx(idx);
        close();
        trigger.focus();
      });

      // Mouse hover syncs visual focus indicator with keyboard state
      item.addEventListener("mousemove", () => {
        if (item.getAttribute("aria-disabled") === "true") return;
        const all = getOpts();
        const i = all.indexOf(item);
        if (i !== focusedIdx) moveFocusTo(i);
      });

      menu.appendChild(item);
    });
    syncLabel();
  }

  function pickIdx(idx) {
    native.selectedIndex = idx;
    const opts = getOpts();
    opts.forEach((el, i) => {
      const sel = i === idx;
      el.classList.toggle("a-select__opt--selected", sel);
      el.setAttribute("aria-selected", sel ? "true" : "false");
    });
    syncLabel();
    native.dispatchEvent(new Event("change", { bubbles: true }));
  }

  function moveFocusTo(idx) {
    const opts = getOpts();
    if (!opts.length) return;
    idx = Math.max(0, Math.min(idx, opts.length - 1));
    opts.forEach((el, i) => el.classList.toggle("a-select__opt--focused", i === idx));
    focusedIdx = idx;
    opts[idx]?.scrollIntoView({ block: "nearest" });
    // aria-activedescendant keeps screen readers informed of keyboard position
    trigger.setAttribute("aria-activedescendant", opts[idx]?.id ?? "");
  }

  function moveFocus(dir) {
    const opts = getOpts();
    if (!opts.length) return;
    let next = focusedIdx + dir;
    if (next < 0) next = opts.length - 1;
    if (next >= opts.length) next = 0;
    let guard = opts.length;
    while (opts[next]?.getAttribute("aria-disabled") === "true" && guard-- > 0) {
      next = (next + dir + opts.length) % opts.length;
    }
    moveFocusTo(next);
  }

  function positionMenu() {
    const rect = trigger.getBoundingClientRect();
    const spaceBelow = window.innerHeight - rect.bottom;
    const spaceAbove = rect.top;
    const MENU_H = 220;

    if (spaceBelow < MENU_H && spaceAbove > spaceBelow) {
      wrapper.classList.add("a-select--flip");
    } else {
      wrapper.classList.remove("a-select--flip");
    }

    // Constrain horizontal width to viewport edges in case wrapper is near an edge
    const wRect = wrapper.getBoundingClientRect();
    const overflow = wRect.right - window.innerWidth + 8;
    menu.style.left  = overflow > 0 ? `-${overflow}px` : "";
    menu.style.right = overflow > 0 ? "auto" : "";
  }

  function open() {
    buildMenu();
    positionMenu();
    wrapper.classList.add("a-select--open");
    menu.setAttribute("aria-hidden", "false");
    trigger.setAttribute("aria-expanded", "true");
    isOpen = true;
    focusedIdx = Math.max(0, native.selectedIndex);
    moveFocusTo(focusedIdx);
  }

  function close() {
    wrapper.classList.remove("a-select--open");
    menu.setAttribute("aria-hidden", "true");
    trigger.setAttribute("aria-expanded", "false");
    trigger.removeAttribute("aria-activedescendant");
    isOpen = false;
    focusedIdx = -1;
  }

  // ── Trigger keyboard ──────────────────────────────────────────
  trigger.addEventListener("keydown", (e) => {
    switch (e.key) {
      case "Enter":
      case " ":
        e.preventDefault();
        if (!isOpen) {
          open();
        } else {
          const opts = getOpts();
          if (focusedIdx >= 0 && opts[focusedIdx]?.getAttribute("aria-disabled") !== "true") {
            pickIdx(+opts[focusedIdx].dataset.idx);
          }
          close();
        }
        break;
      case "ArrowDown":
        e.preventDefault();
        !isOpen ? open() : moveFocus(1);
        break;
      case "ArrowUp":
        e.preventDefault();
        !isOpen ? open() : moveFocus(-1);
        break;
      case "Escape":
        if (isOpen) { e.stopPropagation(); close(); }
        break;
      case "Home":
        if (isOpen) { e.preventDefault(); moveFocusTo(0); }
        break;
      case "End":
        if (isOpen) { e.preventDefault(); moveFocusTo(getOpts().length - 1); }
        break;
      case "Tab":
        if (isOpen) close();
        break;
    }
  });

  trigger.addEventListener("click", (e) => {
    e.stopPropagation();
    isOpen ? close() : open();
  });

  // ── Outside click ─────────────────────────────────────────────
  document.addEventListener("click", (e) => {
    if (isOpen && !wrapper.contains(e.target)) close();
  });

  // ── Reposition on window resize ───────────────────────────────
  window.addEventListener("resize", () => {
    if (isOpen) positionMenu();
  }, { passive: true });

  // ── Form reset ────────────────────────────────────────────────
  native.closest("form")?.addEventListener("reset", () => syncLabel());

  // ── Dynamic option changes (populated via JS after page load) ─
  new MutationObserver(() => syncLabel())
    .observe(native, { childList: true, subtree: true });

  // ── Intercept programmatic .value / .selectedIndex writes ─────
  const proto  = HTMLSelectElement.prototype;
  const valD   = Object.getOwnPropertyDescriptor(proto, "value");
  const siD    = Object.getOwnPropertyDescriptor(proto, "selectedIndex");

  Object.defineProperty(native, "value", {
    get() { return valD.get.call(this); },
    set(v) { valD.set.call(this, v); syncLabel(); },
    configurable: true,
  });
  Object.defineProperty(native, "selectedIndex", {
    get() { return siD.get.call(this); },
    set(v) { siD.set.call(this, v); syncLabel(); },
    configurable: true,
  });

  // ── Assemble ───────────────────────────────────────────────────
  native.classList.add("a-select__native");
  native.parentNode.insertBefore(wrapper, native);
  wrapper.append(trigger, menu, native);

  syncLabel();
}
