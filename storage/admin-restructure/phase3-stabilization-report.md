# Phase 3 — Stabilization Pass — Completion Report

Date: 2026-08-12. Status: **both fixes complete and verified, zero regressions, shared architecture ready for the next migration batch pending your approval.**

## Files changed

Backend and shared CSS — no other frontend files touched.

| File | Change |
|---|---|
| `src/utilities/allowlist.ts` | Added `pickFormationFields()` — `RECORD_CONTENT_FIELDS` plus `slug` (Formations is the one Record-backed type where slug is genuinely client-supplied; broadening the shared `RECORD_CONTENT_FIELDS` instead would have quietly re-opened slug injection for Letters/Campaigns/Articles, which intentionally never accept it). |
| `src/modules/formations/formations.service.ts` | `create()`/`update()` now build their Prisma `data` via `pickFormationFields(data)` instead of spreading `req.body` directly — closes the mass-assignment gap (matches the Phase 1 BE-05 pattern used for Letters/Campaigns/Articles/Personnel). |
| `src/validators/formation.validator.ts` | Added a `slug` rule to both `createFormationValidator`/`updateFormationValidator` (optional, ≤200 chars, `^[a-z0-9]+(-[a-z0-9]+)*$`) — slug had no server-side validation at all before, even though it's now a recognized, persisted field. |
| `frontend/styles/core.css` | Root-caused and fixed the scroll-container bug: moved `overflow-x: hidden` off `main` and onto `body`. See "Architecture decision" below. |

## Database changes

**None to real content.** `phase3-stabilization-after.json` matches `phase3-stabilization-before.json` on every content table (Record 184/32 Formation/85 Armament, Entity 46, TimelineEvent 83, Translation 72, Collection 42, Relationship 28, User 1). `AuditLog` went 5→10, fully accounted for by two synthetic test fixtures created and fully deleted during verification (`ZZ-TEST Allowlist Formation`: create+update+delete = 3 entries; `ZZ-TEST Regression`: create+delete = 2 entries). A live Armament record was also incidentally re-saved with unchanged data while testing Ctrl+S fallback behavior for non-migrated modules — verified byte-for-byte intact afterward (title, slug, summary, collectionId all present).

## Fix 1 — Formations field-allowlist gap

**Root cause confirmed:** `formations.service.ts`'s `create()`/`update()` spread `req.body` straight into `prisma.record.create()`/`.update()` with no allowlist, contradicting Phase 1's report (which stated Formations was "already correct").

**Fix:** New `pickFormationFields()` allowlist, applied in both `create()` and `update()`.

**Verified live** (direct API calls, bypassing the Admin UI entirely, using the real authenticated admin token):
- `POST /api/formations` with `id`, `createdAt`, and `collectionId` injected alongside legitimate fields → server generated its own `id`/`createdAt`; injected values were silently dropped; `slug` (legitimate) passed through correctly.
- `PUT /api/formations/:id` with `type: "ARMAMENT"` and `collectionId` injected → both ignored; the record's real `type` stayed `FORMATION` and `collectionId` stayed `null`.
- `PUT /api/formations/:id` with a malformed slug (`"Bad Slug!!"`) → `422 Validation failed` from the new validator rule.
- Test fixture fully deleted afterward; zero leftover rows.

## Fix 2 — `main { overflow-x: hidden }` scroll-container bug

**Root cause:** any non-`visible` value on one overflow axis forces the CSS engine to compute the *other* axis as `auto` (a spec-defined resolution rule, not a bug in the browser) — so `main { overflow-x: hidden }` silently made `overflow-y: auto` as well, turning `<main>` into a "scroll container" for `position: sticky` and `scrollIntoView()` purposes. But `<main>` has no bounded height (nothing constrains it — not the `has-app-shell` grid's `1fr` row, not anything in the Admin shell), so it never actually scrolls; its `scrollTop` stays `0` forever while the *window* is what really moves. Every sticky/scrollIntoView call inside `<main>` was therefore computing against a scroll container that never scrolls, instead of the viewport.

**Why not a cosmetic fix:** simply re-adding `position:sticky` overrides or manually computing scroll offsets in JS would have patched symptoms without addressing why `<main>` became a scroll container in the first place — and would have left the same trap for any future sticky element added inside `<main>`, on any page, public or Admin.

**The fix:** moved `overflow-x: hidden` off `main` and onto `body`. This isn't cosmetic — it relies on a different, specific part of the CSS spec: overflow declared on `<body>` (when `<html>` doesn't itself declare a conflicting overflow, which it doesn't here) is *propagated to the viewport* by the browser rather than creating a scroll container on the `<body>` element itself. The viewport is already the default, correct target for `position: sticky` and `scrollIntoView()` — so this preserves the original horizontal-overflow guard (no wide content can create a horizontal scrollbar) while eliminating the accidental scroll container.

**Verified live:**
- `getComputedStyle(main).overflowX/overflowY` → `visible`/`visible` on both `/admin` and the public homepage.
- `document.documentElement.scrollWidth > clientWidth` → `false` (no horizontal scrollbar) on both.
- Admin tab bar: `position:sticky` now genuinely sticks — stacks correctly below the sticky topbar at every scroll position (previously never stuck at all, confirmed both before and after with instant `window.scrollTo`).
- `scrollIntoView()` on a newly-opened form panel now correctly scrolls the *window* (confirmed `main.scrollTop` stays `0`, `window.scrollY` moves, and the panel's `scroll-margin-top: 64px` — pre-existing CSS that had been silently inert — now correctly leaves the panel visible just below the sticky topbar instead of tucked underneath it).
- Public homepage: visually unchanged, no horizontal scrollbar, `main` confirmed non-scroll-container.
- `body.has-app-shell`'s CSS Grid layout (public site only, unused by Admin since Phase 2) is unaffected — `overflow` and `display: grid` are independent properties.
- Three other public-facing files (`navigation.css`'s `.sidebar`/`.site-header`, `letters.css`'s `.letter-viewer`, plus `site-policies.css` and `article.css`) also declare `position: sticky`. The sidebar/header are grid siblings of `main`, not descendants, so they were never affected either way. `.letter-viewer` (and the other two) are inside `main` on their respective pages — the same root-cause fix should resolve the same class of bug for them as a byproduct; not individually re-tested given the mechanism is uniform and already proven at the root, but flagging here rather than claiming exhaustive per-page verification.

## Re-run: full Formations regression suite

| Test | Result |
|---|---|
| Create (with the allowlist fix in place) | Pass |
| Dirty-state indicator, submit-state protection | Pass, unchanged |
| Save → dirty clears, list reloads | Pass |
| Preview modal: focus trap, focus restoration, Escape closes only the modal (form stays open) | Pass, unchanged |
| Mobile layout (375px), form open with saved data visible in list | Pass |
| Delete, zero leftover fixture | Pass |
| `tsc --noEmit` | Clean |
| Console (fresh tab, admin and public) | Clean |

## Shared infra verification (non-migrated modules)

| Test | Result |
|---|---|
| Awards: open "New Award" form, edit a field, switch to Maps tab | Switches immediately, **no** confirm() — Awards never registered a dirty guard, exactly as designed (only Formations opted in) |
| Armaments: edit an existing record, open its own preview modal | Focus trap active (`role="dialog"`, focus moved to close button) — same infra, zero code changes to `armaments-admin.js` |
| Armaments: Ctrl+S while its preview modal (no save action) is open | Falls through to the Armaments form's real submit — matches its pre-existing behavior exactly (verified the resulting record is byte-for-byte intact) |
| Armaments: Escape while its preview modal is open | Closes only the modal, form stays open, focus restored to the Preview button |
| Personnel tab | Loads and renders correctly (46 records, 3 pages) |

## Newly discovered issues

None beyond what's already documented above. No new architectural problems surfaced during this pass.

## Is the shared architecture ready for the remaining 10-module migration?

**Yes.** Both stabilization items are resolved at the root, not patched around, and the regression suite confirms:
- `admin-content-module.js`'s dirty-state, submit-protection, validation, and repeatable-group patterns hold up under a second, more adversarial round of testing (direct API mass-assignment attempts, malformed input).
- `admin-modal-stack.js` and `admin-dirty-guard.js` are proven to work correctly for modules that never call into them — confirmed via Awards (no dirty guard) and Armaments (preview modal, Ctrl+S fallback) with zero changes to either module's own code.
- The scroll-container fix removes a foundational CSS bug that would otherwise have kept undermining `position: sticky` and auto-scroll for every module migrated afterward, Admin-wide.

No outstanding blockers. Awaiting your approval before starting the next migration batch — and your call on how many modules to include in it (single module for another incremental proof point, vs. a larger batch now that the pattern and infra are stabilized).
