/**
 * FORMAT UTILITY MODULE
 * Text and data formatting helpers.
 */

/**
 * Format a date string for display.
 * @param {string} dateStr - Raw date string
 * @returns {string}
 */
export function formatDate(dateStr) {
  if (!dateStr) return "";
  // Dates are already in display format in the data
  return dateStr;
}

/**
 * Format lifespan display.
 * @param {string} life - e.g., "1891-1944"
 * @returns {string}
 */
export function formatLifespan(life) {
  if (!life) return "";
  return life;
}

/**
 * Format battle year for display.
 * @param {string|number} year
 * @returns {string}
 */
export function formatYear(year) {
  if (!year) return "";
  return String(year);
}

/**
 * Convert a branch code to a display label.
 * @param {string} branch - e.g., 'army', 'luftwaffe', 'kriegsmarine'
 * @returns {string}
 */
export function branchLabel(branch) {
  const labels = {
    army: "German Army (Heer)",
    luftwaffe: "Luftwaffe",
    kriegsmarine: "Kriegsmarine",
    "waffen-ss": "Waffen-SS",
    airforce: "Luftwaffe",
    other: "Other",
  };
  return labels[branch] || branch || "Unknown";
}

/**
 * Convert a branch code to a CSS class suffix.
 * @param {string} branch
 * @returns {string}
 */
export function branchClass(branch) {
  const map = {
    army: "army",
    luftwaffe: "luftwaffe",
    kriegsmarine: "kriegsmarine",
    "waffen-ss": "waffen-ss",
    airforce: "luftwaffe",
    other: "other",
  };
  return map[branch] || "other";
}

/**
 * Convert newlines to <br> tags.
 * @param {string} text
 * @returns {string}
 */
export function nl2br(text) {
  if (!text) return "";
  return text.replace(/\n/g, "<br>");
}

/**
 * Format a number with commas.
 * @param {number} num
 * @returns {string}
 */
export function formatNumber(num) {
  if (num === undefined || num === null) return "";
  return num.toLocaleString();
}

/**
 * Create a slug from a string.
 * @param {string} str
 * @returns {string}
 */
export function slugify(str) {
  if (!str) return "";
  return str
    .toLowerCase()
    .replace(/[^\w\s-]/g, "")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .trim();
}
