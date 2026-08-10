# Phase 1 — Security & Data Integrity — Completion Report

Date: 2026-08-10. Status: **complete, all fixes verified, zero regressions found.**

## Files changed

Backend only — no frontend/UI files touched except the one-line BE-09 fix.

| File | Change |
|---|---|
| `src/utilities/prisma-errors.ts` | **New.** Shared `notFoundAs404()` helper. |
| `src/utilities/allowlist.ts` | **New.** Shared `pickRecordFields()` / `pickEntityFields()` helpers. |
| `src/modules/translations/translations.service.ts` | BE-01: added `isSourcePublished()` gate to `list()`/`get()`; internal calls from `generate()`/`update()`/`delete()` pass `includeUnpublished: true` (they're already admin-gated at the route). |
| `src/modules/translations/translations.controller.ts` | BE-01: pass `!!req.user` through to the service. |
| `src/modules/translations/translations.routes.ts` | BE-01: added `optionalAuth` to the two public GET routes; updated the stale comment. |
| `src/modules/search/search.service.ts` | BE-02: added `published` filter (skipped when `includeUnpublished`). BE-03: added missing `skip` on the entity branch; `total` now correctly sums record+entity counts. |
| `src/modules/search/search.controller.ts` | BE-02: pass `!!req.user` through. |
| `src/modules/search/search.routes.ts` | BE-02: added `optionalAuth`. |
| `src/modules/records/records.service.ts` | BE-04: `update()`/`delete()` now use `notFoundAs404()`. |
| `src/modules/letters/letters.service.ts` | BE-04 + BE-05: `update()`/`delete()` wrapped; `create()`/`update()` allowlisted. |
| `src/modules/campaigns/campaigns.service.ts` | Same as Letters. |
| `src/modules/articles/articles.service.ts` | Same as Letters. |
| `src/modules/formations/formations.service.ts` | BE-04 only (already had a correct allowlist pattern via explicit fields — audit didn't flag it for BE-05). |
| `src/modules/personnel/personnel.service.ts` | BE-04 + BE-05: `update()`/`delete()` wrapped; `create()`/`update()` allowlisted; `slug` override removed (was already dead — never sent by the real frontend). |
| `src/modules/timeline/timeline.service.ts` | BE-04: `delete()` wrapped (`update()` was already correct). |
| `src/modules/armaments/armaments.service.ts` | BE-04: `delete()` wrapped (`update()` was already correct). |
| `frontend/pages/Admin/admin.js` | BE-09: 3 unescaped `src` interpolations in the global Media Library grid now wrapped in `escHtml()`. |

Not touched: publish/import pipeline, recovery system, translation status model/provider architecture, Community module, public localization system, database schema.

## Database changes

**None.** No migration, no schema change. DB-01 produced a read-only report only (see below) — nothing was deleted.

## API changes

- `GET /api/translations/:entityType/:entityId` and `/:entityType/:entityId/:locale` — now return only published-source translations for unauthenticated callers; unchanged for authenticated admins.
- `GET /api/search` — now returns only published records/entities for unauthenticated callers; unchanged for authenticated admins. Pagination and `total` are now correct for personnel searches for everyone.
- `PUT/DELETE` on Records/Letters/Campaigns/Articles/Formations/Personnel/Timeline — now return `404 {"error": "<Type> not found"}` instead of a raw `500` with a leaked Prisma error/stack when the target row is already gone.
- `POST/PUT` on Letters/Campaigns/Articles/Personnel — silently ignore any field not in that type's legitimate content-field list (e.g. `type`, `id`, `collectionId` can no longer be set via these endpoints).

No endpoint's success-path response shape changed. No new endpoints. No endpoint removed.

## UI changes

None visible. BE-09's fix is defense-in-depth (escaping) with no behavioral difference for well-formed data, which is all that exists in the database today.

## Security implications

- **Two live, unauthenticated content-leak vectors closed** (BE-01, BE-02): draft/unpublished record content and its translations are no longer retrievable by an unauthenticated caller who has (or guesses) an entity id.
- **Internal server file paths and Prisma stack traces no longer leak on ordinary concurrent-edit 404s** (BE-04) — they only ever appeared via `config.isDevelopment` anyway (confirmed pre-existing, unchanged, correctly gated for production), but they used to leak on *every* double-delete/stale-update, not just genuine 500s.
- **Mass-assignment surface closed** on 4 endpoints (BE-05) — was latent (never exploited by the shipped frontend) but is no longer a live possibility via direct API calls.

## Tests performed & results

All verified against the exact reproductions captured in the pre-fix baseline (`storage/admin-restructure/phase1-baseline-evidence.md`), using a temporary, clearly-labeled test fixture (`ZZ-TEST-*`) created and fully deleted via the real Admin API — never real archive content.

| Test | Before | After |
|---|---|---|
| Unauthenticated GET translation of unpublished record | `200 OK`, full content | `404 Translation not found` |
| Same, with admin token | (not tested — n/a before fix) | `200 OK`, full content — **admins can still edit draft translations** |
| Unauthenticated `/api/search` for unpublished record | found it | not found (0 results) |
| Unauthenticated `/api/search` for published record (Jagdpanther) | found it | **still found it** — public search unaffected |
| Authenticated `/api/search` for unpublished record | (not tested — n/a before fix) | found it — **admin related-record picker unaffected** |
| Personnel search page 1 vs page 2 | identical results | different results |
| Personnel search `total` | `0` (wrong) | `27` (correct) |
| Double-DELETE on a Letter | `500` + leaked stack trace | `404 {"error":"Letter not found"}` |
| UPDATE on a deleted Campaign | `500` + leaked stack trace | `404 {"error":"Campaign not found"}` |
| Inject `type`/`id`/`collectionId` via Letter update | (not previously tested) | ignored; only the legitimate `title` field applied |
| Public Search page, live in-browser | — | works, returns Jagdpanther, no console errors beyond the known pre-existing benign 404s |
| Admin dashboard + tab navigation, live in-browser | — | loads correctly, 185→184 record count reflects test-fixture create/cleanup accurately |
| TypeScript compile (`tsc --noEmit`) | — | clean, zero errors |

**Zero regressions found.**

## Before / after counts

| | Before | After |
|---|---|---|
| Record | 184 | 184 |
| Entity | 46 | 46 |
| TimelineEvent | 83 | 83 |
| Translation | 72 | 72 |
| Collection | 42 | 42 |
| Relationship | 28 | 28 |
| User | 1 | 1 |
| AuditLog | 0 | 0 |
| MediaAsset | 0 | 0 |

Identical. All test-fixture creates were matched by explicit deletes (including the fixture's Translation row — Translation has no cascading FK, so it was deleted separately, precisely re-confirming DB-01's finding in practice).

## DB-01 — orphan report (read-only, no deletion performed)

**0 orphaned Translation rows found.** Full report at `storage/admin-restructure/db01-orphan-report.json`. This is a direct, retroactive confirmation that the earlier DB-recovery work's ID-preservation ("reuse `recordId` instead of a fresh cuid") correctly re-attached every translation that existed before the database reset — nothing needs to be deleted. The underlying *risk* (no FK/cascade from `Translation` to its source) is unchanged and still real for any *future* delete of a translated record; I have not added a cascade or cleanup job, since none was needed right now and that would be a schema/process decision for Phase 4's schema section, not an emergency deletion. Flagging this as something to revisit there rather than acting on it now.

## Remaining findings (not in Phase 1's scope, unchanged)

Every Medium/Low-severity finding from the original audit not listed as a Phase 1 item is still open and tracked in the published audit document — none were touched.

## Regressions discovered

None.

## Next recommended step

Proceed to **Phase 2 — Admin shell isolation** (per the approved plan) once you confirm Phase 1 is acceptable. Phase 2 is the fix for the confirmed UX-01 finding (Admin inheriting the public site's active locale) and is independent of everything touched in Phase 1.
