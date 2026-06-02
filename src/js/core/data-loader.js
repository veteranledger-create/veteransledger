/**
 * DATA LOADER MODULE
 * Unified data loading with error handling, caching, and fallback support.
 *
 * Features:
 * - Lazy loading with caching
 * - JSON-first loading (strict JSON files)
 * - JS file fallback (legacy .js data files)
 * - Error handling with silent degradation
 * - Schema validation support
 * - Required field validation
 */

import { DATA_SOURCES } from "@core/config";

/**
 * Internal cache for loaded datasets
 * @type {Map<string, Array|Object>}
 */
const cache = new Map();

/**
 * Load a dataset by its key (matching DATA_SOURCES config).
 * Attempts JSON first, falls back to JS file, then inline script tag.
 *
 * @param {string} key - The dataset key (e.g., 'veterans', 'battles')
 * @returns {Promise<Array|Object>} The loaded data
 */
export async function loadData(key) {
  // Return cached data if available
  if (cache.has(key)) {
    return cache.get(key);
  }

  const source = DATA_SOURCES[key];
  if (!source) {
    console.warn(`[DataLoader] Unknown dataset key: "${key}"`);
    return [];
  }

  // Strategy 1: Check for inline script tag with data
  const inlineData = tryGetInlineData(key, source.variableName);
  if (inlineData) {
    cache.set(key, inlineData);
    return inlineData;
  }

  // Strategy 2: Try loading from JSON file
  try {
    const jsonData = await loadJSON(source.jsonPath);
    cache.set(key, jsonData);
    return jsonData;
  } catch (jsonError) {
    console.warn(
      `[DataLoader] JSON load failed for "${key}": ${jsonError.message}`
    );
  }

  // Strategy 3: Fallback to legacy .js file
  try {
    const jsData = await loadLegacyJS(source.jsPath, source.variableName);
    cache.set(key, jsData);
    return jsData;
  } catch (jsError) {
    console.warn(
      `[DataLoader] JS fallback failed for "${key}": ${jsError.message}`
    );
  }

  // All strategies failed
  console.error(`[DataLoader] Failed to load dataset: "${key}"`);
  const empty = Array.isArray(getDefaultFor(key)) ? [] : {};
  cache.set(key, empty);
  return empty;
}

/**
 * Try to get data from inline script tag.
 * @param {string} key - Dataset key
 * @param {string} variableName - Expected global variable name
 * @returns {Array|Object|null}
 */
function tryGetInlineData(key, variableName) {
  try {
    const script = document.getElementById(`${key}-data`);
    if (script && window[variableName]) {
      return window[variableName];
    }
  } catch (e) {
    // Silently fail
  }
  return null;
}

/**
 * Fetch and parse a JSON file.
 * @param {string} path - Path to JSON file
 * @returns {Promise<Array|Object>}
 */
async function loadJSON(path) {
  const response = await fetch(path);
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}: ${path}`);
  }
  const text = await response.text();
  try {
    const data = JSON.parse(text);
    return data;
  } catch (e) {
    throw new Error(`Invalid JSON: ${path} - ${e.message}`);
  }
}

/**
 * Load data from legacy .js file using Function constructor.
 * @param {string} path - Path to .js file
 * @param {string} variableName - Variable name to extract
 * @returns {Promise<Array|Object>}
 */
async function loadLegacyJS(path, variableName) {
  const response = await fetch(path);
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}: ${path}`);
  }
  const text = await response.text();
  try {
    const fn = new Function(
      text + `\n window.__dataLoaderTemp = ${variableName};`
    );
    fn();
    const data = window.__dataLoaderTemp || [];
    delete window.__dataLoaderTemp;
    return data;
  } catch (e) {
    throw new Error(`Failed to evaluate: ${path} - ${e.message}`);
  }
}

/**
 * Get default empty value for a dataset key.
 * @param {string} key
 * @returns {Array|Object}
 */
function getDefaultFor(key) {
  const knownArrays = ["veterans", "battles", "weapons", "topics", "letters"];
  if (knownArrays.includes(key)) return [];
  return {};
}

/**
 * Clear the data cache (useful for testing).
 */
export function clearCache() {
  cache.clear();
}

/**
 * Validate that data has all required fields.
 * @param {Array} data - Array of entries
 * @param {string[]} requiredFields - List of required field names
 * @param {string} idField - The id field name
 * @returns {{ valid: boolean, errors: string[] }}
 */
export function validateSchema(data, requiredFields, idField = "id") {
  const errors = [];
  if (!Array.isArray(data)) {
    return { valid: false, errors: ["Data is not an array"] };
  }

  data.forEach((entry, index) => {
    const id = entry[idField] || `index ${index}`;
    requiredFields.forEach((field) => {
      if (entry[field] === undefined || entry[field] === null) {
        errors.push(`Missing "${field}" in entry "${id}"`);
      }
    });
  });

  return { valid: errors.length === 0, errors };
}

/**
 * Get a single entry by its ID from a dataset.
 * @param {Array} data - Dataset array
 * @param {string} id - ID to find
 * @param {string} [idField='id'] - The ID field name
 * @returns {Object|null}
 */
export function getById(data, id, idField = "id") {
  if (!Array.isArray(data)) return null;
  return data.find((entry) => entry[idField] === id) || null;
}
