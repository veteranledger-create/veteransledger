/**
 * VeteransLedger · Navigation runtime
 * Hydrates the injected shell (header, sidebar, mobile menu, footer) from a
 * single fetch of /public/data/navigation.json. Framework-free, pure DOM.
 *
 * Contracts consumed (defined by the component markup/templates):
 *   [data-nav-mount="brand"]            → brand link + name/tagline
 *   [data-nav-mount="theme-label"]      → current theme label text
 *   [data-nav-source="primary|utility"] → render nav tree (+ data-nav-template)
 *   [data-nav-source="footer-columns"]  → footer columns (ids → links)
 *   [data-nav-source="footer-social"]   → footer social links
 *   [data-nav-action="…"]               → open/close menu, toggle theme/group
 *   [data-bind="attr:field,…"]          → bind node fields (text → textContent)
 *   [data-nav-slot="children|items"]    → where nested rows mount
 *   <template id="tpl-(sidebar|mobile|footer)-…"> → row markup to clone
 */

import { loadTranslation, machineNoticeHtml } from "/pages/shared/translation-loader.js";
import { onLocaleChange } from "/pages/shared/i18n.js";

const CONFIG = {
  dataUrl: "/public/data/navigation.json",
  sidebarPermanentFrom: 1024,
};

function applyConfig(extra) {
  const o = {
    ...((typeof window !== "undefined" && window.VL_NAV_CONFIG) || {}),
    ...(extra || {}),
  };
  if (o.dataUrl) CONFIG.dataUrl = o.dataUrl;
}

/* ---------- single data load ---------- */
let navPromise = null;
function loadNavigationData() {
  if (!navPromise) {
    navPromise = fetch(CONFIG.dataUrl, { credentials: "same-origin" }).then(
      (res) => {
        if (!res.ok) throw new Error(`navigation.json → HTTP ${res.status}`);
        return res.json();
      },
    );
  }
  return navPromise;
}

/* ---------- DOM helpers ---------- */
const qs = (sel, root = document) => root.querySelector(sel);
const qsa = (sel, root = document) => Array.from(root.querySelectorAll(sel));

function cloneTemplate(id) {
  const tpl = document.getElementById(id);
  if (!tpl || !("content" in tpl) || !tpl.content.firstElementChild) {
    console.warn("[nav] missing template:", id);
    return null;
  }
  return tpl.content.firstElementChild.cloneNode(true);
}

/**
 * Apply data-bind directives on/within a scope.
 * Grammar: "targetAttr:sourceField, …" ; "text" sets textContent.
 * null/false/undefined value → attribute omitted (keeps aria-current accurate).
 */
function applyBindings(scope, view) {
  const targets = [];
  if (scope.matches && scope.matches("[data-bind]")) targets.push(scope);
  if (scope.querySelectorAll)
    qsa("[data-bind]", scope).forEach((el) => targets.push(el));
  targets.forEach((el) => {
    el.getAttribute("data-bind")
      .split(",")
      .forEach((pair) => {
        const [attr, field] = pair.split(":").map((s) => s && s.trim());
        if (!attr || !field) return;
        const value = view[field];
        if (value == null || value === false) return;
        if (attr === "text") el.textContent = value;
        else el.setAttribute(attr, value);
      });
    el.removeAttribute("data-bind");
  });
}

/* ---------- active-state from URL ---------- */
let here = { path: "/index.html", hash: "" };

function normalizePath(p) {
  try {
    p = decodeURIComponent(p);
  } catch (_) {}
  if (!p.startsWith("/")) p = "/" + p;
  if (p.endsWith("/")) p += "index.html";
  return p.toLowerCase();
}
function hereLoc() {
  return { path: normalizePath(location.pathname), hash: location.hash || "" };
}
function parseHref(href) {
  const u = new URL(href, location.origin);
  return { path: normalizePath(u.pathname), hash: u.hash || "" };
}
function isCurrentPage(node) {
  return node.href ? parseHref(node.href).path === here.path : false;
}
function isExact(node) {
  if (!node.href) return false;
  const h = parseHref(node.href);
  if (h.path !== here.path) return false;
  return h.hash ? h.hash === here.hash : true;
}
function viewForNode(node) {
  return {
    url: node.href || null,
    label: node.label || "",
    active: isExact(node) ? "page" : null,
    icon: node.icon || null,
  };
}

/* ---------- rendering ---------- */
function tplIds(surface) {
  const base = surface === "mobile" ? "mobile" : "sidebar";
  return {
    item: `tpl-${base}-item`,
    group: `tpl-${base}-group`,
    child: `tpl-${base}-child`,
  };
}

function renderNodes(listEl, nodes, surface, depth) {
  const ids = tplIds(surface);
  (nodes || []).forEach((node) => {
    let li;
    if (node.type === "action") li = renderAction(node, surface);
    else if (node.children && node.children.length)
      li = renderGroup(node, surface, depth, ids);
    else li = renderLeaf(node, surface, depth, ids);
    if (li) listEl.appendChild(li);
  });
}

function renderLeaf(node, surface, depth, ids) {
  const li = cloneTemplate(depth > 0 ? ids.child : ids.item);
  if (!li) return null;
  applyBindings(li, viewForNode(node));
  if (isCurrentPage(node)) li.classList.add("is-current");
  return li;
}

function renderGroup(node, surface, depth, ids) {
  const li = cloneTemplate(ids.group);
  if (!li) return null;
  const panelId = `nav-${surface}-${node.id}`;
  applyBindings(li, { label: node.label, panelId, icon: node.icon || null });
  const btn = li.querySelector("button");
  if (btn) btn.setAttribute("data-nav-action", "toggle-group");
  const sublist = li.querySelector('[data-nav-slot="children"]');
  if (sublist) renderNodes(sublist, node.children, surface, depth + 1);
  const containsCurrent =
    isCurrentPage(node) ||
    (node.children || []).some((c) => isExact(c) || isCurrentPage(c));
  if (btn) setGroupExpanded(btn, containsCurrent);
  if (containsCurrent) li.classList.add("is-current");
  return li;
}

function renderAction(node, surface) {
  const li = document.createElement("li");
  li.className =
    surface === "mobile"
      ? "mobile-menu__item mobile-menu__item--action"
      : "sidebar__item sidebar__item--action";
  const btn = document.createElement("button");
  btn.type = "button";
  btn.className =
    surface === "mobile"
      ? "mobile-menu__link mobile-menu__action"
      : "sidebar__link sidebar__action";
  if (node.action) btn.setAttribute("data-nav-action", node.action);
  if (node.action === "toggle-theme") {
    btn.setAttribute("aria-pressed", "false");
    btn.setAttribute("aria-label", "Toggle dark mode");
    btn.dataset.themeText = "1"; // theme UI fills the label text
  } else {
    btn.textContent = node.label || "";
  }
  li.appendChild(btn);
  return li;
}

function renderSources(data) {
  qsa("[data-nav-source]").forEach((listEl) => {
    const source = listEl.getAttribute("data-nav-source");
    if (source === "primary" || source === "utility") {
      const surface = listEl.getAttribute("data-nav-template") || "sidebar";
      renderNodes(listEl, data[source], surface, 0);
    }
  });
}

function buildIdIndex(data) {
  const map = new Map();
  [...(data.primary || []), ...(data.utility || [])].forEach((n) => {
    if (n.id) map.set(n.id, n);
  });
  return map;
}

function renderFooter(data) {
  if (!data.footer) return;
  const idx = buildIdIndex(data);

  qsa('[data-nav-source="footer-columns"]').forEach((listEl) => {
    (data.footer.columns || []).forEach((col) => {
      const colLi = cloneTemplate("tpl-footer-column");
      if (!colLi) return;
      applyBindings(colLi, { heading: col.heading });
      const links = colLi.querySelector('[data-nav-slot="items"]');
      (col.items || []).forEach((id) => {
        const node = idx.get(id);
        if (!node) {
          console.warn("[nav] footer item id not found:", id);
          return;
        }
        const linkLi = cloneTemplate("tpl-footer-link");
        if (!linkLi) return;
        applyBindings(linkLi, { url: node.href, label: node.label });
        if (links) links.appendChild(linkLi);
      });
      listEl.appendChild(colLi);
    });
  });

  qsa('[data-nav-source="footer-social"]').forEach((listEl) => {
    (data.footer.social || []).forEach((s) => {
      const li = cloneTemplate("tpl-footer-social");
      if (!li) return;
      applyBindings(li, { url: s.href, label: s.label, icon: s.icon });
      listEl.appendChild(li);
    });
  });

  // Render archive stats list when data is present, replacing the fallback
  // hardcoded <li> items that serve as a no-JS baseline.
  if (Array.isArray(data.footer.stats) && data.footer.stats.length) {
    qsa('[data-nav-source="footer-stats"]').forEach((listEl) => {
      listEl.innerHTML = "";
      data.footer.stats.forEach((s) => {
        const li = document.createElement("li");
        const span = document.createElement("span");
        span.textContent = (s.label ?? "") + ":";
        li.appendChild(span);
        li.appendChild(document.createTextNode(" " + (s.value ?? "")));
        listEl.appendChild(li);
      });
    });
  }

  // Render footer legal links when data is present
  if (Array.isArray(data.footer.legalLinks) && data.footer.legalLinks.length) {
    qsa('[data-nav-source="footer-legal-links"]').forEach((listEl) => {
      listEl.innerHTML = "";
      data.footer.legalLinks.forEach((link) => {
        const li = document.createElement("li");
        const a = document.createElement("a");
        const href = String(link.href ?? "");
        a.href = /^https?:\/\//.test(href) || href.startsWith("/") || href.startsWith("#") ? href : "#";
        a.textContent = link.label ?? "";
        li.appendChild(a);
        listEl.appendChild(li);
      });
    });
  }

  // Render archive info list (bottom band)
  if (data.footer.archiveInfo?.items?.length) {
    qsa('[data-nav-source="footer-archive-info"]').forEach((listEl) => {
      listEl.innerHTML = "";
      data.footer.archiveInfo.items.forEach((item) => {
        const li = document.createElement("li");
        const span = document.createElement("span");
        span.textContent = (item.label ?? "") + ":";
        li.appendChild(span);
        li.appendChild(document.createTextNode(" " + (item.value ?? "")));
        listEl.appendChild(li);
      });
    });
  }

  const connect = data.footer.connect ?? {};
  const footer = qs(".site-footer");
  if (footer)
    applyBindings(footer, {
      legalLine:          data.footer.legalLine,
      copyright:          data.footer.copyright,
      aboutText:          data.footer.aboutText,
      signature:          data.footer.signature,
      educationalBadge:   data.footer.educationalBadge,
      statsHeading:       data.footer.statsHeading,
      quickLinksHeading:  data.footer.quickLinksHeading,
      archiveInfoHeading: data.footer.archiveInfo?.heading,
      legalHeading:       data.footer.legalHeading,
      connectHeading:     connect.heading,
      connectPrompt:      connect.prompt,
      connectEmail:       connect.email,
      connectEmailHref:   connect.email ? `mailto:${connect.email}` : undefined,
    });
}

function bindBrand(data) {
  if (!data.brand) return;
  qsa('[data-nav-mount="brand"]').forEach((el) => {
    if (el.tagName === "A") el.setAttribute("href", data.brand.href || "#");
    // If the element itself has data-bind, apply directly; otherwise bind children
    applyBindings(el, { name: data.brand.name, tagline: data.brand.tagline });
  });
}

/* ---------- theme ---------- */
let THEME_LABELS = { light: "LIGHT", dark: "DARK" };

function currentTheme() {
  return document.documentElement.getAttribute("data-theme") === "dark"
    ? "dark"
    : "light";
}
function updateThemeUI() {
  const theme = currentTheme();
  const label = THEME_LABELS[theme] || theme.toUpperCase();
  const pressed = theme === "dark" ? "true" : "false";
  qsa('[data-nav-mount="theme-label"]').forEach((el) => {
    el.textContent = label;
  });
  qsa('[data-nav-action="toggle-theme"]').forEach((btn) => {
    btn.setAttribute("aria-pressed", pressed);
    if (btn.dataset.themeText === "1") btn.textContent = label;
  });
}
function toggleTheme() {
  const next = currentTheme() === "dark" ? "light" : "dark";
  if (next === "dark")
    document.documentElement.setAttribute("data-theme", "dark");
  else document.documentElement.removeAttribute("data-theme");
  try {
    localStorage.setItem("theme", next);
  } catch (_) {}
  updateThemeUI();
}
function initTheme(data) {
  const themeNode = (data.utility || []).find(
    (n) => n.action === "toggle-theme",
  );
  if (themeNode && themeNode.labels) THEME_LABELS = themeNode.labels;
  let saved = null;
  try {
    saved = localStorage.getItem("theme");
  } catch (_) {}
  if (saved === "dark")
    document.documentElement.setAttribute("data-theme", "dark");
  else if (saved === "light")
    document.documentElement.removeAttribute("data-theme");
  updateThemeUI();
}

/* ---------- disclosure groups ---------- */
function setGroupExpanded(btn, expanded) {
  btn.setAttribute("aria-expanded", String(!!expanded));
  const id = btn.getAttribute("aria-controls");
  const panel = id ? document.getElementById(id) : null;
  if (panel) panel.hidden = !expanded;
  const li = btn.closest("li");
  if (li) li.classList.toggle("is-open", !!expanded);
}
function toggleGroup(btn) {
  const expanded = btn.getAttribute("aria-expanded") === "true";
  setGroupExpanded(btn, !expanded);
  // Mobile menu behaves as a single-open accordion at each level.
  if (!expanded && btn.closest(".mobile-menu__panel")) {
    const li = btn.closest("li");
    const parent = li && li.parentElement;
    const siblings = parent
      ? qsa(":scope > li > button[aria-expanded='true']", parent)
      : [];
    siblings.forEach((other) => {
      if (other !== btn) setGroupExpanded(other, false);
    });
  }
}

/* ---------- mobile menu + focus trap ---------- */
const panelEl = () => document.getElementById("mobile-menu");
const scrimEl = () => qs(".mobile-menu__scrim");
const openTgl = () => qs('[data-nav-action="open-mobile-menu"]');
let lastFocused = null;

function isMenuOpen() {
  const p = panelEl();
  return !!p && !p.hidden;
}

function openMobileMenu() {
  const panel = panelEl();
  if (!panel) return;
  lastFocused = document.activeElement;
  panel.hidden = false;
  const scrim = scrimEl();
  if (scrim) scrim.hidden = false;
  document.body.classList.add("nav-menu-open");
  const t = openTgl();
  if (t) t.setAttribute("aria-expanded", "true");
  focusFirst(panel);
  document.addEventListener("keydown", onMenuKeydown, true);
}
function closeMobileMenu() {
  const panel = panelEl();
  if (!panel || panel.hidden) return;
  panel.hidden = true;
  const scrim = scrimEl();
  if (scrim) scrim.hidden = true;
  document.body.classList.remove("nav-menu-open");
  const t = openTgl();
  if (t) t.setAttribute("aria-expanded", "false");
  document.removeEventListener("keydown", onMenuKeydown, true);
  if (lastFocused && typeof lastFocused.focus === "function")
    lastFocused.focus();
}
function onMenuKeydown(e) {
  if (e.key === "Escape") {
    e.preventDefault();
    closeMobileMenu();
  } else if (e.key === "Tab") trapFocus(e);
}
function getFocusable(container) {
  return qsa(
    'a[href], button:not([disabled]), input, select, textarea, [tabindex]:not([tabindex="-1"])',
    container,
  ).filter(
    (el) => el.offsetWidth || el.offsetHeight || el === document.activeElement,
  );
}
function focusFirst(container) {
  const f = getFocusable(container);
  if (f[0]) f[0].focus({ preventScroll: true });
}
function trapFocus(e) {
  const panel = panelEl();
  if (!panel) return;
  const f = getFocusable(panel);
  if (!f.length) return;
  const first = f[0],
    last = f[f.length - 1];
  if (e.shiftKey && document.activeElement === first) {
    e.preventDefault();
    last.focus();
  } else if (!e.shiftKey && document.activeElement === last) {
    e.preventDefault();
    first.focus();
  }
}

/* ---------- interaction wiring (once) ---------- */
let wired = false;
function initInteractions(data) {
  if (wired) return;
  wired = true;

  document.addEventListener("click", (e) => {
    const trigger = e.target.closest("[data-nav-action]");
    if (!trigger) return;
    switch (trigger.getAttribute("data-nav-action")) {
      case "open-mobile-menu":
        e.preventDefault();
        isMenuOpen() ? closeMobileMenu() : openMobileMenu();
        break;
      case "close-mobile-menu":
        e.preventDefault();
        closeMobileMenu();
        break;
      case "toggle-theme":
        e.preventDefault();
        toggleTheme();
        break;
      case "toggle-group":
        e.preventDefault();
        toggleGroup(trigger);
        break;
    }
  });

  // Close the menu after following a link inside it (allows the navigation).
  document.addEventListener("click", (e) => {
    if (isMenuOpen() && e.target.closest("#mobile-menu a[href]"))
      closeMobileMenu();
  });

  // Auto-close when the viewport reaches the permanent-sidebar breakpoint.
  const bp =
    (data.settings && data.settings.sidebarPermanentFrom) ||
    CONFIG.sidebarPermanentFrom;
  const mq = window.matchMedia(`(min-width: ${bp}px)`);
  const onChange = (ev) => {
    if (ev.matches) closeMobileMenu();
  };
  if (mq.addEventListener) mq.addEventListener("change", onChange);
  else if (mq.addListener) mq.addListener(onChange);
}

// site_content translations store the whole source file as one
// re-translated JSON string — fetch and parse it once, reused by both the
// initial render and any later locale-change re-render.
async function resolveNavData(englishData) {
  const t = await loadTranslation("site_content", "navigation.json");
  if (t?.fields?.content) {
    try { return { data: JSON.parse(t.fields.content), isMachine: t.isMachine }; }
    catch { /* translated content isn't valid JSON — keep English */ }
  }
  return { data: englishData, isMachine: false };
}

// Scoped to elements immediately after the brand link only — other scripts
// (home.js, page-content.js) manage their own notices elsewhere on the page
// and must not be affected by a global ".vl-mt-notice" removal here.
function renderNoticeNearBrand(isMachine) {
  document.querySelectorAll(".sidebar__brand, .site-header__brand").forEach((brandEl) => {
    if (brandEl.nextElementSibling?.classList.contains("vl-mt-notice")) {
      brandEl.nextElementSibling.remove();
    }
    if (isMachine) {
      brandEl.insertAdjacentHTML("afterend", machineNoticeHtml({ isMachine: true }));
    }
  });
}

/* ---------- public entry ---------- */
export async function initNavigation(extraConfig) {
  applyConfig(extraConfig);
  let englishData;
  try {
    englishData = await loadNavigationData();
  } catch (err) {
    console.error("[nav] Could not load navigation data:", err);
    return;
  }

  const { data, isMachine } = await resolveNavData(englishData);

  here = hereLoc();
  bindBrand(data);
  renderSources(data); // builds menus first so theme buttons exist
  renderFooter(data);
  renderNoticeNearBrand(isMachine);
  initTheme(data);
  initInteractions(data);

  // Re-render text content on locale switch. initTheme/initInteractions are
  // NOT re-run — they wire one-time, delegated (document-level) listeners
  // guarded by `wired`, so re-binding brand/nav/footer text is safe and
  // doesn't orphan any handlers.
  onLocaleChange(async () => {
    const { data: newData, isMachine: newIsMachine } = await resolveNavData(englishData);
    bindBrand(newData);
    renderSources(newData);
    renderFooter(newData);
    renderNoticeNearBrand(newIsMachine);
  });
}

export { loadNavigationData };
