/**
 * VeteransLedger · Admin — Dirty-State Guard Registry
 * Any content module with unsaved-changes protection registers an isDirty()
 * check against its own tab panel id. admin.js consults every registered
 * guard before switching tabs or unloading the page, so only modules that
 * opt in (currently: Formations) gate navigation — every other tab behaves
 * exactly as before.
 */

const _guards = new Map(); // tabPanelId -> () => boolean

export function registerDirtyGuard(tabPanelId, isDirtyFn) {
  _guards.set(tabPanelId, isDirtyFn);
}

export function isTabDirty(tabPanelId) {
  const fn = _guards.get(tabPanelId);
  return !!fn && !!fn();
}

export function anyDirty() {
  for (const fn of _guards.values()) {
    if (fn()) return true;
  }
  return false;
}
