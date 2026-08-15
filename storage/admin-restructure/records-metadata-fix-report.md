# Awards / Maps / Political Documents — Metadata Wholesale-Replace Fix

**Date:** 2026-08-15
**Status:** Fixed, tested, verified via the real Admin UI. Batch 3 remains paused pending your review of this report.

**Scope discipline:** Task #50 (bare-date fix) was not reopened or modified — confirmed by re-reading `src/utilities/date-normalize.ts` and every file it's imported into before and after this work; none were touched. No changes were made to the public localization system, publish/import/recovery pipeline, or Translation architecture — the only Translation-table interaction below is creating/reading/deleting test rows for orphan verification, identical in kind to every prior batch's fixture testing.

---

## The fix

`records.service.ts`'s `update()` had the exact same wholesale-replace defect already found and fixed for `campaigns.service.ts`/`articles.service.ts`/`letters.service.ts`: it passed the client's `metadata` straight into `prisma.record.update()`, which replaces the `Json` column entirely rather than merging. Fixed by reusing the existing `mergeMetadata()` helper (`src/utilities/metadata-merge.ts`) — **no new implementation, no hardcoded field list**, the identical function already proven for the other three services:

```ts
async update(id: string, data: object, userId: string) {
  const fields = normalizeDateFields(pickGenericRecordFields(data), DATE_FIELDS);
  if ("metadata" in fields) {
    const existing = await prisma.record.findUnique({ where: { id }, select: { metadata: true } });
    fields.metadata = mergeMetadata(existing?.metadata, fields.metadata);
  }
  const record = await notFoundAs404(
    () => prisma.record.update({ where: { id }, data: fields as ... }),
    "Record not found",
  );
  await prisma.auditLog.create({ data: { userId, action: "UPDATE", entity: "Record", entityId: id } });
  return record;
}
```

Inserted in exactly the same position, relative to the date-normalization call, as the pattern already established in the other three services — the merge block sits between building `fields` and the `prisma.record.update()` call, untouched by and not interfering with the (already-approved, unmodified) date-normalization step immediately above it.

One file changed: `src/modules/records/records.service.ts` (added the `mergeMetadata` import and the merge block in `update()`; `create()` untouched, since a brand-new record has no prior metadata to preserve — same reasoning as the other three services).

**Note on real-world impact:** checked `awards.generator.ts`/`maps.generator.ts`/`political-docs.generator.ts` — unlike Campaigns/Articles, none of them have a catch-all "extras" passthrough for unknown metadata keys; each reads a small fixed set of fields (`nation`; `theater`/`year`; `date`/`signatories`), and all of those are already managed by their respective Admin forms. There are also currently zero real Award/Map/PoliticalDocument records in the database (confirmed in Batch 2). So this fix has no observable effect on existing data today — it's forward-looking, protecting any future admin-form field or import-added metadata key the same way the Campaigns fix already does, per your instruction to apply the general, proven approach rather than reason about current risk module-by-module.

---

## Regression test — real Admin UI, all three modules

For each of Awards, Maps, Political Documents:

1. **Created a rich `ZZ-TEST-*` fixture** directly via Prisma (the only way to seed metadata fields no admin form can set), containing both admin-managed fields and multiple unmanaged/future fields — including a `custom_future_field` key that exists in no generator, no validator, no admin form anywhere in the codebase, to prove the fix protects genuinely unknown fields, not just currently-known ones:
   - **Award**: managed → `nation`, `sources`, `related_records`, `gallery`, `documents`. Unmanaged → `custom_future_field`, `awarding_body`, `criteria`.
   - **Map**: managed → `theater`, `year`, `sources`, `related_records`, `gallery`, `documents`. Unmanaged → `custom_future_field`, `scale`, `cartographer`.
   - **Political Document**: managed → `date` (top-level column), `signatories`, `sources`, `related_records`, `gallery`, `documents`. Unmanaged → `custom_future_field`, `ratification_status`, `treaty_number`.
   - Created one German-locale translation per fixture, to verify translations survive independently of the Record-table fix.

2. **Logged into the real Admin UI**, navigated to each tab, located the fixture via the search filter (scoped to that module's own list container), **verified the target ID matched exactly before every click** — per the standing testing-safety protocol.

3. **Edited exactly one admin-managed field per module through the DOM and clicked the real Save button** (not an API call):
   - Award: `nation` — `germany` → `italy`
   - Map: `theater` — `atlantic` → `eastern-front`
   - Political Document: `date` — `1938-09-30` → `1939-03-15` (this also exercises Task #50's date normalization together with the new merge fix, in the exact real save path)

   All three saves returned `200 OK` (confirmed via the Network panel).

4. **Verified via direct DB read** — the changed field changed as expected, and **every unmanaged field, plus every managed-but-untouched field, survived byte-identical**:

   | Module | Changed field | Unmanaged fields verified preserved | Managed-untouched fields verified preserved |
   |---|---|---|---|
   | Award | `nation` → `italy` ✅ | `custom_future_field`, `awarding_body`, `criteria` — all ✅ | `sources`, `related_records` ✅ |
   | Map | `theater` → `eastern-front` ✅ | `custom_future_field`, `scale`, `cartographer` — all ✅ | `year` (1942, still a number), `sources`, `related_records` ✅ |
   | Political Document | `date` → exactly `1939-03-15T00:00:00.000Z` ✅ | `custom_future_field`, `ratification_status`, `treaty_number` — all ✅ | `signatories`, `sources`, `related_records` ✅ |

   **21/21 field checks passed.** The Political Document date result confirms Task #50's normalization and this metadata fix compose correctly with no interference in either direction — the date landed on the exact calendar day (UTC midnight, no drift) while every metadata field around it stayed untouched.

5. **All three translations confirmed unaffected** by the metadata edits (read back byte-identical before deletion).

6. **Deleted all three fixtures through the real Admin UI** — same scoped-selector-plus-ID-verification pattern for the delete button, native `confirm()` dialog handled, then confirmed via direct DB read that each record was actually gone. (One cosmetic note: the browser's network-request log showed one `DELETE` as `[FAILED: net::ERR_ABORTED]` despite returning `204` — a benign logging artifact of this test tooling, not a real failure; the direct database check is authoritative and confirmed the record was in fact deleted in every case.)

7. **Orphan check:** `Translation` has no cascade foreign key to `Record` (confirmed in the schema) — deleting a record does not automatically delete its translations, for any module, not something introduced by this fix. Explicitly deleted the three leftover translations as part of test cleanup (the same pattern followed in every prior batch's fixture testing), then ran a global sweep:
   - Zero `ZZ-TEST-*` records remaining — **PASS**
   - Zero `ZZ-TEST-*` translations remaining — **PASS**
   - `MediaAsset` count still 0 — **PASS**
   - Zero `Citation` rows referencing any of the three deleted fixture IDs — **PASS** (Awards/Maps/Political Docs don't use the Citation table at all; sources are stored as metadata JSON, same as every other Record-backed type)
   - `Relationship` table unchanged at 28 (its pre-existing baseline) — **PASS**

---

## `tsc --noEmit` and console checks

- `tsc --noEmit`: clean, both immediately after the `records.service.ts` change and again as the final step before this report.
- Fresh Admin console check (new tab, fresh login, every content tab clicked — Awards, Maps, Political Docs, Campaigns, Articles, Letters, Personnel, Formations, Armaments, Timeline, NSDAP): zero console errors.
- Fresh public-site console check (new tab, homepage): zero console errors.

---

## Database before/after

| Table | `records-metadata-fix-baseline` (before) | `records-metadata-fix-final` (after) |
|---|---|---|
| Record total | 184 | 184 |
| Record byType (Formation/Armament/Article/Campaign/Letter) | 32/85/8/35/24 | 32/85/8/35/24 |
| Entity | 46 | 46 |
| TimelineEvent | 83 | 83 |
| Translation | 72 | 72 |
| Collection | 42 | 42 |
| Relationship | 28 | 28 |
| MediaAsset | 0 | 0 |
| AuditLog | 38 | 44 |

**AuditLog +6 fully reconciled:** `records.service.ts` is the one service among the four Record-backed content services that writes audit-log entries on every create/update/delete (Campaigns/Articles/Letters do not). The three fixtures were created via direct Prisma (bypassing the service and its audit logging entirely), so only their 3 UPDATE + 3 DELETE operations — all performed through the real service via the real UI — were audited: 3 + 3 = 6, exact match. Every other table is identical before and after. **Zero unrelated production data was modified, created, or deleted.**

---

**This metadata-safety pass is complete.** Batch 3 (Articles regression, then the batch-wide pass) remains paused, awaiting your go-ahead to resume.
