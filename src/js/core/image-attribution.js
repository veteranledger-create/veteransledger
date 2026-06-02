/**
 * IMAGE ATTRIBUTION MODULE
 * Generates structured attribution from image metadata.
 *
 * Supports:
 * - Public Domain
 * - CC BY
 * - CC BY-SA
 * - Bundesarchiv references
 * - Wikimedia Commons references
 * - AI-generated/restored image labeling
 *
 * Usage:
 *   import { renderAttribution } from '@core/image-attribution';
 *   const attrHTML = renderAttribution(imageData);
 */

/**
 * Parse an imageCredit string into structured attribution data.
 * @param {string} credit - The raw credit string
 * @param {Object} [legal] - Optional legal metadata object
 * @returns {Object} Structured attribution { source, license, url, note }
 */
export function parseAttribution(credit, legal) {
  const result = {
    source: "",
    license: "",
    url: "",
    note: "",
    isArchival: false,
    isAIRestoration: false,
    isAIIllustration: false,
  };

  if (!credit) return result;

  // Check for structured legal object first
  if (legal) {
    if (legal.source) result.source = legal.source;
    if (legal.license) result.license = legal.license;
    if (legal.verificationDate) result.note = `Verified: ${legal.verificationDate}`;
  }

  // Parse credit string
  const lower = credit.toLowerCase();

  // Detect license type
  if (lower.includes("public domain")) {
    result.license = result.license || "Public Domain";
  } else if (lower.includes("cc-by-sa")) {
    result.license = result.license || "CC BY-SA";
  } else if (lower.includes("cc-by")) {
    result.license = result.license || "CC BY";
  }

  // Detect source
  if (lower.includes("bundesarchiv")) {
    result.source = result.source || "Bundesarchiv";
  } else if (lower.includes("wikimedia")) {
    result.source = result.source || "Wikimedia Commons";
  } else if (lower.includes("imperial war museum") || lower.includes("iwm")) {
    result.source = result.source || "Imperial War Museum";
  } else if (lower.includes("nara") || lower.includes("national archives")) {
    result.source = result.source || "National Archives (NARA)";
  }

  // Extract license URL if present
  const urlMatch = credit.match(/https?:\/\/[^\s,;]+/);
  if (urlMatch) {
    result.url = urlMatch[0];
  }

  // Detect AI labels
  if (lower.includes("ai-illustration") || lower.includes("ai illustration")) {
    result.isAIIllustration = true;
  } else if (lower.includes("ai-restoration") || lower.includes("ai restoration")) {
    result.isAIRestoration = true;
  }

  if (lower.includes("archival")) {
    result.isArchival = true;
  }

  return result;
}

/**
 * Render attribution HTML from image metadata.
 * @param {string|Object} imageCredit - Credit string or image metadata object
 * @param {Object} [legal] - Legal metadata (if separate)
 * @returns {string} HTML string
 */
export function renderAttribution(imageCredit, legal) {
  const creditStr =
    typeof imageCredit === "string"
      ? imageCredit
      : imageCredit?.imageCredit || "";

  const legalObj =
    legal || (typeof imageCredit === "object" ? imageCredit?.legal : null);

  const attr = parseAttribution(creditStr, legalObj);

  // Build compact attribution string
  const parts = [];

  if (attr.source) parts.push(attr.source);
  if (attr.license) parts.push(attr.license);

  // AI labels
  if (attr.isAIIllustration) parts.push("AI-illustration");
  if (attr.isAIRestoration) parts.push("AI-restoration");

  const compact = parts.join(" · ");

  // Full attribution with link
  let html = `<div class="attribution" data-license="${attr.license}">`;
  if (compact) {
    html += `<span class="attribution-compact">${compact}</span>`;
  }
  if (attr.url) {
    html += ` <a href="${attr.url}" target="_blank" rel="noopener noreferrer" class="attribution-link">ⓘ</a>`;
  }
  if (attr.note) {
    html += `<span class="attribution-note">${attr.note}</span>`;
  }
  html += `</div>`;

  return html;
}

/**
 * Validate that an image entry has sufficient attribution.
 * @param {Object} entry - Data entry with image info
 * @returns {{ valid: boolean, warnings: string[] }}
 */
export function validateAttribution(entry) {
  const warnings = [];
  if (!entry.image && !entry.imageCredit) {
    warnings.push(`No image or credit found`);
    return { valid: false, warnings };
  }
  if (!entry.imageCredit && !entry.legal) {
    warnings.push(`Missing attribution for: ${entry.image || entry.id}`);
    return { valid: false, warnings };
  }
  return { valid: true, warnings };
}
