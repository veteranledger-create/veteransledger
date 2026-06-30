/**
 * VeteransLedger · Language Switcher
 * Mounts into every `.lang-switcher` placeholder (desktop sidebar + mobile
 * menu). One shared locale state (see pages/shared/i18n.js) keeps every
 * mounted instance in sync — switching in the mobile menu updates the
 * sidebar's trigger too, and vice versa.
 */

import { LANGUAGES, FLAG_SVGS } from "/pages/shared/locale-constants.js";
import { getLocale, setLocale, onLocaleChange } from "/pages/shared/i18n.js";

let uid = 0;

export function initLanguageSwitcher() {
  document.querySelectorAll(".lang-switcher:not([data-mounted])").forEach(mount);
}

function mount(root) {
  root.setAttribute("data-mounted", "1");
  const id = ++uid;
  const menuId = `lang-switch-menu-${id}`;

  const trigger = document.createElement("button");
  trigger.type = "button";
  trigger.className = "lang-switcher__trigger";
  trigger.setAttribute("aria-haspopup", "listbox");
  trigger.setAttribute("aria-expanded", "false");
  trigger.setAttribute("aria-controls", menuId);

  const flagEl = document.createElement("span");
  flagEl.className = "lang-switcher__flag";
  const labelEl = document.createElement("span");
  labelEl.className = "lang-switcher__label";

  trigger.append(flagEl, labelEl);

  const menu = document.createElement("div");
  menu.id = menuId;
  menu.className = "lang-switcher__menu";
  menu.setAttribute("role", "listbox");
  menu.setAttribute("aria-label", "Select language");
  menu.setAttribute("aria-hidden", "true");

  let isOpen = false;
  let focusedIdx = -1;

  function buildMenu() {
    menu.innerHTML = "";
    LANGUAGES.forEach((lang, idx) => {
      const opt = document.createElement("div");
      opt.className = "lang-switcher__opt";
      opt.id = `${menuId}-o${idx}`;
      opt.setAttribute("role", "option");
      opt.dataset.code = lang.code;
      const selected = lang.code === getLocale();
      opt.setAttribute("aria-selected", selected ? "true" : "false");
      if (selected) opt.classList.add("lang-switcher__opt--selected");

      const flag = document.createElement("span");
      flag.className = "lang-switcher__opt-flag";
      flag.innerHTML = FLAG_SVGS[lang.code] || "";

      const name = document.createElement("span");
      name.className = "lang-switcher__opt-name";
      name.textContent = lang.isSource ? `${lang.name} (Original)` : lang.name;

      opt.append(flag, name);
      opt.addEventListener("click", (e) => {
        e.stopPropagation();
        choose(lang.code);
      });
      opt.addEventListener("mousemove", () => {
        const all = getOpts();
        const i = all.indexOf(opt);
        if (i !== focusedIdx) moveFocusTo(i);
      });
      menu.appendChild(opt);
    });
  }

  function getOpts() {
    return Array.from(menu.querySelectorAll(".lang-switcher__opt"));
  }

  function syncTrigger() {
    const code = getLocale();
    const lang = LANGUAGES.find((l) => l.code === code) || LANGUAGES[0];
    flagEl.innerHTML = FLAG_SVGS[code] || "";
    labelEl.textContent = lang.name;
    trigger.setAttribute("aria-label", `Language: ${lang.name}. Activate to change.`);
  }

  function choose(code) {
    setLocale(code);
    close();
    trigger.focus();
  }

  function moveFocusTo(idx) {
    const opts = getOpts();
    if (!opts.length) return;
    idx = Math.max(0, Math.min(idx, opts.length - 1));
    opts.forEach((el, i) => el.classList.toggle("lang-switcher__opt--focused", i === idx));
    focusedIdx = idx;
    trigger.setAttribute("aria-activedescendant", opts[idx]?.id ?? "");
  }

  function moveFocus(dir) {
    const opts = getOpts();
    if (!opts.length) return;
    let next = (focusedIdx + dir + opts.length) % opts.length;
    moveFocusTo(next);
  }

  function open() {
    buildMenu();
    root.classList.add("lang-switcher--open");
    menu.setAttribute("aria-hidden", "false");
    trigger.setAttribute("aria-expanded", "true");
    isOpen = true;
    const idx = LANGUAGES.findIndex((l) => l.code === getLocale());
    moveFocusTo(Math.max(0, idx));
  }

  function close() {
    root.classList.remove("lang-switcher--open");
    menu.setAttribute("aria-hidden", "true");
    trigger.setAttribute("aria-expanded", "false");
    trigger.removeAttribute("aria-activedescendant");
    isOpen = false;
    focusedIdx = -1;
  }

  trigger.addEventListener("click", (e) => {
    e.stopPropagation();
    isOpen ? close() : open();
  });

  trigger.addEventListener("keydown", (e) => {
    switch (e.key) {
      case "Enter":
      case " ":
        e.preventDefault();
        if (!isOpen) { open(); break; }
        { const opts = getOpts(); if (focusedIdx >= 0 && opts[focusedIdx]) choose(opts[focusedIdx].dataset.code); }
        break;
      case "ArrowDown":
        e.preventDefault();
        isOpen ? moveFocus(1) : open();
        break;
      case "ArrowUp":
        e.preventDefault();
        isOpen ? moveFocus(-1) : open();
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

  document.addEventListener("click", (e) => {
    if (isOpen && !root.contains(e.target)) close();
  });

  onLocaleChange(() => {
    syncTrigger();
    if (isOpen) buildMenu();
  });

  root.append(trigger, menu);
  syncTrigger();
}
