# Final Admin Architecture Completion Report

**Date:** 2026-08-16
**Scope of this track:** the fixed-file `/api/site-content` editors — shared dirty-state protection, plus unmanaged-key preservation. No CRUD module was migrated into `createContentModule()`.

---

## 1. Baseline (read-only, before any change)

Enumerated every editable site-content file via `ALLOWED_PREFIXES` in `site-content.service.ts` and captured byte length, SHA-256 and top-level keys for each: **63 JSON files**. Saved to [`sitecontent-file-baseline.json`](sitecontent-file-baseline.json).

**Editor inventory — confirmed exactly six** (verified by grepping the whole frontend for `api/site-content`; the only other two hits were a comment in `admin-content-module.js` and a *read-only* GET in `translations-panel.js`, neither an editor):

| Editor | Tab panel | Save control | File(s) | Translation wiring | Ctrl+S |
|---|---|---|---|---|---|
| NSDAP | `tab-nsdap` | `#nsdap-save-btn` | 23 keys under `nsdap/*` | `site_content`, per file key | ✅ |
| Content Pages | `tab-pages` | `#pages-save-btn` | 13 keys (about/legal/site-policies + homepage) | `site_content`, per file key | ✅ |
| Homepage | `tab-homepage` | `#homepage-save-btn` | `homepage.json` | `site_content` | ✅ |
| Navigation | `tab-navigation` | `#nav-save-btn` | `navigation.json` | `site_content` | ✅ |
| Site Settings | `tab-settings` | `#settings-save-btn` | `site-settings.json` | `site_content` | ✅ |
| Page Content | `tab-page-content` | `#pce-save-btn` | `page-content.json` | `site_content` | ✅ |

Ctrl+S already worked for all six before this work, via an existing generic fallback in `admin.js` matching `.btn-primary[id$='-save-btn']` — pre-existing infrastructure, credited not changed. Modal integration: none of the six own a modal; the only one nearby is Homepage's icon-picker, which self-manages (works correctly, see §6).

---

## 2. Managed vs. unmanaged keys, and save-path preservation

Five of six editors already preserved unmanaged keys correctly, via load-whole-file → mutate-managed-keys → write-whole-file:

| Editor | Managed | Unmanaged (preserved) | Verdict |
|---|---|---|---|
| Navigation | `brand`, `footer`, `primary` | `settings`, `utility` | ✅ sound |
| Site Settings | `site`, `contact`, `cookieBanner`, `disclaimer` | `features`, `social`, `archive` | ✅ sound (raw-JSON textarea is the merge base) |
| Homepage | `hero`, `browseSectionLabel`, `archiveCards` | `meta` | ✅ sound |
| Page Content | per-page `meta`, `hero`, `archiveInfo` | other 13 pages; `sectionLabels` within a page | ✅ sound |
| Content Pages | scalars + `content` blocks | everything else (`{...data}` spread) | ✅ sound |
| **NSDAP** | see below | see below | ❌ **two data-loss bugs** |

### 🔴 Bug A — NSDAP Glossary destroyed the file (catastrophic, pre-existing)

`nsdap/glossary.json` stores its list under **`terms`** (24 entries). `populateGlossary()` read `data.entries` — undefined — so the editor rendered **0 rows**, and `readGlossary()` wrote back `{ entries: [] }`.

**Opening the Glossary and clicking Save — with no editing at all — replaced a 24-term file with `{"entries":[]}`.** Total content loss, one click, no warning. Confirmed by simulation against the real file before fixing.

Per-entry `origin` (present on all 24 terms) was also outside the editor's shape and would have been lost.

### 🔴 Bug B — NSDAP Overview dropped 4 of 15 keys (pre-existing)

`overview.json` has 15 top-level keys; `readOverview()` returned 11. **`youth_wings`, `paramilitary`, `newspaper`, `anthem` were deleted on every save.**

### 🟡 NSDAP Timeline — no current loss, but unguarded

Event keys are exactly `year/date/title/description`, matching the editor, so nothing was being lost today — but there was no guard if the shape ever gained a field. Hardened anyway.

**Fix (same principle already proven elsewhere this engagement — spread the source, overwrite only what's managed):** kept the loaded file in `currentData`; all three structured readers now spread it first. Glossary additionally detects the actual list key (`terms` vs `entries`) and preserves per-entry fields via a retained `_original`. Timeline preserves per-event fields the same way. **No key is named as a special case** — any future key is preserved generically.

---

## 3. The shared dirty-state solution

**One new file, 60 lines:** `frontend/pages/Admin/admin-file-editor-guard.js`, built on the **existing** `admin-dirty-guard.js` registry that `admin.js` already consults for tab-switch and `beforeunload`. **No new CMS architecture; no `createContentModule()` involvement.**

```js
export function createFileEditorGuard({ tabPanelId, extra }) { … }   // registers isDirty()
export function snapshotPanelInputs(panelId, extra) { … }            // generic snapshot
```

Dirty detection snapshots **every form control inside the tab panel**, so one implementation covers six very different editors (structured fields, raw-JSON textareas, block editors, managed card collections) with **no per-editor field lists**. Editors with state outside form controls pass an `extra` function — used by Homepage (card icons + enabled flags + ordering) and NSDAP (row counts).

Per editor: `guard.markClean()` after load and after successful save. Also on *view* changes that repopulate fields but aren't edits — Page Content's page dropdown, NSDAP/Content Pages file switching, Content Pages' Developer-mode toggle — so those don't raise false positives.

Until the first `markClean()`, an editor reports clean, so a tab never opened can't block navigation.

**Files changed:** the six editor JS files (import + `guard` + `markClean()` calls) and the one new shared module. Nothing else.

---

## 4. Verification

### Dirty-state, all six editors

| Editor | Clean on load | Dirty on edit | Clean on restore |
|---|---|---|---|
| Navigation | ✅ | ✅ | ✅ |
| Site Settings | ✅ | ✅ | ✅ |
| Homepage | ✅ | ✅ | ✅ |
| Page Content | ✅ | ✅ | ✅ |
| NSDAP (Glossary) | ✅ | ✅ | ✅ |
| Content Pages | ✅ | ✅ | ✅ |

- **Tab-switch protection:** edited Navigation, clicked another tab → prompted *"You have unsaved changes on this tab. Leave without saving?"*; **declining kept the tab**, accepting switched. ✅
- **beforeunload:** `anyDirty()` returned `true` during an edit — the existing `admin.js` handler fires. ✅
- **No false positives:** Page Content page-switch, NSDAP file-switch, Content Pages Developer-mode toggle all stayed clean. ✅
- **Ctrl+S:** routed to the correct save button for all six. ✅

### Unmanaged-key preservation — real UI saves

Backed up three files, performed **real Save clicks in the Admin UI with no edits**, compared, then **restored exact original bytes**:

| File | Result |
|---|---|
| `nsdap/glossary.json` | **24 terms rendered** (was 0 before the fix); after save: key `terms` intact, 24 terms, `origin` preserved, **content deep-equal** ✅ |
| `nsdap/overview.json` | 15 keys → 15 keys; `youth_wings`/`paramilitary`/`newspaper`/`anthem` all preserved; **content deep-equal** ✅ |
| `homepage.json` | `meta` preserved; content differed only by `enabled: true` being added to each card — see §6 ✅ |

### Responsive

| Viewport | Result |
|---|---|
| Desktop | ✅ all six |
| Tablet 768×1024 | ✅ all six, no horizontal scroll |
| Mobile 375×812 | ✅ all six via the mobile tab `<select>`; NSDAP/Content Pages sidebars collapse to one column; no horizontal scroll |

### Suite

- `tsc --noEmit` — **clean**
- `node --check` on all seven touched JS files — **clean**
- Fresh Admin console (new tab, fresh login, all six editors) — **zero errors**; all modules incl. `admin-file-editor-guard.js` load 200 OK
- Fresh public-site console — **zero errors**
- **File integrity: `git status public/data/` is empty — all 63 site-content files byte-identical to baseline**
- DB unchanged (this track touched no database)
- No `ZZ-TEST`/`ZZTEMP` strings anywhere in `public/data/`
- No scratch artifacts (`src/scripts/` clean)

**Localization untouched:** no translation file, no `Translation` record, and no public locale code was modified. Verified post-change that `ui-strings.json` (102 keys), `navigation.json` and `homepage.json` all serve correctly to the public site. The Admin remains English-only; the public 9-language system is unaffected.

---

## 5. Final status matrix

### DB-backed CRUD modules

| Area | Status | Notes |
|---|---|---|
| Formations | **COMPLETE** | On `createContentModule()`; metadata-merge + allowlist + slug validation |
| Armaments | **COMPLETE** | Migrated; metadata-merge; provenance keys; type-fidelity round-trip |
| Personnel | **COMPLETE** | Migrated; metadata-merge; date normalization; `snapshotExtra` dirty-tracking |
| Letters | **COMPLETE** | Migrated; metadata-merge; date normalization |
| Campaigns | **COMPLETE** | Migrated; metadata-merge; date normalization |
| Articles | **COMPLETE** | Migrated; metadata-merge |
| Awards / Maps / Political Docs | **COMPLETE** | Migrated; shared `records.service.ts` — allowlist, metadata-merge, date normalization |
| Timeline | **COMPLETE** | Migrated; metadata-merge; pagination; in-form delete hook; `summary` persistence fixed |

### Fixed-file site-content editors

| Area | Status | Notes |
|---|---|---|
| NSDAP | **COMPLETE** | Dirty-guard; **glossary file-destruction and overview key-loss fixed**; timeline hardened |
| Content Pages | **COMPLETE** | Dirty-guard incl. Developer-mode toggle |
| Homepage | **COMPLETE** | Dirty-guard incl. card draft state |
| Navigation | **COMPLETE** | Dirty-guard |
| Site Settings | **COMPLETE** | Dirty-guard |
| Page Content | **COMPLETE** | Dirty-guard incl. page-switch |

### Intentionally separate

| Area | Status | Why |
|---|---|---|
| All six above vs. `createContentModule()` | **INTENTIONALLY SEPARATE** | Whole-file editors keyed by path, not CRUD record lists — no list/create/delete/pagination to generalize. The file-based pattern is sound; only dirty-state was missing, now shared. |
| Translation Dashboard | **INTENTIONALLY SEPARATE** | Cross-cutting coverage/bulk tool; every action applies immediately, so no unsaved state exists to guard. |
| Media Library | **INTENTIONALLY SEPARATE** | Upload/browse/delete tool; not a record-list or file-editor pattern. |
| Publish Pipeline | **INTENTIONALLY SEPARATE** | validate → stage → promote → rollback; its own architecture. |

### Outstanding

| Item | Status | Blocker? | Why it remains |
|---|---|---|---|
| No server-side schema validation on `PUT /api/site-content` | **OUTSTANDING** | **No** | Any JSON shape is accepted. Client-side validation exists in every editor and all six now preserve unmanaged keys. A backend schema layer would benefit all six from one change — worth doing, not urgent. |
| `GET /api/site-content` has no auth | **OUTSTANDING** | **No** | Almost certainly intentional — the public site reads these files through the same endpoint. Documented so the choice is explicit rather than assumed. |
| `homepage.json` editable from two UIs | **OUTSTANDING** | **No** | Both Homepage tab and Content Pages write it. Not corrupting (both preserve keys), but confusing. Simplest fix: drop it from Content Pages' file list. |
| Icon-picker modal not in the shared modal stack | **OUTSTANDING** | **No** | Self-manages Escape + backdrop correctly; just doesn't share focus-trap/Ctrl+S routing. Cosmetic consistency. |
| Site-content saves have no history/rollback | **OUTSTANDING** | **No** | Unlike the Record publish pipeline. Architectural note. |
| Generic delete-confirm wording in `createContentModule()` | **OUTSTANDING** | **No** | Says "Delete this record?" rather than per-type. Cosmetic; known since Batch 1. |
| Missing `/storage/images/armaments/**` files | **OUTSTANDING** | **No** | 7 × 404 on the public Armaments page. Content gap, not code — the directory doesn't exist; paths come from published archive JSON. Page degrades to a placeholder. |
| Homepage `enabled` normalization | **OUTSTANDING** | **No** | Saving Homepage adds `enabled: true` to cards lacking it. Pre-existing intentional behavior (the UI has an Enabled checkbox); observed during testing and reverted. Noted for transparency, not a defect. |
| JSON re-formatting on save | **OUTSTANDING** | **No** | The API writes `JSON.stringify(…, 2)`; 4 of 7 checked files differ in whitespace from that. Cosmetic diff noise on first save of each file; no content impact. |

---

## 6. Every original forensic-audit finding

| # | Finding | Status | Detail |
|---|---|---|---|
| 1 | No shared CRUD architecture; 11 bespoke modules | **COMPLETE** | `createContentModule()` built; all 10 CRUD modules migrated |
| 2 | No dirty-state / unsaved-changes protection anywhere | **COMPLETE** | CRUD via the factory; the six file editors via `admin-file-editor-guard.js` — Admin-wide now |
| 3 | Broken modal behavior (no focus trap, Escape closed everything) | **COMPLETE** | `admin-modal-stack.js`: stack, focus trap, focus restoration, Escape-topmost-only, modal-aware Ctrl+S |
| 4 | No submit-state protection (double-submit possible) | **COMPLETE** | Factory disables submit + shows "Saving…" |
| 5 | Field-allowlist gaps (mass-assignment) | **COMPLETE** | `pickRecordFields`/`pickFormationFields`/`pickEntityFields`/`pickGenericRecordFields`; `records.service.ts` type-spoofing closed |
| 6 | `main{overflow-x:hidden}` broke sticky/scrollIntoView site-wide | **COMPLETE** | Moved to `body`; verified Admin + public |
| 7 | Inconsistent form footers | **COMPLETE** (partial by design) | Migrated modules standardized; noted where legacy layouts remain acceptable |
| 8 | Bare `YYYY-MM-DD` → Prisma `DateTime` 500s | **COMPLETE** | Shared `date-normalize.ts`; 5 modules; timezone verified (UTC-midnight, no drift) |
| 9 | Date clearing silently did nothing | **COMPLETE** | Frontends now send explicit `null`; validators accept it |
| 10 | Metadata wholesale-replace (silent data loss) | **COMPLETE** | `mergeMetadata()` across **all 8** DB-backed services |
| 11 | Personnel biography/portrait invisible to dirty-tracking | **COMPLETE** | `snapshotExtra()` hook |
| 12 | Timeline `summary` never persisted | **COMPLETE** | Added to interface, `toDbData()`, and both validators |
| 13 | Armaments metadata type corruption | **COMPLETE** | Generic type-preserving round-trip; 696 values verified |
| 14 | Armaments provenance keys deleted on save | **COMPLETE** | `mergeMetadata()` in `armaments.service.ts` |
| 15 | NSDAP glossary destroyed file on save | **COMPLETE** | *(found in this track)* key detection + preservation |
| 16 | NSDAP overview dropped 4 keys | **COMPLETE** | *(found in this track)* source spread |
| 17 | Accidental deletion of a real record (test tooling) | **COMPLETE** | Battle of Britain restored + verified; scoped-selector protocol adopted |
| 18 | Site-content schema validation / auth / rollback | **OUTSTANDING** | Non-blocking; see §5 |

---

## 7. Are we done?

**Every data-integrity defect found across this entire engagement is fixed and verified.** Nothing outstanding is a blocker: the nine remaining items are hardening, cosmetics, or content gaps, each with a documented reason for remaining.

Two things I'd flag before you call the system finished:

1. **The NSDAP glossary bug was live until today.** Any admin who opened Glossary and hit Save would have destroyed 24 terms with no warning and no undo. It's fixed, but it's worth knowing it was reachable — and that site-content has no save history, so recovery would have depended on git.
2. **The outstanding site-content items share one root cause** — `PUT /api/site-content` accepts arbitrary JSON with no schema and no versioning. Addressing that one endpoint would close four of the nine outstanding items at once. That's the highest-leverage next step if you want to keep going.

**I'm not declaring the Admin system complete** — that's your call, and this report is the evidence for it. What I can state: all 16 functional/data-integrity findings are closed and verified; the remaining 2 categories are documented, non-blocking, and each has a clear path.
