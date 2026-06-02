/**
 * TEMPLATES.JS – Central Data Loader
 * Externalized data loader for VeteranLedger historical archive.
 *
 * Provides lazy-loading accessors for all dataset modules.
 * Each dataset is loaded on first access, cached, and returned via simple getter functions.
 *
 * Usage:
 *   const veterans = await getVeterans();
 *   const battles  = await getBattles();
 *   const weapons  = await getWeapons();
 *   const topics   = await getTopics();
 *   const letters  = await getLetters();
 *   const modal    = getModal();
 */

// ---------------------------------------------------------------
// 1. VETERAN PROFILES
// ---------------------------------------------------------------
const veteranProfiles = (() => {
  let data = null;
  return async function getVeterans() {
    if (data) return data;
    // Script tag with id 'veterans-data' provides the data
    const script = document.getElementById("veterans-data");
    if (script) {
      // If script tag exists, data is already loaded globally
      data = window.veteranProfiles || [];
      return data;
    }
    // Fallback: fetch from external file
    try {
      const response = await fetch("data/veterans.js");
      const text = await response.text();
      // Execute the script to set window.veteranProfiles
      const fn = new Function(
        text + "\n window._veteranProfiles = veteranProfiles;",
      );
      fn();
      data = window._veteranProfiles || [];
      delete window._veteranProfiles;
      return data;
    } catch (e) {
      console.error("Failed to load veterans data:", e);
      return [];
    }
  };
})();

// ---------------------------------------------------------------
// 2. BATTLES DATA
// ---------------------------------------------------------------
const battlesData = (() => {
  let data = null;
  return async function getBattles() {
    if (data) return data;
    const script = document.getElementById("battles-data");
    if (script) {
      data = window.battlesData || [];
      return data;
    }
    try {
      const response = await fetch("data/battles.js");
      const text = await response.text();
      const fn = new Function(text + "\n window._battlesData = battlesData;");
      fn();
      data = window._battlesData || [];
      delete window._battlesData;
      return data;
    } catch (e) {
      console.error("Failed to load battles data:", e);
      return [];
    }
  };
})();

// ---------------------------------------------------------------
// 3. WEAPONS / TECHNOLOGY DATA
// ---------------------------------------------------------------
const weaponsData = (() => {
  let data = null;
  return async function getWeapons() {
    if (data) return data;
    const script = document.getElementById("weapons-data");
    if (script) {
      data = window.weaponsData || [];
      return data;
    }
    try {
      const response = await fetch("data/weapons.js");
      const text = await response.text();
      const fn = new Function(text + "\n window._weaponsData = weaponsData;");
      fn();
      data = window._weaponsData || [];
      delete window._weaponsData;
      return data;
    } catch (e) {
      console.error("Failed to load weapons data:", e);
      return [];
    }
  };
})();

// ---------------------------------------------------------------
// 4. TOPICS / ARTICLES DATA
// ---------------------------------------------------------------
const topicsData = (() => {
  let data = null;
  return async function getTopics() {
    if (data) return data;
    const script = document.getElementById("topics-data");
    if (script) {
      data = window.topicsData || [];
      return data;
    }
    try {
      const response = await fetch("data/topics.js");
      const text = await response.text();
      const fn = new Function(text + "\n window._topicsData = topicsData;");
      fn();
      data = window._topicsData || [];
      delete window._topicsData;
      return data;
    } catch (e) {
      console.error("Failed to load topics data:", e);
      return [];
    }
  };
})();

// ---------------------------------------------------------------
// 5. LETTERS DATA
// ---------------------------------------------------------------
const lettersData = (() => {
  let data = null;
  return async function getLetters() {
    if (data) return data;
    const script = document.getElementById("letters-data");
    if (script) {
      data = window.lettersData || [];
      return data;
    }
    try {
      const response = await fetch("data/letters.js");
      const text = await response.text();
      const fn = new Function(text + "\n window._lettersData = lettersData;");
      fn();
      data = window._lettersData || [];
      delete window._lettersData;
      return data;
    } catch (e) {
      console.error("Failed to load letters data:", e);
      return [];
    }
  };
})();

// ---------------------------------------------------------------
// 6. MODAL DATA (index.html data – object, not array)
// ---------------------------------------------------------------
const modalDataLoader = (() => {
  let data = null;
  return async function getModal() {
    if (data) return data;
    const script = document.getElementById("modal-data");
    if (script) {
      data = window.modalData || {};
      return data;
    }
    try {
      const response = await fetch("data/modal.js");
      const text = await response.text();
      const fn = new Function(text + "\n window._modalData = modalData;");
      fn();
      data = window._modalData || {};
      delete window._modalData;
      return data;
    } catch (e) {
      console.error("Failed to load modal data:", e);
      return {};
    }
  };
})();

// ---------------------------------------------------------------
// 7. UTILITY HELPERS
// ---------------------------------------------------------------

/**
 * Get a veteran profile by its unique id.
 * @param {string} id
 * @returns {Promise<Object|null>}
 */
async function getVeteranById(id) {
  const all = await veteranProfiles();
  return all.find((v) => v.id === id) || null;
}

/**
 * Get a battle by its unique id.
 * @param {number} id
 * @returns {Promise<Object|null>}
 */
async function getBattleById(id) {
  const all = await battlesData();
  return all.find((b) => b.id === id) || null;
}

/**
 * Get a weapon by its unique id.
 * @param {number} id
 * @returns {Promise<Object|null>}
 */
async function getWeaponById(id) {
  const all = await weaponsData();
  return all.find((w) => w.id === id) || null;
}

/**
 * Get a topic/article by its unique id.
 * @param {number} id
 * @returns {Promise<Object|null>}
 */
async function getTopicById(id) {
  const all = await topicsData();
  return all.find((t) => t.id === id) || null;
}

/**
 * Get a letter by its unique id.
 * @param {number} id
 * @returns {Promise<Object|null>}
 */
async function getLetterById(id) {
  const all = await lettersData();
  return all.find((l) => l.id === id) || null;
}
