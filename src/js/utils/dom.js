/**
 * DOM UTILITY MODULE
 * Safe DOM manipulation helpers
 */

/**
 * Create an HTML element with attributes and children.
 * @param {string} tag - HTML tag name
 * @param {Object} [attrs] - Attribute key-value pairs
 * @param {string|HTMLElement|Array} [children] - Content or child elements
 * @returns {HTMLElement}
 */
export function createElement(tag, attrs = {}, children) {
  const el = document.createElement(tag);

  for (const [key, value] of Object.entries(attrs)) {
    if (key === "className") {
      el.className = value;
    } else if (key === "dataset") {
      Object.assign(el.dataset, value);
    } else if (key.startsWith("on")) {
      el.addEventListener(key.slice(2).toLowerCase(), value);
    } else if (key === "style" && typeof value === "object") {
      Object.assign(el.style, value);
    } else {
      el.setAttribute(key, value);
    }
  }

  if (children !== undefined && children !== null) {
    if (typeof children === "string") {
      el.textContent = children;
    } else if (children instanceof HTMLElement) {
      el.appendChild(children);
    } else if (Array.isArray(children)) {
      children.forEach((child) => {
        if (child instanceof HTMLElement) {
          el.appendChild(child);
        } else if (typeof child === "string") {
          el.appendChild(document.createTextNode(child));
        }
      });
    }
  }

  return el;
}

/**
 * Safely get a DOM element by selector.
 * @param {string} selector - CSS selector
 * @param {HTMLElement} [parent] - Parent element
 * @returns {HTMLElement|null}
 */
export function getEl(selector, parent = document) {
  try {
    return parent.querySelector(selector);
  } catch {
    return null;
  }
}

/**
 * Safely get multiple DOM elements by selector.
 * @param {string} selector - CSS selector
 * @param {HTMLElement} [parent] - Parent element
 * @returns {HTMLElement[]}
 */
export function getEls(selector, parent = document) {
  try {
    return Array.from(parent.querySelectorAll(selector));
  } catch {
    return [];
  }
}

/**
 * Show a container and hide another (optional).
 * @param {HTMLElement} showEl - Element to show
 * @param {HTMLElement} [hideEl] - Element to hide
 */
export function show(showEl, hideEl) {
  if (showEl) showEl.style.display = "";
  if (hideEl) hideEl.style.display = "none";
}

/**
 * Hide an element.
 * @param {HTMLElement} el
 */
export function hide(el) {
  if (el) el.style.display = "none";
}

/**
 * Clear all children of an element.
 * @param {HTMLElement} el
 */
export function clearChildren(el) {
  if (el) {
    while (el.firstChild) {
      el.removeChild(el.firstChild);
    }
  }
}

/**
 * Insert HTML string into an element.
 * @param {HTMLElement} el - Target element
 * @param {string} html - HTML string
 * @param {'beforeend'|'afterbegin'|'beforebegin'|'afterend'} position
 */
export function insertHTML(el, html, position = "beforeend") {
  if (el) {
    el.insertAdjacentHTML(position, html);
  }
}

/**
 * Debounce a function call.
 * @param {Function} fn - Function to debounce
 * @param {number} delay - Delay in ms
 * @returns {Function}
 */
export function debounce(fn, delay = 200) {
  let timer;
  return function (...args) {
    clearTimeout(timer);
    timer = setTimeout(() => fn.apply(this, args), delay);
  };
}

/**
 * Escape HTML special characters in a string.
 * @param {string} str
 * @returns {string}
 */
export function escapeHTML(str) {
  if (!str) return "";
  const div = document.createElement("div");
  div.textContent = str;
  return div.innerHTML;
}

/**
 * Truncate text to a maximum length.
 * @param {string} text
 * @param {number} maxLength
 * @returns {string}
 */
export function truncate(text, maxLength = 200) {
  if (!text || text.length <= maxLength) return text || "";
  return text.substring(0, maxLength).trim() + "…";
}
