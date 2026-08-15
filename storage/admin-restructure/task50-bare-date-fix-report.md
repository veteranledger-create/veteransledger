# Task #50 — Bare-Date / Prisma DateTime Save-Failure Fix

**Date:** 2026-08-15
**Status:** Fixed, tested, verified. Batch 3 remains paused pending your review of this report.

---

## Root cause

Every `<input type="date">` (and Personnel's manually-typed "YYYY-MM-DD" text field) sends a bare date-only string like `"1940-07-10"`. Tracing the full path:

1. **HTML input** → `.value` is always a bare `YYYY-MM-DD` string (native browser behavior for `type="date"`; Personnel's field is free text but the placeholder instructs the same format).
2. **Frontend serialization** (`campaigns-admin.js`, `letters-admin.js`, `political-docs-admin.js`, `personnel-admin.js`) → the bare string was passed straight into the request body, `if (val) body.field = val` — worse, this pattern **omitted the key entirely when the field was empty**, so clearing a date silently did nothing (a second, related defect — see below).
3. **API validation** (`express-validator`'s `.isISO8601()`) → **accepts** a bare date-only string, since ISO-8601 explicitly permits date-only representations. So validation passes.
4. **Service layer** → the validated-but-still-bare string was passed straight into `prisma.record.update()` / `prisma.entity.update()` with no conversion.
5. **Prisma Client** → its own stricter runtime parser requires a full ISO-8601 **datetime**, not a bare date, and throws `PrismaClientValidationError` — surfacing as a raw `500`. This is what actually broke the restored Battle of Britain record: `Invalid value for argument 'startDate': premature end of input. Expected ISO-8601 DateTime.`

One module already had this right: `timeline.service.ts`'s `toDbData()` converted every date via `new Date(dateString)` before handing it to Prisma, and `timeline-admin.js`'s frontend already sent `date: dateRaw || null` (explicit null, never omitted). Timeline was the one module NOT affected by either defect — and became the reference implementation for the fix.

A **second, related defect** existed alongside the crash: because every frontend used `if (val) body.field = val` (omit-when-empty) rather than always sending the key, clearing a date field and saving never actually cleared it in the database — the key just wasn't sent, so the old value silently survived. This is what "ensure empty date fields remain correctly nullable" in your requirements is aimed at, and it's fixed as part of the same change.

---

## Shared fix

One new utility, no per-module reimplementation: **`src/utilities/date-normalize.ts`**

```ts
export function normalizeDateInput(value: unknown): Date | null | undefined {
  if (value === undefined) return undefined;     // key absent — leave column untouched
  if (value === null) return null;                // explicit clear
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? undefined : value;
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  if (!trimmed) return null;                       // empty string — explicit clear
  const parsed = new Date(trimmed);
  return Number.isNaN(parsed.getTime()) ? undefined : parsed;
}

export function normalizeDateFields<T extends Record<string, unknown>>(fields: T, keys: readonly string[]): T {
  for (const key of keys) {
    if (key in fields) fields[key as keyof T] = normalizeDateInput(fields[key]) as T[keyof T];
  }
  return fields;
}
```

The core conversion — `new Date(trimmed)` on a bare date-only string — is exactly Timeline's existing, already-correct technique, generalized into one shared function every affected service now calls instead of reinventing (or omitting) the conversion.

**Why `undefined` for an absent key matters:** Prisma Client treats `undefined` field values as "not provided" and omits them from the generated SQL entirely (this is documented, intentional Prisma behavior). So `normalizeDateFields` only touches keys that are actually present in the allowlisted payload — an update that doesn't mention a date field at all leaves that column untouched, exactly as before. An explicit `null` (or empty string) means "clear it." A real date string becomes a proper `Date` object, which Prisma accepts natively (bypassing its stricter string parser entirely, since the value is already a resolved timestamp).

---

## Timezone verification

A **date-only** ISO string with no time component is defined by the ECMAScript Date Time String Format spec to be interpreted as **UTC midnight** — this is different from a datetime-without-timezone string, which is parsed as *local* time. So `new Date("1940-07-10")` is always exactly `1940-07-10T00:00:00.000Z`, regardless of the server's local timezone setting. This was verified empirically, not just asserted: every test below round-tripped a date and confirmed the stored/returned value was exactly `...T00:00:00.000Z` for that same calendar day — including dates spanning different months and different times of year (Feb, Jun, Aug, Sep, Oct, Nov, Dec), with zero drift in any case.

---

## Affected modules and files changed

| Module | Service field(s) | Service file | Validator file | Frontend file |
|---|---|---|---|---|
| Campaigns | `startDate`, `endDate` | `src/modules/campaigns/campaigns.service.ts` | `src/validators/campaign.validator.ts` | `frontend/pages/Admin/campaigns-admin.js` |
| Letters | `date` | `src/modules/letters/letters.service.ts` | `src/validators/letter.validator.ts` | `frontend/pages/Admin/letters-admin.js` |
| Political Documents | `date` | `src/modules/records/records.service.ts` (generic, shared with Awards/Maps) | `src/validators/record.validator.ts` | `frontend/pages/Admin/political-docs-admin.js` |
| Personnel | `birthDate`, `deathDate` | `src/modules/personnel/personnel.service.ts` | `src/validators/personnel.validator.ts` | `frontend/pages/Admin/personnel-admin.js` |
| Timeline | `date`, `endDate` | `src/modules/timeline/timeline.service.ts` | *(already correct — `{nullable:true}` already present)* | *(already correct — already sent explicit `null`)* |

**Every other Admin module was checked for `<input type="date">` and has none:** Formations, Armaments, Articles, NSDAP, Awards, Maps (the latter two share `records.service.ts`'s backend with Political Docs, so they're covered by the same fix even though their own forms don't currently send a `date`).

**Files changed, complete list:**
- New: `src/utilities/date-normalize.ts`
- Services: `campaigns.service.ts`, `letters.service.ts`, `records.service.ts`, `personnel.service.ts` (all: `normalizeDateFields()` applied to `create()`/`update()`) + `timeline.service.ts` (refactored `toDbData()` to call the same shared `normalizeDateInput()` instead of its own inline `new Date(...)` ternary — one implementation, not five)
- Validators: `campaign.validator.ts`, `letter.validator.ts`, `personnel.validator.ts` (all: `.optional()` → `.optional({ nullable: true })` on their date fields, matching Timeline's pre-existing pattern — otherwise an explicit `null` from the frontend fix below would itself fail `isISO8601()` and 422) + `record.validator.ts` (added a `date` validator that didn't exist at all before — Political Docs' `date` was previously **completely unvalidated**, any value would have passed straight through)
- Frontend: `campaigns-admin.js`, `letters-admin.js`, `political-docs-admin.js`, `personnel-admin.js` (all: changed `if (val) body.field = val` to `body.field = val || null` — always send the key, so clearing actually clears)

**Not touched, by instruction:** the metadata-merge fix (`mergeMetadata`, its wiring in `campaigns.service.ts`/`articles.service.ts`/`letters.service.ts`) — unchanged, verified untouched by re-reading the diffs before and after this work.

**Noted but not fixed (separate, unrelated, out of scope for Task #50):** `records.service.ts`'s `create()`/`update()` still passes `metadata` through with no merge — the same wholesale-replace class of bug found and fixed for Campaigns/Articles/Letters, but affecting Awards/Maps/Political Docs instead. Flagging this now since Task #50's investigation touched this file, but not fixing it — that would be re-opening the metadata-merge work you explicitly said not to change further. This is a candidate for a future, separately-scoped task if you want it addressed.

---

## Test matrix and results

Every module was tested end-to-end through the **real API routes** (controller → validator → service → Prisma), using clearly-labeled `ZZ-TEST-*` fixtures, each covering: create with a date, reload, edit to a different date, reload, clear the date, reload, delete + cleanup.

| Module | Create w/ date | Edit date | Clear date (→ null) | Reload matches | Exact calendar day | No 500s | Unrelated fields untouched |
|---|---|---|---|---|---|---|---|
| Campaigns (`startDate`) | ✅ 201 | ✅ 200 | ✅ 200, null | ✅ | ✅ | ✅ | ✅ (`theater` unaffected) |
| Letters (`date`) | ✅ 201 | ✅ 200 | ✅ 200, null | ✅ | ✅ | ✅ | ✅ (`from` unaffected) |
| Political Documents (`date`) | ✅ 201 | ✅ 200 | ✅ 200, null | ✅ | ✅ | ✅ | — |
| Timeline (`date`) | ✅ 201 | ✅ 200 | ✅ 200, null | ✅ | ✅ | ✅ | — |
| Personnel (`birthDate`) | ✅ 201 | ✅ 200 | ✅ 200, null | ✅ | ✅ | ✅ | — |

**42/42 checks passed.** All fixtures and any created entities/timeline events were deleted; a global sweep afterward confirmed zero remaining `ZZ-TEST-*` records, entities, or timeline events.

**Then, the actual incident record itself:** re-opened the real, restored Battle of Britain record (`cmqnusec20019dn0e7kvy5uod`) through the live Admin UI (selector scoped to `#campaign-list`, target ID verified before the click, per the standing testing-safety protocol), edited `significance`, saved — **`200 OK`** (previously `500`). Verified via direct DB read: `startDate`/`endDate` still exactly `1940-07-10T00:00:00.000Z` / `1940-10-31T00:00:00.000Z`, all 15 metadata keys (including `technology`/`combatants`) still present. Reverted `significance` back to its exact original text and saved again, confirming the record is now byte-identical to its restored state except for the (expected) `updatedAt` bump. This closes the loop on the original failure that started this investigation.

---

## Before / after behavior

| Scenario | Before | After |
|---|---|---|
| Create a Campaign/Letter/Political Doc/Personnel record with a real date | `500 Internal Server Error` | `201 Created`, exact date stored |
| Edit an existing dated record (any field, date untouched) | `500` (any save at all failed once a date was present) | `200 OK`, date and all other fields preserved |
| Clear a date field and save | Silently did nothing (key omitted, old value survived) | Field correctly becomes `null` in the DB |
| Send a genuinely malformed date to Political Docs | Unvalidated — anything reached the service layer | Rejected with a clean `422` (new validator) |
| Leave a date field alone during an unrelated edit | N/A (same 500 either way once any date existed) | Column untouched (key omitted → Prisma ignores it) |

---

## TypeScript / console results

- `tsc --noEmit`: clean, both immediately after the service/validator changes and again as the final step before this report.
- Fresh Admin console check (new tab, fresh login, every content tab clicked: Campaigns, Personnel, Letters, Timeline, Political Docs, Awards, Maps, Articles, Formations, Armaments, NSDAP): zero console errors.
- Fresh public-site console check (new tab, homepage): zero console errors.

---

## Database before/after

| Table | Before Task #50 (`task50-final` baseline = `batch3-final-check`) | After (`task50-final.json`) |
|---|---|---|
| Record total | 184 | 184 |
| Record CAMPAIGN | 35 | 35 |
| Entity | 46 | 46 |
| TimelineEvent | 83 | 83 |
| Translation | 72 | 72 |
| Collection | 42 | 42 |
| Relationship | 28 | 28 |
| MediaAsset | 0 | 0 |
| AuditLog | 34 | 38 |

The `AuditLog` +4 is fully explained: only `records.service.ts` (Political Docs' backend) writes audit-log entries among the five modules touched here, and the Political Docs test performed exactly 4 audited operations (create, edit, clear, delete). No other table moved. **Zero unrelated production records were modified, created, or deleted.**

---

## Git status

The two scratch debugging scripts (`src/scripts/_tmp-restore-britain.ts`, `_tmp-verify-restore.ts`) that were accidentally swept into an earlier external commit remain deleted from the working tree — confirmed via `git ls-files` that no other stray `_tmp*` file exists anywhere in the repository. Per your instruction, I have **not** committed this deletion or touched git history in any way; that's left for you.

Current `git status --short` — every entry is an intentional, accounted-for change from this session (Batch 3's metadata-merge work plus this report's date fix), nothing stray:

```
 M frontend/pages/Admin/campaigns-admin.js
 M frontend/pages/Admin/letters-admin.js
 M frontend/pages/Admin/personnel-admin.js
 M frontend/pages/Admin/political-docs-admin.js
 M src/modules/campaigns/campaigns.service.ts
 M src/modules/letters/letters.service.ts
 M src/modules/personnel/personnel.service.ts
 M src/modules/records/records.service.ts
 M src/modules/timeline/timeline.service.ts
 D src/scripts/_tmp-restore-britain.ts
 D src/scripts/_tmp-verify-restore.ts
 M src/validators/campaign.validator.ts
 M src/validators/letter.validator.ts
 M src/validators/personnel.validator.ts
 M src/validators/record.validator.ts
 M storage/admin-restructure/batch3-incident-and-fix-report.md
?? src/utilities/date-normalize.ts
?? storage/admin-restructure/batch3-final-check.json
?? storage/admin-restructure/batch3-post-restore-check.json
?? storage/admin-restructure/task50-final.json
?? storage/admin-restructure/task50-bare-date-fix-report.md
```

---

## Remaining limitations

1. **`records.service.ts`'s metadata is still wholesale-replaced** (Awards/Maps/Political Docs) — the same class of bug already fixed for Campaigns/Articles/Letters, noted above, deliberately not touched here since it's metadata-merge territory, not date territory. Recommend a separate, explicitly-scoped task if you want it addressed.
2. **Articles has no date field**, so it was never affected by this defect and needed no changes — confirmed by inspection, not assumed.
3. This fix addresses the *save* path only. It does not retroactively touch any already-stored date values — none were at risk, since the crash always prevented a bad write from completing (confirmed in the original incident: Prisma's client-side validation rejects malformed input before any SQL is sent, so there was never a partial or corrupted write to begin with).

---

**Task #50 is complete.** Batch 3 (Articles regression + batch-wide pass) remains paused, awaiting your go-ahead to resume.
