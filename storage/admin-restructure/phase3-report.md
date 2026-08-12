# Phase 3 — Formations Pilot (createContentModule Architecture) — Completion Report

Date: 2026-08-12. Status: **pilot complete, all checklist items verified, zero regressions found. One backend security finding discovered and documented (out of scope, not fixed).**

## Files changed

Frontend only — no backend/API/database files touched.

| File | Change |
|---|---|
| `frontend/pages/Admin/admin-modal-stack.js` | **New.** Global modal stack: open/close tracking, focus trap, focus restoration, Escape closes only the topmost modal, exposes the topmost modal's configured "primary save" button for Ctrl+S. Passive (watches each modal's `hidden` attribute via `MutationObserver`) — applies to **every** existing modal, including the 10 not-yet-migrated modules' preview modals, with zero changes to their own JS. |
| `frontend/pages/Admin/admin-dirty-guard.js` | **New.** Tiny registry (`registerDirtyGuard(tabPanelId, isDirtyFn)`) so `admin.js` can ask "is the currently active tab dirty?" without depending on any specific content module. Only Formations registers a guard right now. |
| `frontend/pages/Admin/admin-content-module.js` | **New.** `createContentModule(config)` — the shared factory: list/pagination/filtering, form open/close lifecycle, dirty-state tracking + confirm-before-discard, submit-state protection (disable + "Saving…", re-entrancy guard), a pluggable `validate(body)` hook, delete confirm + error handling, and a repeatable-draft-group abstraction covering both "click Add → blank editable row" (sources, commanders) and "click Add → open a picker" (related records) patterns. |
| `frontend/pages/Admin/admin.js` | Replaced the old flat `MODAL_IDS` backdrop/Escape loop and non-modal-aware Ctrl+S handler with calls into `admin-modal-stack.js`. Added `beforeunload` protection and a dirty-check in `activateTab()`, both driven by `admin-dirty-guard.js` — gated so only tabs that opt in (currently just Formations) can ever block navigation. |
| `frontend/pages/Admin/formations-admin.js` | Rewritten on top of `createContentModule()`. Same fields, same request shapes, same preview-refreshes-on-save loop as before; adds slug-format validation (new) and gets dirty/submit-state protection for free from the shared factory. |
| `frontend/pages/Admin/index.html` | Formations panel: moved Preview/Cancel out of the panel-header into a canonical bottom `.form-footer`-style row (Save, Preview, Cancel, Published, Status) matching the Armaments "gold standard" pattern instead of Formations' previous one-off header-heavy layout. Added `pattern`/`title` to the slug input for native inline validation. |
| `frontend/styles/admin.css` | `.btn:disabled` (didn't exist anywhere before — disabling a button had no visual effect); `.form-panel.is-dirty .section-label--flush::after` — a "• Unsaved changes" indicator shown live while editing, not just at the moment of navigating away. |

Not touched: publish/import pipeline, recovery system, Translation status model/provider architecture (only the Admin-side `translation-editor-modal` was *registered* with the new modal stack for Ctrl+S routing — its own save/generate/delete logic in `translations-panel.js` is unmodified), Community module, public localization system, database schema, and all 10 other content admin modules (`armaments-admin.js`, `personnel-admin.js`, `letters-admin.js`, `campaigns-admin.js`, `articles-admin.js`, `timeline-admin.js`, `nsdap-admin.js`, `awards-admin.js`, `maps-admin.js`, `political-docs-admin.js`).

## Database changes

**None.** `phase3-after.json` matches `phase3-baseline.json` on every content table (Record 184, Entity 46, TimelineEvent 83, Translation 72, Collection 42, Relationship 28, User 1). `AuditLog` went 0→5 — expected and correct: 5 real CRUD calls were made against a synthetic `ZZ-TEST Formation` fixture during testing (1 create, 3 update, 1 delete, all traced by entity id and confirmed to be the same test record), then the fixture was deleted via the real Delete button. No orphan `Translation` row was left (a translation-save was deliberately tested with empty content and correctly rejected with `400`, so nothing was ever persisted).

## API changes

None. No route, controller, service, or validator file was modified. (One pre-existing gap in `formations.service.ts`/`formation.validator.ts` was *discovered* — see "Issue discovered" below — but nothing was changed.)

## Architecture decisions

- **Split "global" vs. "per-module" infrastructure.** Modal stack management, focus trap/restoration, and modal-aware Ctrl+S are inherently singleton concerns (there's one Escape listener and one Ctrl+S listener for the whole Admin app) — these were rebuilt once in `admin.js`/`admin-modal-stack.js` and now benefit **every** modal in the app, old and new alike, without touching any of the 10 not-yet-migrated modules' own code. Dirty-state/submit-protection/validation/repeatable-groups are genuinely per-content-module and live entirely inside `createContentModule()`, used only where a module opts in (currently only Formations).
- **DOM id convention over explicit config.** Formations' existing markup already namespaced every element as `formation-<thing>` consistently (`formation-new-btn`, `formation-filter-section`, `formation-preview-modal`, …), so `createContentModule` derives ids from a single `idPrefix` instead of requiring one config line per element. This keeps the pilot's config focused on genuinely type-specific behavior (field mapping, validation rules, preview rendering) rather than DOM plumbing.
- **Canonical form-footer, established via the pilot, not retrofitted everywhere.** Auditing the existing footer patterns turned up three different layouts across the 10 pre-existing modules (`form-bottom-row`, `published-toggle` + separate `form-actions`, and Formations' own header-heavy variant). Armaments — already documented as the project's "gold standard" — uses: header = title only, footer = Save + Preview + Cancel + status, Published checkbox above the translations panel. Formations was reshaped to match that exact pattern. The other 9 modules are intentionally left as they are; retrofitting them is future-phase work, not something to do silently here.
- **Modal-aware Ctrl+S preserves an existing intentional behavior.** Formations' pre-Phase-3 code explicitly re-ran the preview fetch after a successful save if the preview modal was open. Since `formation-preview-modal` has no configured "save" selector (it's read-only), Ctrl+S while it's open still falls through to the underlying form — so that live-refresh behavior is unchanged. The `translation-editor-modal`, which previously had **no** Ctrl+S integration at all (pressing Ctrl+S while translating silently saved the *record* behind it, not the translation), now correctly routes to its own "Save as Human Verified" button when it's the topmost modal.
- **Validation hook proven independently of native HTML5 validation.** The slug field got both a native `pattern` attribute (immediate inline browser feedback) and a `validate(body)` rule in the shared factory (framework-level capability for rules HTML5 can't express, e.g. cross-field checks in future modules). Because native validation intercepts first in normal use, verifying the JS hook required bypassing `form.noValidate` in a dedicated test — confirmed it correctly blocks the request and surfaces the same error message.

## Security implications

None from the frontend changes themselves. See "Issue discovered" below for a backend finding surfaced incidentally while reading Formations' service code.

## Tests performed & results

| Test | Result |
|---|---|
| `tsc --noEmit` | Clean, zero errors |
| `node --check` on all 5 new/changed JS files | Clean |
| All Admin tabs still switch correctly (spot-checked Armaments, Personnel, Letters, Timeline, Awards, Maps, Translations, plus Formations) | Pass |
| Formations list load, section filter, search filter, pagination | Pass (32 formations, matches pre-Phase-3 count) |
| Create (ZZ-TEST fixture, full field set) | Pass — persisted correctly, list reloaded, translations panel activated |
| Native HTML5 slug-pattern validation | Blocks submission before the network call, browser tooltip shown |
| Shared `validate()` hook (tested via `form.noValidate` bypass) | Blocks submission, shows the exact configured error message, no network call |
| Submit-state protection | Save button synchronously disabled + "Saving…" during the in-flight request; re-enabled after |
| Dirty-state indicator | "• Unsaved changes" appears next to the form title live, on any field edit or draft-group change |
| Cancel button with unsaved changes | `confirm()` shown; declining keeps the form open, accepting closes it |
| Switching Admin tabs with Formations dirty | `confirm()` shown; declining stays on Formations, accepting switches — every other tab unaffected (no guard registered) |
| `beforeunload` while dirty | `preventDefault()` correctly called (verified via synthetic dispatch) |
| Preview modal (existing formation + new fixture) | Renders correctly, matches pre-Phase-3 output shape |
| Modal focus trap | Tab/Shift+Tab correctly cycles within the topmost modal only |
| Modal focus restoration | Closing a modal returns focus to the element that opened it |
| Escape with a modal open | Closes only the topmost modal; the form panel underneath stays open (no double-close race) |
| Escape with no modal open | Closes the open form panel (with a dirty-confirm if applicable) — unchanged for other modules |
| Ctrl+S, no modal open | Triggers the Formations form's real submit handler |
| Ctrl+S, translation-editor-modal open | Routes to the modal's own "Save as Human Verified" button, not the form underneath (this modal previously had **no** Ctrl+S integration at all) |
| Ctrl+S, preview modal open | Falls through to the form (preserves the pre-existing "save refreshes preview" behavior, since preview has no save action) |
| Add Related (picker-style draft group) | Opens the shared related-record modal, search works, picking an item adds it to the draft and persists on save |
| Delete — decline confirmation | No request sent, record still present |
| Delete — confirm | Record removed, list reloaded, zero orphan `Translation` rows |
| Non-migrated module regression check (Armaments) | "New Armament" form still opens and closes (Escape) correctly via the shared fallback path — unaffected by the modal-stack rewrite |
| Desktop / tablet (768px) / mobile (375px) Formations layouts | All correct; footer buttons wrap cleanly on mobile, field grids reflow as before |
| Console errors (fresh tab, uncontaminated by test actions) | None |

**Zero regressions found.** One CSS bug was introduced and caught during this same pass, before being reported as done: the dirty-indicator's `::after` initially inherited `.section-label`'s decorative-rule sizing (`flex:1; height:1px`), making the text wrap and clip — fixed by resetting those properties in the override.

One implementation bug was also caught and fixed during testing: `admin-modal-stack.js`'s `_onOpen` used an "already tracked" guard that could silently no-op on a rapid close-then-reopen of the same modal within one synchronous tick (the intermediate close can coalesce into a single `MutationObserver` callback), skipping the fresh focus-restoration setup. Fixed by clearing any stale stack entry for that id instead of guarding on its presence.

## Before / after counts

| | phase3-baseline | phase3-after |
|---|---|---|
| Record | 184 (32 Formation) | 184 (32 Formation) |
| Entity | 46 | 46 |
| TimelineEvent | 83 | 83 |
| Translation | 72 | 72 |
| Collection | 42 | 42 |
| Relationship | 28 | 28 |
| User | 1 | 1 |
| AuditLog | 0 | 5 (all from the ZZ-TEST fixture's create/update/delete cycle) |
| MediaAsset | 0 | 0 |

## Issue discovered (out of scope — not fixed)

While reading `formations.service.ts` to design `serializeForm`/`validate`, I found that **Formations' `create()`/`update()` have no field allowlist** — `req.body` flows straight into `prisma.record.create()`/`.update()` with only `type: "FORMATION"` forced. `express-validator`'s `createFormationValidator`/`updateFormationValidator` check the *types* of specific fields when present but don't strip unlisted ones. This is the same class of issue Phase 1 fixed (BE-05) for Letters, Campaigns, Articles, and Personnel — but Phase 1's report stated Formations "already had a correct allowlist pattern via explicit fields," which the actual code doesn't bear out. Since both routes require `authenticate + requireAdmin`, this isn't an unauthenticated public risk (matching Phase 1's framing for the other four), but it is a live gap worth closing for consistency and defense-in-depth. This is backend/API code, outside Phase 3's frontend-architecture scope — flagging per "stop and document rather than silently expand scope" rather than fixing it now. Recommend a small follow-up (add `pickRecordFields()`-style allowlisting to `formations.service.ts`, matching Phase 1's pattern) whenever backend work is next authorized.

## Regressions discovered

None.

## Next recommended step

Formations is now a working, verified reference implementation of `createContentModule()`. Two reasonable paths, your call:
1. Continue Phase 3 by migrating one or two more modules (e.g. Awards or Maps, which already use the closest-matching footer pattern) to further validate the abstraction against a second, differently-shaped module before committing to migrating all 10.
2. Treat the Formations pilot as complete and move to Phase 4 (visual/dead-code cleanup), returning to migrate the remaining modules in a later, explicitly-scoped pass.

Also flagging for scheduling (not urgent, not blocking): the Formations backend allowlist gap above, and the two pre-existing `main{overflow-x:hidden}`-caused bugs already logged in `phase2-report.md` (broken `position:sticky` for the tab bar) — now additionally confirmed to also break `scrollIntoView`'s auto-scroll-to-newly-opened-panel behavior (same root cause, reconfirmed during this phase's testing, not a new issue).
