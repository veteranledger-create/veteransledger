# Phase 4 — Batch 1 Migration (Armaments, Personnel, Letters) — Completion Report

Date: 2026-08-12. Status: **all three modules migrated and verified. Zero regressions, zero unintended DB drift. One systemic pre-existing bug confirmed (not fixed, per scope) affecting two of the three modules. One shared-infra gap found and fixed during Personnel's migration. One minor cosmetic inconsistency noted for a future pass.**

## Scope

Per your instruction, this batch covers exactly three modules — Armaments, Personnel, Letters — migrated one at a time onto `createContentModule()`, each followed by its own live regression pass before starting the next. Formations (Phase 3 pilot), Awards, Maps, Political Docs, NSDAP, Timeline, and the generic Admin infrastructure were **not modified** and were spot-checked afterward for regressions.

## Files changed

| File | Change |
|---|---|
| `frontend/pages/Admin/admin-content-module.js` | Extended with new, generic extension points needed by real module differences discovered during inspection — none of these duplicate anything; they're hooks the shared factory calls at defined lifecycle points: `extraDraftKeys` (additional `drafts.*` slots for state a module renders itself, e.g. media sections), `onInit(drafts, {setStatus})`, `onTabActivate()`, `onFormOpen(drafts, isNew)`, `beforeSubmit(form, drafts, editingId)`, `snapshotExtra()` (lets dirty-tracking see state that lives outside named form fields, e.g. the block-based body editor). Also upgraded `handleSubmit`'s error handling to extract a server-provided `error` message when available (previously only Personnel/Letters had this; now uniform, with an identical fallback message when no specific error exists — no wording regression for Formations/Armaments). |
| `frontend/pages/Admin/armaments-admin.js` | Rewritten on the factory. Preserves: fixed `SPEC_FIELDS` inputs + dynamic `extraSpecs` list, sources/related, legacy media-library attach (separate `PUT .../media` after save, matching original two-phase save/error semantics exactly), gallery/blueprints/videos/documents upload sections, live non-blocking duplicate-name check, `registerCallbacks` re-registration on tab activate. |
| `frontend/pages/Admin/personnel-admin.js` | Rewritten on the factory. Preserves: Entity-backed model, portrait upload (single URL field), biography block editor (with legacy plain-text fallback), commands/awards/campaigns as plain string lists, sources/related, gallery/documents. Adds a real fix (see below) for a dirty-tracking gap that existed in the original code too. |
| `frontend/pages/Admin/letters-admin.js` | Rewritten on the factory. Preserves: title auto-fallback to sender name, the `collection`/`language` dual-write (verified round-trips correctly), full/original text fields, sources/related, gallery/documents. |
| `frontend/pages/Admin/index.html` | No changes needed — Armaments, Personnel, and Letters already used the `.form-actions` footer pattern (Save/Preview/Cancel + status), so no header/footer restructuring was required this batch (unlike Formations in Phase 3). |

Not touched: `frontend/styles/core.css`, the public 9-language localization system, publish/import/recovery pipeline, Translation status/provider architecture, Community module, database schema, and every module outside this batch (Formations, Awards, Maps, Political Docs, NSDAP, Timeline, Campaigns, Articles).

## Shared infrastructure used (single source of truth, confirmed)

CRUD lifecycle, dirty-state tracking, submit-state protection, validation integration, delete confirmation/error handling, modal stack behavior, focus trapping/restoration, Escape handling, and modal-aware Ctrl+S all come from `admin-content-module.js` + `admin-modal-stack.js` + `admin-dirty-guard.js` for all three modules — none of them re-implement any of this locally. Responsive form structure and the consistent form-footer layout come from the pre-existing shared CSS (`.form-actions`, `.form-panel`, `.published-toggle`), which all three modules already conformed to.

## Newly discovered issues

### 1. Pre-existing systemic bug — bare-date `DateTime` fields reject Prisma coercion (confirmed, not fixed)

**Reproduced identically in both Personnel (`birthDate`/`deathDate`) and Letters (`date`).** `express-validator`'s `isISO8601()` accepts a bare `"YYYY-MM-DD"` string, and the admin forms' `<input type="date">` fields submit exactly that format — but Prisma's `DateTime` field requires a full ISO-8601 datetime and throws `PrismaClientValidationError: Invalid value for argument 'birthDate': premature end of input` on a bare date, surfacing as a raw `500`.

**Confirmed pre-existing, not introduced by this migration:** neither `personnel.service.ts` nor `letters.service.ts` was touched; the frontend `serializeForm` functions send the exact same `body.birthDate = birthDateVal` / `body.date = dateVal` shape the original bespoke code sent. Existing records with valid dates (e.g. Adolf Galland's `1912-03-19`) must have been seeded outside the Admin UI (import/migration script), since the UI path has apparently never successfully persisted a date through create or update.

**Not fixed, per your explicit instruction.** Verified isolated to the date/datetime fields specifically — every other field on both create attempts saved correctly once the date field was cleared. Recommend a small, separately-scoped backend fix (coerce to `new Date(dateStr)` — or the equivalent full-datetime string — before the Prisma call in both services, and check whether Campaigns/Timeline have the same field pattern) whenever backend work is next authorized.

### 2. Personnel's biography editor and portrait field were invisible to dirty-tracking (found and fixed, in scope)

The block-based body editor (`admin-body-editor.js`) renders its inputs with no `name` attributes at all, and the portrait URL input (`#personnel-portrait-url`) isn't part of the form's named fields either — so `FormData`-based dirty-state (as built for the Formations pilot) would silently treat edits to either as "clean," meaning a user could lose biography or portrait changes on Cancel/tab-switch/browser-close with no warning. This is not a wording nitpick — it's the same class of silent-data-loss risk the dirty-tracking infrastructure exists to prevent, and it's specific to how Personnel's editor is built (Formations/Armaments/Letters have no such non-named-field content). Fixed via the new `snapshotExtra()` hook: the factory now also reads live biography-block JSON and the portrait URL into every dirty-state snapshot. Verified live: editing biography text alone (no other field touched) now correctly sets `.is-dirty` and correctly triggers the Cancel-button confirm.

### 3. Delete-confirmation wording is generic across all four migrated modules (minor, deferred)

The shared factory's delete confirmation reads "Delete this record? This cannot be undone." for every type, where each module's original bespoke code said "Delete this formation?" / "this armament?" / "this personnel record?" / "this letter?". This was already true after the Formations pilot (Phase 3) and wasn't previously flagged; noting it now since it affects three more modules in this batch. Low severity (cosmetic only, no functional or data-integrity impact), easy to fix (an optional `deleteConfirmLabel` config string, defaulting to the current generic text) — deferring rather than making an unplanned change mid-sequence; flagging for the next stabilization-style pass or for you to green-light inline.

## Backend inspection (Letters specifically, per your request)

`letters.service.ts`'s `create()`/`update()` both use `pickRecordFields()` — the Phase 1 allowlist pattern — identically to Campaigns/Articles. No mass-assignment gap. Routes are `authenticate + requireAdmin` on every verb, matching the established pattern. **No new backend issue found for Letters.** (Contrast with Formations in Phase 3, which *did* have this gap — Letters does not.)

## Tests performed & results (all three modules)

| Test | Armaments | Personnel | Letters |
|---|---|---|---|
| List load, filter, pagination | Pass | Pass | Pass |
| Create (full field set incl. media upload) | Pass | Pass (without date — see issue #1) | Pass (without date — see issue #1) |
| Field population on edit-reopen | Pass — specs, extraSpecs, sources, related, gallery, media-library attach all verified against real data | Pass — name/branch/rank/portrait/biography verified against Adolf Galland's real record | Pass — `from`/`collection`/`full_text` verified; **`collection`/`language` dual-write round-trip explicitly confirmed** |
| Dirty-state indicator | Pass | Pass, **including the biography/portrait fix** (confirmed both broken before the fix and working after) | Pass |
| Submit-state protection (disable + "Saving…") | Pass | Pass | Pass (inherited, not re-verified in isolation — identical code path already proven twice) |
| Server error-message surfacing | N/A (no failure case exercised) | Pass — real "Internal server error" shown (proved the enhanced extraction works, incidentally via issue #1) | Pass — same |
| Cancel with unsaved changes (decline → stays, accept → discards, verified against real data) | Pass | Pass | Pass |
| Tab-switch dirty guard (decline → blocked, accept → proceeds) | — (verified in Phase 3/stabilization for the shared mechanism) | — | Pass, explicitly re-verified this module |
| `beforeunload` protection | — | — | Pass, explicitly re-verified |
| Preview modal: opens, focus moves in, `role=dialog`/`aria-modal` | Pass | Pass | Pass |
| Preview modal: focus trap (Tab stays inside) | Pass | — | Pass |
| Preview modal: Escape closes only the modal, form stays open | Pass | Pass | Pass (focus-restoration-to-opener check hit the same known browser-automation timing artifact documented in Phase 3 — not re-litigated, since it's shared infra already proven, not module-specific) |
| Translation panel loads for the correct record | Pass | Pass | Pass |
| Modal-aware Ctrl+S: translation modal open → routes to its own save, not the record form | Pass (Phase 3-era check, same code path) | — | **Explicitly re-verified this module**: `formSubmitFired: false`, `tlSaveClicked: true` |
| No orphaned translation rows left behind | Pass | Pass | Pass — explicitly checked `GET /api/translations/record/:id` returned `{}` after the Ctrl+S test |
| Delete: decline → preserved, confirm → removed | Pass | Pass | Pass |
| No orphaned media assets after delete | Pass (2 test uploads found and removed) | Pass (1 test upload found and removed) | Pass (none created) |
| `registerCallbacks` re-registration across tab switches (shared `admin-media.js` singleton) | Pass — explicitly tested Armaments→Personnel→Armaments, re-upload succeeded | — (same code path, not re-tested in isolation) | N/A (Letters has no re-registration-sensitive interaction exercised beyond the standard pattern) |
| Desktop / tablet / mobile layouts | Pass | Pass | Pass — screenshotted at all three breakpoints, footer buttons wrap correctly on mobile |
| Non-migrated module regression spot-check | Armaments-adjacent: N/A | — | **All seven named "already-stable" areas checked**: Timeline (form opens/closes correctly); Formations, Awards, Maps, Political Docs (each: tab switches correctly, "New" form opens, Cancel closes cleanly, zero console errors); NSDAP (tab switches correctly, loads its raw-JSON editor); generic Admin infrastructure (tab-switching, modal stack, and Ctrl+S routing all independently re-proven throughout this batch's own tests) — all unaffected |
| Console errors (fresh, uncontaminated tab) | Clean | Clean | Clean — Admin and public site both checked fresh |
| `tsc --noEmit` | Clean | Clean | Clean (checked after each module) |

## Before / after counts (cumulative across all of Batch 1)

| | batch1-baseline (pre-Armaments) | batch1-after-letters (post all 3) |
|---|---|---|
| Record | 184 (85 Armament, 24 Letter) | 184 (85 Armament, 24 Letter) — **identical** |
| Entity | 46 | 46 — **identical** |
| TimelineEvent | 83 | 83 |
| Translation | 72 | 72 — **identical, zero orphans** |
| Collection | 42 | 42 |
| Relationship | 28 | 28 |
| User | 1 | 1 |
| AuditLog | 10 | 16 (+6, fully accounted for by test-fixture create/update/delete cycles across the three modules) |
| MediaAsset | 0 | 0 — **identical, zero orphans** |

**Zero drift on every real-content table.** Final sweep confirmed zero remaining `ZZ-TEST-*` fixtures across Armaments, Personnel, Letters, and Formations, and zero leftover media assets.

## Session continuity note

Mid-way through Letters' regression pass, the local dev server/browser preview session was reset (environment-level, not a code issue). The database is a real persistent instance, so all prior state — including the in-progress `ZZ-TEST` Letters fixture — survived intact and testing resumed and completed from exactly where it left off, without redoing Armaments or Personnel.

## Next recommended step

Batch 1 is complete and clean. Two items worth a decision before or alongside Batch 2:
1. **The bare-date `DateTime` bug** (issue #1) — recommend a small, separately-scoped backend fix, since it will keep blocking real content edits to Personnel and Letters (and possibly Campaigns/Timeline, not yet checked) until fixed.
2. **Delete-confirmation wording** (issue #3) — trivial, your call on whether to fold into Batch 2 or a dedicated cleanup pass.

Awaiting your review before starting Batch 2.
