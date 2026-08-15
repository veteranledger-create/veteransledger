# Phase 4 — Admin/CMS Restructure — Batch 3 Report

**Dates:** 2026-08-14 to 2026-08-15
**Scope:** Migrate Campaigns and Articles onto `createContentModule()`, per the architecture established in Batches 1-2.

This batch had an eventful middle: a real production record ("Battle of Britain") was accidentally deleted by a test-tooling bug during Articles testing, which led to discovering and fixing a pre-existing metadata wholesale-replace defect (found in Campaigns, then confirmed to also affect Articles, Letters, and the generic Awards/Maps/Political Docs backend) and a pre-existing bare-date save-failure defect (found affecting Campaigns, Personnel, Letters, and Political Docs). All of that is documented in full elsewhere and only summarized here; this report focuses on the migration itself and its now-complete verification. Full incident/fix history:
- [`batch3-incident-and-fix-report.md`](batch3-incident-and-fix-report.md) — the deletion, the recovery, the metadata-merge fix for Campaigns/Articles/Letters
- [`battle-of-britain-recovery-preview.md`](battle-of-britain-recovery-preview.md) — the exact-value restore plan that was executed
- [`task50-bare-date-fix-report.md`](task50-bare-date-fix-report.md) — the shared date-normalization fix
- [`records-metadata-fix-report.md`](records-metadata-fix-report.md) — extending the metadata fix to Awards/Maps/Political Docs

---

## 1. Modules migrated

| Module | idPrefix | apiBase |
|---|---|---|
| Campaigns | `campaign` | `/api/campaigns` |
| Articles | `article` | `/api/articles` |

Both are dedicated-module-pattern services (like Batch 1's Armaments/Personnel/Letters), not the generic-records pattern from Batch 2. No HTML restructuring was needed for either — both already used the `.form-actions` + separate `published-toggle` + `section-label--panel` title pattern, matching Armaments/Personnel/Letters, not the newer `.form-bottom-row` pattern from Formations/Awards/Maps/Political Docs.

---

## 2. Module-specific behavior preserved

**Campaigns:**
- Theater select (`KNOWN_THEATERS`), dual date storage (`startDate`/`endDate` as top-level Prisma columns for `orderBy`, *and* `metadata.dates.{start,end}` for the conformance checker + public generator — both kept in sync on every save, exactly as the original bespoke code did).
- Context/significance/outcome long-text fields, sources, related records, gallery, documents.
- List view shows a Theater badge and Start-date column; sorts by `startDate asc` (not `createdAt`, unlike most other modules).

**Articles:**
- Category select, block-based body editor (`admin-body-editor.js` — paragraph/heading/quote/list/image blocks), sources, related records, gallery, documents.
- No date field at all — confirmed by inspection, not assumed, so Task #50's date-normalization work has no surface area on Articles.

No new `createContentModule()` hooks were required for either module — both fit the existing `populateForm`/`serializeForm`/`renderPreview`/`repeatableGroups`/`extraDraftKeys` contract cleanly, same as every dedicated-module-pattern migration before them.

---

## 3. Security/data-integrity findings (full detail in the linked reports)

1. **Metadata wholesale-replace** — `campaigns.service.ts`'s `update()` (and, it turned out, `articles.service.ts`, `letters.service.ts`, and `records.service.ts`) replaced the entire `metadata` JSON column with only the fields the Admin form manages, silently destroying anything else. Fixed once, as a single shared `mergeMetadata()` helper (`src/utilities/metadata-merge.ts`), applied identically to all four Record-backed services — no hardcoded field list, so it protects fields that don't exist yet, not just currently-known ones.
2. **Bare-date save failures** — `<input type="date">` sends a bare `YYYY-MM-DD` string that Prisma's `DateTime` parser rejects with a raw 500. Fixed once, as a shared `normalizeDateInput()`/`normalizeDateFields()` utility (`src/utilities/date-normalize.ts`), applied to every date field across Campaigns, Letters, Political Docs, Personnel, and refactored into Timeline (which already had its own correct-but-duplicate version). A related defect — clearing a date silently didn't clear it — was fixed alongside it.

Both fixes are now verified, independently and in combination, via the real Admin UI, for every module that has either concern: Campaigns (both), Articles (metadata only, no dates), Letters (both), Personnel (dates only), Political Docs (both), Awards/Maps (metadata only, no dates in their forms), Timeline (dates only, pre-existing correct behavior preserved).

---

## 4. Tests performed

**Campaigns** (full regression completed pre-incident, 2026-08-14; metadata/date fixes verified live multiple times since, including twice against the actual restored Battle of Britain record — see linked reports for that detail). This session's final confirmation: one fresh, dedicated CRUD cycle through the real Admin UI —
- Create with `startDate` (`1943-07-10`) + metadata (theater, context, summary) → `201`, exact date stored (`1943-07-10T00:00:00.000Z`).
- Edit (`significance` added) → `200`, `context`/`theater`/dates all preserved untouched.
- Delete → confirmed removed.

**Articles** (regression never completed pre-incident — interrupted by the deletion incident before it could run; completed in full this session):
- Create with title/category/summary + a body-editor paragraph block → `201`; verified stored correctly (`metadata.body` array, `category`, etc.).
- Preview → modal opens (`role="dialog"`, confirming shared modal-stack infra), correct rendered content and JSON.
- Focus trap → confirmed focus was inside the modal before close; modal closes cleanly.
- Translations panel → loads correctly for the record.
- Dirty-state → editing a field correctly sets `.is-dirty` on the form panel.
- Cancel-discard → confirmed the unsaved edit was *not* persisted after Cancel + confirm.
- Edit-repopulate → reopening the record correctly restored title, category, summary, **and the body-editor block content** (the one field type unique to Articles, and the trickiest to get right since the block editor has no `name` attributes for `FormData`).
- Metadata-merge integration → injected two unmanaged metadata fields directly (simulating a future import/admin-field addition), then edited `category` through the real UI and saved: category changed correctly, and both unmanaged fields plus the untouched `body` field survived byte-identical.
- Delete → confirmed removed via the real Delete button + confirm dialog.
- Global sweep after both modules' testing: zero `ZZ-TEST-*` records, zero `ZZ-TEST-*` translations, `MediaAsset` count still 0.

**Batch-wide:**
- All 11 Admin content tabs (Campaigns, Articles, Letters, Personnel, Formations, Armaments, Timeline, NSDAP, Awards, Maps, Political Docs) clicked in a fresh tab — zero console errors.
- Fresh public-site console check — zero errors.
- `tsc --noEmit` — clean.

---

## 5. Database before/after

| Table | `batch3-resume-baseline` (before this session's work) | `batch3-complete-final` (now) |
|---|---|---|
| Record total | 184 | 184 |
| Record byType (Formation/Armament/Article/Campaign/Letter) | 32/85/8/35/24 | 32/85/8/35/24 |
| Entity | 46 | 46 |
| TimelineEvent | 83 | 83 |
| Translation | 72 | 72 |
| Collection | 42 | 42 |
| Relationship | 28 | 28 |
| MediaAsset | 0 | 0 |
| AuditLog | 44 | 44 |

**Zero drift on every table**, including AuditLog — neither `campaigns.service.ts` nor `articles.service.ts` write audit-log entries (a pre-existing characteristic of these two services, confirmed earlier and unchanged by this work), so this round's create/edit/delete cycles for both modules produced no audit entries, consistent with that established behavior.

---

## 6. Batch 3 — complete

Campaigns and Articles are both fully migrated, regression-tested, and verified to work correctly with the metadata-merge and date-normalization fixes now in place across the whole Record-backed service layer. Combined with Batches 1-2, migrated modules are now: **Formations, Armaments, Personnel, Letters, Awards, Maps, Political Docs, Campaigns, Articles** — 9 of 11 content modules. Remaining: **Timeline, NSDAP**.

Not touched this batch, as instructed: the public localization system, publish/import/recovery pipeline, Translation architecture, Community module.

Proceeding next to inspecting Timeline and NSDAP, per your instruction, before choosing one to pilot.
