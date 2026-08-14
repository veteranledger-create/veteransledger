# Phase 4 — Admin/CMS Restructure — Batch 2 Report

**Date:** 2026-08-14
**Scope:** Migrate Awards, Maps, and Political Documents onto the shared `createContentModule()` architecture established in Batch 1 (Formations/Armaments/Personnel/Letters).

---

## 1. Modules migrated

| Module | idPrefix | apiBase | fixedListParams |
|---|---|---|---|
| Awards & Decorations | `award` | `/api/records` | `{ type: "AWARD" }` |
| Maps | `map` | `/api/records` | `{ type: "MAP" }` |
| Political Documents | `poldoc` | `/api/records` | `{ type: "POLITICAL_DOCUMENT" }` |

All three share one backend: the generic `/api/records` endpoint (`records.service.ts`), dispatching behavior by `type`. This is architecturally different from Batch 1's dedicated-module pattern (Formations/Armaments/Personnel/Letters each have their own `/api/{type}` route), which is why they were grouped into one batch — inspection confirmed they're one coherent, low-risk unit.

Zero pre-existing Award/Map/PoliticalDocument records existed in the database before this batch, so all functional verification relied on synthetic `ZZ-TEST-*` fixtures rather than real-data cross-checks.

---

## 2. Files changed

- **`frontend/pages/Admin/admin-content-module.js`** — added `fixedListParams` config option (query params always sent with the list request, independent of filter UI state). Required because Awards/Maps/Political Docs all hit the same `/api/records` endpoint and must pin `type` on every list call, not just when a filter has a value.
- **`src/utilities/allowlist.ts`** — added `pickGenericRecordFields()`, restricting the generic-records endpoint's accepted `type` values to `AWARD | MAP | POLITICAL_DOCUMENT` (the subset this UI actually manages), distinct from the full 11-value `Record.type` enum.
- **`src/modules/records/records.service.ts`** — added the allowlist to `create()`/`update()` (see §3, security fix) plus a clean-400 guard on missing/invalid `type`.
- **`frontend/pages/Admin/awards-admin.js`** — rewritten on `createContentModule()`.
- **`frontend/pages/Admin/maps-admin.js`** — rewritten on `createContentModule()`.
- **`frontend/pages/Admin/political-docs-admin.js`** — rewritten on `createContentModule()`.

No HTML changes were required — Awards/Maps/Political Docs already used the `.form-bottom-row` footer pattern in `Admin/index.html`, consistent with Batch 1.

Shared infrastructure reused unchanged: `admin-modal-stack.js`, `admin-dirty-guard.js`, `admin-media.js`/`admin-media-sections.js`, `admin-related.js`, `admin-form.js`, `translations-panel.js`.

---

## 3. Security finding: generic-records field allowlist gap

**Discovery:** Mandated in the "check for security/data-integrity issues" inspection step, before any code was written for this batch.

**Root cause:** `records.service.ts`'s `create()`/`update()` previously spread the client-supplied request body directly into `prisma.record.create()`/`.update()` with **no allowlist at all**. This was a broader gap than the one fixed in Formations during earlier phases — because `Record.type` is validated by `record.validator.ts` against the *full* 11-value enum (`AWARD, MAP, POLITICAL_DOCUMENT, ARMAMENT, LETTER, ARTICLE, CAMPAIGN, ...`), a client could submit `type: "ARMAMENT"` (or any other type) through the Awards/Maps/Political-Docs admin UI's `/api/records` endpoint and have it accepted, since the validator's job is only to check the value is *a* valid Record type, not that it's one of the three this generic endpoint is meant to manage. Fields like `id`, `createdAt`, `collectionId` were also unvalidated and unfiltered.

**Decision process:** I raised this via `AskUserQuestion` ("fix now" vs. "document only, defer"); the question went unanswered. Per standing operating guidance to make the reasonable call rather than block indefinitely, I proceeded with the fix — same pattern already established and verified for Formations — and documented the decision here as instructed.

**Fix:**
- `pickGenericRecordFields()` allowlists `title, summary, published, metadata, date` (the legitimate content fields) plus a specially-guarded `type`, which is only carried through if it's one of `AWARD | MAP | POLITICAL_DOCUMENT`.
- `records.service.ts`'s `create()`/`update()` now route all input through this allowlist.

**Secondary fix (in-scope, direct consequence of the above):** filtering out an invalid/spoofed `type` left `fields.type` undefined, and since `Record.type` is a required non-nullable Prisma field, this produced a raw, unhandled Prisma 500 rather than a clean rejection. Added `if (!fields.type) throw new AppError(400, "type must be one of AWARD, MAP, POLITICAL_DOCUMENT.")` before the Prisma call in `create()`. This was treated as part of the same fix, not a separate pre-existing bug, since it was introduced by the allowlist change itself.

**Live verification (adversarial `fetch()` tests against the running dev server):**
- `POST /api/records` with extra `id`/`createdAt`/`collectionId` fields → all silently stripped, record created with server-generated values only.
- `POST /api/records` with `type: "ARMAMENT"` → clean `400 { error: "type must be one of AWARD, MAP, POLITICAL_DOCUMENT." }` (previously a raw 500).
- `PUT /api/records/:id` with `type: "ARMAMENT"` on an existing AWARD record → type silently ignored, record's type unchanged (partial-update semantics — no crash, no type corruption).
- `type: "AWARD" / "MAP" / "POLITICAL_DOCUMENT"` → all pass through correctly, full CRUD unaffected.

All three migrated modules' `serializeForm()` functions also send an explicit `type: "X"` in the request body — this is defense-in-depth (UI clarity), not reliance on client-supplied type alone; the server-side allowlist is the actual boundary.

`records.controller.ts` and `records.routes.ts` were read but not modified — already correctly wired (`authenticate + requireAdmin` on all routes, `userId` passed through from `req.user`).

---

## 4. Module-specific behavior preserved

**Awards** (`fixedListParams: { type: "AWARD" }`)
- Fields: `title`, `summary`, `nation` (metadata), `published`.
- Repeatable groups: sources, related records.
- Media: gallery, documents (via `extraDraftKeys`).
- Populate form falls back to `r.nationality` if `metadata.nation` is absent (legacy-field compatibility, preserved as-is).

**Maps** (`fixedListParams: { type: "MAP" }`)
- Fields: `title`, `summary`, `theater` (metadata), `year` (metadata, numeric — explicit `Number(yearVal)` conversion on serialize, confirmed persisted as a real JSON number, not a string), `published`.
- Same sources/related/gallery/documents pattern as Awards.

**Political Documents** (`fixedListParams: { type: "POLITICAL_DOCUMENT" }`)
- Fields: `title`, `summary`, `signatories` (metadata, newline-separated textarea ↔ string array), `date` (top-level, conditionally set only if non-empty — same pattern as Letters/Personnel in Batch 1), `published`.
- Same sources/related/gallery/documents pattern.
- List view shows a `Date` column (`r.date.slice(0, 10)`), unlike Awards/Maps.

All three: `onInit`/`onTabActivate` wire `initMediaAdmin()`, `initRelatedModal()`, and re-register `admin-media.js`'s shared singleton callbacks (`registerCallbacks(uploadFile, setStatus)`) on every tab activation, matching the Batch 1 pattern for this shared-singleton infrastructure. `onFormOpen` re-renders blank gallery/documents sections for new records.

---

## 5. Tests performed (per module)

**Awards:** create with gallery upload (verified `/storage/images/...png` persisted in `metadata.gallery`), sources, dirty-state, Preview (focus trap, `role=dialog`), Escape (modal-only close), translations panel load, edit-repopulate (all fields + gallery + sources), tab-switch dirty guard (decline/accept), Cancel-discard (edit not persisted), delete (decline/confirm), orphaned-media cleanup, mobile responsive screenshot.

**Maps:** create (`theater`, `year` — confirmed `metadata.year: 1944` as a real number), Preview, edit-repopulate (year round-trips correctly as string in the input, number in storage), delete + cleanup, tablet responsive screenshot.

**Political Docs:** create with 2 signatories (confirmed `metadata.signatories` array), Preview (signatories rendered), edit-repopulate (signatories textarea correctly rejoined with `\n`), translations panel load, **explicit modal-aware Ctrl+S test** on a second fixture (German translation editor open, Ctrl+S routed to `tlSaveClicked`, not the main form submit — confirmed shared modal-stack Ctrl+S routing works for this module), zero orphaned translations confirmed via `GET /api/translations/record/:id` → `{}`, delete + cleanup for both fixtures, mobile responsive screenshot.

**Batch-wide (after all three migrated):**
- Full CRUD regression — pass, all three modules.
- Preview/modal/focus-trap/Escape/Ctrl+S — pass.
- Translation workflows — pass (Political Docs explicit Ctrl+S test above).
- Dirty-state/tab-switch/Cancel/beforeunload — pass.
- Responsive desktop/tablet/mobile — pass (screenshots captured for each module at a different breakpoint).
- Spot-check of non-migrated modules (Campaigns, Articles, Timeline, NSDAP) and all four Batch 1 modules (Formations, Armaments, Personnel, Letters) on a fresh tab — all tabs switch cleanly, forms open/close cleanly, zero console errors.
- `tsc --noEmit` — clean (verified after the `fixedListParams` change and again as the final step of this report, both clean).
- Fresh Admin console/network check — clean (new tab, fresh login).
- Fresh public-site console check — clean.

---

## 6. Database comparison (baseline → after)

Captured via `src/scripts/admin-restructure-baseline.ts`.

| Table | Baseline (`batch2-baseline.json`, pre-batch) | After (`batch2-after.json`, post-batch) | Drift |
|---|---|---|---|
| Record (total) | 184 | 184 | 0 |
| Record byType | FORMATION 32 / ARMAMENT 85 / ARTICLE 8 / CAMPAIGN 35 / LETTER 24 | identical | 0 |
| Entity | 46 (PERSON 46) | 46 (PERSON 46) | 0 |
| TimelineEvent | 83 | 83 | 0 |
| Translation | 72 (record 8 / site_content 64; machine 64 / human 7 / published 1) | identical | 0 |
| Collection | 42 | 42 | 0 |
| Relationship | 28 | 28 | 0 |
| User | 1 (SUPER_ADMIN 1) | 1 (SUPER_ADMIN 1) | 0 |
| MediaAsset | 0 | 0 | 0 |
| AuditLog | 16 | 30 | **+14 (expected — test activity)** |

**AuditLog reconciliation:** all 14 new entries dated 2026-08-14 (vs. the pre-existing 16 dated 2026-08-12, from Batch 1). Queried directly (`auditLog.findMany`, ordered by `createdAt`):

- 5 distinct test-fixture Record IDs, each with a matching CREATE → DELETE pair (two of them also with an UPDATE in between) = 12 entries.
- 1 test MediaAsset (gallery upload during Awards testing) with a matching UPLOAD → DELETE pair = 2 entries.
- **12 + 2 = 14**, exact match. Every CREATE/UPLOAD has a corresponding DELETE — no test artifact was left uncleaned, confirmed independently of the direct table-count comparison above.

**Record/Entity/Translation/Collection/Relationship/User/MediaAsset totals show zero unintended drift.** AuditLog's increase is fully explained by, and only by, this batch's own test/cleanup cycles.

---

## 7. Global fixture and orphan sweep (steps 11–12)

Ran directly against the database after all module testing concluded:

- `Record` rows with `title` containing `ZZ-TEST` (any type): **0**
- `Entity` rows with `name` containing `ZZ-TEST`: **0**
- `MediaAsset` rows (any): **0**
- `Translation` rows with `entityType: "record"` pointing at a non-existent Record ID: **0 orphans** (8 total record-translations, all valid — pre-existing from prior phases, none from this batch)
- `Relationship` rows with a dangling `fromId`/`toId` (not matching any Record or Entity): **0**

All clean. No leftover ZZ-TEST fixtures, no orphaned media, no orphaned translations, no dangling relationships anywhere in the database.

---

## 8. Known issues (not fixed this batch, by instruction)

- **Bare-date Prisma `DateTime` bug** (confirmed in Batch 1 for Personnel `birthDate`/`deathDate` and Letters `date`): `express-validator`'s `isISO8601()` accepts a bare `"YYYY-MM-DD"` string, but Prisma's `DateTime` coercion rejects it, causing a raw 500. **Not touched this batch**, per explicit instruction. Political Documents has a `date` field using the same conditional-set pattern as Letters (`if (dateVal) body.date = dateVal`) and is therefore suspected to share this bug — **this was not explicitly triggered or confirmed for Political Docs in this batch's testing** (testing intentionally avoided setting a date that would exercise the bug, consistent with the instruction not to touch/trigger it unnecessarily). This should be flagged as a known risk carried forward, same as Personnel/Letters.
- The generic-records allowlist gap (§3) was pre-existing prior to this batch and is now fixed; flagging here only for completeness since it was a security finding discovered during this batch's work, not something introduced by it.

---

## 9. Architectural findings

- The `/api/records` generic-endpoint pattern (Awards/Maps/Political Docs sharing one backend module keyed by `type`) is architecturally distinct from the dedicated-module pattern used by Formations/Armaments/Personnel/Letters. The new `fixedListParams` factory option was the only architectural addition `createContentModule()` needed to support this pattern — everything else (dirty-state, modal stack, media, translations, validation/error handling) worked unchanged.
- This confirms the factory generalizes cleanly across both backend patterns without per-module hacks, as intended.
- Remaining not-yet-migrated modules: Campaigns, Articles, Timeline, NSDAP, plus the generic Admin infrastructure itself. No migration order has been chosen for a Batch 3 — not in scope until separately authorized.

---

## 10. Summary

**Batch 2 is complete.** Awards, Maps, and Political Documents are migrated onto `createContentModule()`. One real security gap (generic-records field allowlist, including an unrestricted `type` value) was found and fixed, with a secondary 500→400 cleanliness fix as a direct consequence. All functionality was preserved and regression-tested. Database comparison shows zero unintended drift — the only change (AuditLog +14) is fully reconciled against this batch's own test-and-cleanup activity. Global sweep confirms zero leftover ZZ-TEST fixtures, media, or orphaned records anywhere in the database. `tsc --noEmit` is clean. The known bare-date bug was left untouched as instructed, with Political Docs' shared exposure to it noted but not triggered.

Awaiting further instruction before any Batch 3 or original-Phase-4 (visual/dead-code cleanup) work.
