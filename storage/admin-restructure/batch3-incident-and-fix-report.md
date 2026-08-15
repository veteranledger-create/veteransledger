# Batch 3 — Incident Report + Fix Summary

**Date:** 2026-08-14, updated 2026-08-15
**Status:** §§1–6 below (2026-08-14) were non-destructive prep work. §7 (2026-08-15) executed the approved restore and ran the required verification — **the restore succeeded and is confirmed intact**, but the post-restore live-save integrity check (step 4 of your instructions) **failed and was stopped immediately**, per your explicit "stop, do not repair, document" instruction. Root cause: a pre-existing, previously out-of-scope bug (bare-date strings vs. Prisma's `DateTime` type), unrelated to the metadata-merge fix. See §7.4. **Batch 3 migration remains paused. Do not resume without reviewing §7 first.**

This supersedes the earlier, less rigorous `battle-of-britain-incident-recovery-plan.md` for the recovery-preview portion — the authoritative, field-by-field preview is `battle-of-britain-recovery-preview.md` (written this round).

---

## 1. Battle of Britain recovery preview

**Full preview:** [`battle-of-britain-recovery-preview.md`](battle-of-britain-recovery-preview.md) — read-only, exact-value, field-by-field, with a confidence level and exact source cited for every field. Not summarized further here; that document is the deliverable. Highlights:

- Exact ID confirmed: `cmqnusec20019dn0e7kvy5uod` (still absent from the DB, verified read-only just now).
- Every DB column and every `metadata` key mapped to an exact value, sourced either from direct pre-deletion observation, the published archive file (`public/data/campaigns/western-front/britain.json`), or corroborating read-only queries against intact sibling records (for `collectionId` and `importRunId`, neither of which appear in the archive file at all).
- Two fields flagged as genuinely uncertain: `createdAt` (never captured, cosmetic-only impact) and `slug` (high-confidence inference from the generator's `id: record.slug ?? record.id` logic, not a direct observation).
- Confirmed zero orphaned citations, relationships, translations, or media anywhere referencing this ID — the deletion was clean, with no collateral damage elsewhere in the schema.
- Expected before/after table included, scoped to a single `record.create()` call touching only the `records` table.

**No restore has been executed.** Awaiting your explicit approval.

---

## 2. Root cause and fix — Campaign metadata wholesale-replace

### Root cause

`campaigns.service.ts`'s `update()` passed `pickRecordFields(data)` — an object built entirely from what the client (the Admin form) sent — straight into `prisma.record.update({ data: { metadata: ... } })`. Prisma's `Json` column update **replaces the value wholesale**; there is no partial/deep merge. `campaigns-admin.js`'s `serializeForm()` only ever constructs 9 `metadata` keys (`theater, dates, context, significance, outcome, sources, related_records, gallery, documents`) — it has no UI for, and therefore never echoes back, `combatants`, `phases`, `casualties`, `background`, `image`, `subtitle`, or `region_label`, all of which exist in real campaign records from the original import and are actively read by `campaigns.generator.ts` when producing the public site's JSON.

**Effect:** any admin who opened any campaign and clicked Save — for any reason — would silently strip those fields from that record, with no warning. Verified this predates my changes: I compared against the original bespoke `campaigns-admin.js` I read at the start of this batch, and its `handleSubmit` built the exact same 9-key object. **This is a pre-existing bug, not a migration regression** — migrating onto `createContentModule()` preserved it faithfully rather than introducing it.

This was discovered incidentally while tracing `campaigns.generator.ts` to build the Battle of Britain recovery preview (§1) — it is unrelated to the deletion incident itself, but surfaced by the same investigation.

### Fix

Added `src/utilities/metadata-merge.ts`, a shared `mergeMetadata(existing, incoming)` helper: a shallow merge where the incoming object's keys win (an admin editing `theater` and saving is *supposed* to change `theater`), but any key the incoming object never mentions is carried forward from the record's current metadata untouched. This is deliberately **not** a longer field allowlist — per your instruction, a longer list still drops whatever isn't on it; the merge instead makes the guarantee general, so it holds for metadata fields that don't exist yet (a future admin field, a future import) without needing another code change.

Wired into `campaigns.service.ts`'s `update()`:
```ts
async update(id: string, data: object) {
  const fields = pickRecordFields(data);
  if ("metadata" in fields) {
    const existing = await prisma.record.findUnique({ where: { id }, select: { metadata: true } });
    fields.metadata = mergeMetadata(existing?.metadata, fields.metadata);
  }
  return notFoundAs404(
    () => prisma.record.update({ where: { id }, data: fields as ... }),
    "Campaign not found",
  );
}
```
The extra read happens immediately before the write, keyed on the same `id`, so the merge is always against current state. If the record doesn't exist, the read returns `null`, the merge degrades to just the incoming object (no functional change), and the subsequent `prisma.record.update` call still 404s via the existing `notFoundAs404` wrapper exactly as before — no change to error-handling behavior for the not-found case. `create()` was not touched — a brand-new record has no prior metadata to preserve, so the bug doesn't apply there.

`tsc --noEmit`: clean.

**Fixture verification: not yet run.** Per your closing instruction ("stop after the read-only recovery preview and the non-destructive code fixes"), I've implemented and type-checked the fix but have **not** executed the create-fixture / edit-one-field / save / byte-diff verification against the live database, since that requires DB writes. I'm treating this as deferred alongside the Battle of Britain restore, pending your go-ahead — flagging explicitly rather than assuming either way, since your message included the verification steps as part of item 2's requirements but the closing line scopes this round to "read-only preview + non-destructive code fixes." Ready to run it (against a clearly labeled `ZZ-TEST-*` fixture, never a real record) the moment you confirm.

### Affected modules

| Module | Shares the wholesale-replace mechanism? | Fields at risk | Fixed this round? |
|---|---|---|---|
| **Campaigns** | Yes (confirmed, was the trigger for this investigation) | `combatants`, `phases`, `casualties`, `background`, `image`, `subtitle`, `region_label` — all read by `campaigns.generator.ts`, none managed by the admin form | **Yes** |
| **Articles** | Yes (confirmed via inspection) | `subtitle`, `author`, `image`, `tags`, `archival_note` are read by `articles.generator.ts` but not managed by `articles-admin.js`'s form; `articles.generator.ts` also has a catch-all `extras` spread for unnamed one-off fields (e.g. `nuremberg.json`'s `defendants_count`), same class of open-ended risk as Campaigns | **No — inspected and reported only, per your instruction.** `articles.service.ts` currently has the identical unguarded `update()`. Extending the same one-line fix (already exists in `metadata-merge.ts`) would be trivial if authorized — Articles is still mid-migration/unshipped in this batch, so this is squarely in scope if you want it done now. |
| **Letters** | Yes (confirmed via inspection) | `from_unit`/`unit`, `location_written`/`location`, `subject`, `context`/`historical_context`, `notes`/`archival_note`, `archive_source`, `translated` are all read by `letters.generator.ts` but **none** are managed by `letters-admin.js`'s form (only `from`, `to`, `collection`/`language`, `full_text`, `original_text` are). No catch-all extras spread in this generator, so the risk is limited to these 7 named fields, not open-ended. | **No — inspected and reported only, per your instruction.** This is Batch 1, already-shipped/approved work; `letters.service.ts` currently has the identical unguarded `update()`, live, for all 24 letters. |

I have not modified `articles.service.ts` or `letters.service.ts`. Flagging clearly: as things stand right now, saving any edit to any of the 24 Letters records or any of the 8 Articles records through the current Admin UI carries the same silent-data-loss risk Campaigns had. This is a real, live, unresolved risk on already-shipped Letters — not hypothetical.

---

## 3. Testing-safety fix

**Root cause of the Battle of Britain deletion:** `document.querySelector('[data-delete]')`, run in what I believed was an Articles-only browser-JS test, matched a stale delete button from the Campaigns list instead — because VeteransLedger's Admin tabs stay in the DOM (`hidden`, not removed) when you switch tabs, and Campaigns' tab panel precedes Articles' in markup order.

**I verified there is no equivalent risk for real users**, and I want to be explicit that I checked rather than assumed: the tab panels use the actual HTML `hidden` attribute, not just a visual CSS hide. `hidden` removes an element from rendering, from the accessibility tree, and from normal tab-key focus order — a real user clicking with a mouse or navigating by keyboard cannot focus or activate an element inside a `hidden` container. This vulnerability is specific to my own automated `document.querySelector` + `.click()` testing style, which bypasses the browser's normal interaction/visibility rules entirely. So there is **no application-code change** to make here — adding some kind of "hidden panels can't be clicked" guard to `admin-content-module.js` would be defending against a risk that doesn't exist for real users, which isn't warranted.

**The actual fix is a change to my own testing protocol, adopted and documented here:**
1. Every destructive-test selector is scoped to its module's own list container from now on — `#article-list [data-delete]`, `#campaign-list [data-delete]`, never a bare `[data-delete]` or any other unscoped selector, for any destructive action in any future testing.
2. Before confirming any destructive action in a test, I verify the target record's ID via a direct, independent API read (not by trusting which DOM element a selector happened to match) — matching your instruction not to rely on forced `confirm()` alone as the only safety layer.
3. After any page reload or tab switch during testing, I treat every other tab's last-rendered list content as untrustworthy for querying purposes, even though it's invisible, until I've either scoped past it or confirmed it's empty.

This is procedural, not a source diff — there is nothing to `git diff` for item 3.

---

## 4. Tests performed this round

- Read-only: confirmed `cmqnusec20019dn0e7kvy5uod` does not exist in `records`.
- Read-only: confirmed zero `Citation`/`Relationship`/`Translation`/`MediaAsset` rows reference that ID.
- Read-only: sampled 3 other western-front campaigns (Market Garden, Normandy, Warsaw Uprising) plus the "Western Front Campaigns" and "Africa Campaigns" collections, to corroborate `collectionId` and discover `importRunId` — neither derivable from the archive file alone.
- Read-only: confirmed the archive-vs-DB field mapping via direct reading of `campaigns.generator.ts`, `articles.generator.ts`, and `letters.generator.ts`.
- `tsc --noEmit`: clean, after the `metadata-merge.ts` addition and `campaigns.service.ts` change.
- Fixture-based save/merge verification: **not run** (requires a DB write — deferred, see §2).

## 5. Database before/after state

| Table | `batch3-baseline` (pre-incident, 2026-08-14T18:26Z) | `batch3-checkpoint` (when I discovered the issue, 19:02Z) | `batch3-post-incident-check` (just now, 19:23Z) |
|---|---|---|---|
| Record total | 184 | 183 | 183 (unchanged since checkpoint) |
| Record CAMPAIGN | 35 | 34 | 34 (unchanged) |
| Record ARTICLE | 8 | 8 | 8 (unchanged) |
| Entity | 46 | 46 | 46 |
| TimelineEvent | 83 | 83 | 83 |
| Translation | 72 | 72 | 72 |
| Collection | 42 | 42 | 42 |
| Relationship | 28 | 28 | 28 |
| AuditLog | 30 | 34 | 34 (unchanged) |
| MediaAsset | 0 | 0 | 0 |

The `Record`/`CAMPAIGN` drop from the baseline to the checkpoint (185→34, i.e. −1 real record) is the Battle of Britain deletion — no further drift of any kind between the checkpoint and now. Everything since the checkpoint has been source-code edits and read-only queries only.

## 6. Confirmation: no additional production data was modified or deleted

Verified directly, just before writing this report: the `batch3-post-incident-check.json` snapshot is **identical** to `batch3-checkpoint.json` in every table and every count. The only changes made since discovering the incident are:
- Three new files written to `storage/admin-restructure/` (this report, the recovery preview, the superseded earlier plan).
- `src/utilities/metadata-merge.ts` created.
- `src/modules/campaigns/campaigns.service.ts` edited (the merge-on-update fix).
- No other application file touched. No `INSERT`/`UPDATE`/`DELETE` executed against the database.

---

## 7. 2026-08-15 — Restore executed, verification completed, one new defect found (out of scope, not fixed)

### 7.1 mergeMetadata extended to Articles and Letters

Applied the identical pattern from §2 to `articles.service.ts` and `letters.service.ts`: both `update()` methods now read current `metadata` immediately before the write and merge the incoming save on top via the same `mergeMetadata()` helper, rather than replacing wholesale. No field list, no per-module logic — the same general fix. `tsc --noEmit`: clean.

### 7.2 ZZ-TEST fixture verification — Campaigns, Articles, Letters

Two rounds of verification were run:

**Round 1 (API-level, all three modules):** created a rich ZZ-TEST fixture per module (managed + unmanaged metadata, including a `custom_future_field` key that exists in no code path at all, to prove the fix isn't tied to any known field list), changed one admin-managed field via a direct authenticated PUT to the real `/api/{campaigns,articles,letters}/:id` endpoint (same route the Admin UI hits), re-read, and diffed every other field. **64/64 checks passed** — every unmanaged field (including `combatants`/`phases`/`casualties`/`background`/`image`/`technology`/`subtitle`/`region_label`/`importRunId` for Campaigns, `subtitle`/`author`/`image`/`tags`/`archival_note`/`custom_future_field` for Articles, `from_unit`/`location_written`/`subject`/`context`/`notes`/`archive_source`/`translated`/`custom_future_field` for Letters) survived byte-identical; the one changed field changed as expected; translations were unaffected; all fixtures and translations were deleted with zero remainder.

**Round 2 (real Admin UI, all three modules, requested explicitly):** re-ran the same test, but this time the save step went through the actual browser — logged into the real Admin UI, opened each fixture's Edit form via a selector scoped to that module's own list container with the target ID verified before the click (per the §3 testing-safety protocol), changed one field through the DOM, clicked the real Save button, and confirmed via the Network panel that the request returned `200 OK` (not the `500` recorded earlier for the unrelated date-bug incident — see §7.4). Every fixture was created **without any date field** (no `startDate`/`endDate`/`metadata.dates` for Campaigns, no `date` for Letters), specifically to keep this test isolated from the separate, out-of-scope date defect. All 3 modules × all fields: **36/36 checks passed**. Fixtures and translations deleted; global sweep confirmed zero `ZZ-TEST-*` records, zero `ZZ-TEST-*` translations, `MediaAsset` count still 0.

The metadata-merge fix is now verified for all three modules via both the backend route directly and the literal browser save path.

### 7.3 Battle of Britain restore — executed

Executed exactly as previewed in `battle-of-britain-recovery-preview.md`, via a direct `prisma.record.create()` (the only way to preserve the original `id` — the app's own `/api/campaigns` POST route deliberately cannot accept a client-supplied `id`, by design, per the Phase 1 allowlist). One correction caught during execution, not in the original preview: the archive file also has a top-level `technology` field (radar/aircraft descriptions) that passes through `campaigns.generator.ts`'s same untyped `extras` mechanism as `combatants`/`phases`/`casualties`/`background` — included in the restore rather than silently dropped, and flagged here rather than smoothed over.

**Uncertain-field decisions, as documented in the preview and applied exactly:**
- `slug: "britain"` — deterministic, not guessed: `campaigns.generator.ts` line 91 emits `record.slug ?? record.id`; the archive's `id` is `"britain"` (not the record's cuid), which is only possible if `slug === "britain"`.
- `createdAt` — deliberate policy, not a guess or a fabricated backdate: used the real restoration timestamp (`2026-08-14T19:36:40.317Z`) rather than inventing a plausible-looking historical value. `createdAt` has zero effect on any ordering or public rendering (the Campaigns list sorts by `startDate`; the generator never publishes `createdAt`), so a fabricated backdate would only add a false claim with no offsetting benefit.

**Post-restore verification (immediately after, read-only):**
- Record identity: id, type, title, theater, `startDate` (1940-07-10), `published` (true) all confirmed against pre-deletion evidence — all PASS.
- Every metadata field (`combatants`, `phases`, `casualties`, `background`, `context`, `outcome`, `significance`, `summary`, `image`, `technology`, `sources`, `related_records`) diffed against the archive file directly — 17/17 PASS. (`subtitle`/`region_label` are absent from the archive and were correctly left unset, matching every sibling western-front campaign.)
- Relations: 0 `Citation` rows, 0 `Relationship` rows referencing this id — correct, Campaigns doesn't use either table for sources/related-records (both are stored as JSON inside `metadata`, verified as the existing pattern for every sibling campaign, not a restoration artifact).
- Translations/media: 0 of each — matches pre-deletion state exactly (none existed before the deletion either).
- Duplicates: exactly 1 record with this id, exactly 1 record titled "Battle of Britain" — no duplicates created.
- Collection: correctly assigned to `cmsnkcia50012frdhuli9fqu0` ("Western Front Campaigns").

**Admin UI verification:** logged into the real Admin UI, opened the Campaigns tab. List view showed `Battle of Britain | WESTERN FRONT | 1940-07-10 | Published` — matches the captured pre-deletion evidence exactly. Opened Edit (selector scoped to `#campaign-list`, target id verified before the click): title, theater, start/end dates, summary, context, significance, outcome, all 7 related records, and all 4 sources populated correctly in the form.

### 7.4 Post-restore live-save integrity check — FAILED, stopped immediately, NOT repaired

Per your step 4, attempted a real-save-path test on the restored record itself (not a synthetic fixture): opened Battle of Britain's Edit form, appended a temporary marker to `significance`, clicked Save.

**Result: `500 Internal Server Error`.** Server log shows the exact cause:
```
Invalid value for argument `startDate`: premature end of input. Expected ISO-8601 DateTime.
```
This is the pre-existing, previously-documented, explicitly out-of-scope bare-date defect (first found in Batch 1 for Personnel/Letters, carried forward as a known risk in every report since): `<input type="date">` yields a bare `"1940-07-10"` string; `express-validator`'s `isISO8601()` accepts that bare form, but Prisma's `DateTime` type requires a full ISO-8601 datetime and rejects it — client-side, before any SQL is constructed. **This is not a defect in the metadata-merge fix.** The log shows `mergeMetadata()`'s read (`SELECT id, metadata FROM records WHERE id = ...`) executed correctly and produced a fully-correct merged payload — the request never got further than Prisma's own input validation on the unrelated `startDate` field.

Per your explicit instruction, **I stopped immediately and did not attempt a repair.** I did not touch any date-handling code. This is being reported as a separate, dedicated defect (see below), not folded into the metadata-merge fix.

**Confirmed database state after the failure (this was the first thing verified, before any further action):** the record is **completely unchanged**. `createdAt` and `updatedAt` are still identical (`2026-08-14T19:36:40.317Z` — both the original restoration instant, meaning zero writes have touched this row since the restore), `significance` contains no trace of the temporary test marker, and the metadata key count is still 15. Prisma's client-side validation rejects malformed input *before* constructing any SQL — so no partial write occurred. Re-confirmed a second time, fresh, immediately before writing this report: identical result.

**New follow-up task (separate, not to be silently fixed here):** *Battle of Britain — and any other campaign with real `startDate`/`endDate` values — currently cannot be edited and saved through the Admin UI at all.* Every save attempt on such a record will 500 until the bare-date defect is fixed as its own explicitly-scoped, explicitly-approved task. This is a live, practical blocker (not just a theoretical risk) for this specific restored record and for any of the other 34 real campaigns that have dates set, going forward, independent of and unrelated to the metadata-merge fix verified in §7.2.

### 7.5 Fresh checks

- `tsc --noEmit`: clean.
- Fresh Admin console check (new tab, fresh login, every tab clicked including Campaigns/Articles/Letters/Formations/Armaments/Personnel/Timeline/NSDAP): zero errors.
- Fresh public-site console check (new tab, homepage): zero errors.

### 7.6 Database before/after — full session

| Table | `batch3-baseline` (pre-incident) | `batch3-checkpoint` (incident discovered) | `batch3-post-restore-check` | `batch3-final-check` (now, after all fixture testing + cleanup) |
|---|---|---|---|---|
| Record total | 184 | 183 | 184 | 184 |
| Record CAMPAIGN | 35 | 34 | 35 | 35 |
| Record ARTICLE | 8 | 8 | 8 | 8 |
| Entity | 46 | 46 | 46 | 46 |
| TimelineEvent | 83 | 83 | 83 | 83 |
| Translation | 72 | 72 | 72 | 72 |
| Collection | 42 | 42 | 42 | 42 |
| Relationship | 28 | 28 | 28 | 28 |
| AuditLog | 30 | 34 | 34 | 34 |
| MediaAsset | 0 | 0 | 0 | 0 |

Record/CAMPAIGN is back to the exact pre-incident baseline (184 / 35). Every table used by the ZZ-TEST fixture rounds (Record, Translation) nets to zero — fixtures were created and fully deleted within the same session, confirmed by the direct global sweep in §7.2, not just by the aggregate count returning to baseline. `AuditLog` did not increase further this round — none of `campaigns.service.ts`/`articles.service.ts`/`letters.service.ts` write audit-log entries (a pre-existing characteristic, not something this work changed), so the fixture create/update/delete cycles and the restore itself don't appear there; this was already true in §2's findings and remains consistent.

**Confirmation: no unrelated production record was modified, created, or deleted this round.** The only real-content change in the entire database, across this whole incident, is the single restored Battle of Britain record — verified by table-count comparison, by the explicit global ZZ-TEST/orphan sweep, and by direct re-confirmation of Battle of Britain's own `createdAt`/`updatedAt`/field values immediately before writing this report.

### 7.7 Note: two scratch files were caught in an external commit

Between this report's §1–6 and §7, the working tree was committed (commit `56d0278`, authored by the repo's own git user, timestamped during a gap in this session) — this captured all of this batch's legitimate work (the admin JS migrations, the service.ts fixes, `metadata-merge.ts`, the reports/baselines) correctly, but also swept up two of my scratch debugging scripts (`src/scripts/_tmp-restore-britain.ts`, `src/scripts/_tmp-verify-restore.ts`) that should never have been committed. I've deleted both from the working tree (they were disposable, my own scratch files, not referenced anywhere) but have **not** committed that deletion or touched git history in any other way — that's left for you to handle however you prefer.

---

## Status: incident and recovery phase — mostly complete, one item blocked

**Complete:**
- Battle of Britain restored, verified against archive + pre-deletion evidence, zero duplicates, zero orphans.
- Metadata wholesale-replace bug fixed and verified for Campaigns, Articles, and Letters — both via direct API and via the real Admin UI, with a field that exists in no code path at all, proving the fix is general rather than tied to a known field list.
- Testing-safety protocol adopted and followed throughout this round (scoped selectors, ID verification before every destructive action).
- Zero unrelated production data touched, confirmed multiple ways.

**Blocked, reported separately, not fixed here:**
- The pre-existing bare-date defect now confirmed to also affect Campaigns (previously only confirmed for Personnel/Letters), and specifically blocks any future edit-and-save of the just-restored Battle of Britain record (or any other campaign with real dates) through the Admin UI. This needs its own explicitly-scoped, explicitly-approved fix before that record — or any dated campaign — can be safely edited again.

**Do not resume Batch 3 migration yet.** Awaiting your direction on:
1. Whether/when to scope and approve a dedicated fix for the bare-date defect (now confirmed across Personnel, Letters, and Campaigns; Political Docs still unconfirmed-but-suspected).
2. Whether to resume Batch 3 (Articles regression, then the batch-wide pass) now that the metadata-merge and restore work is verified complete, independent of the date-defect follow-up.
3. How you'd like the two accidentally-committed scratch files (§7.7) handled.
