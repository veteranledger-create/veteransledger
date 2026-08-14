# Batch 3 — Incident Report + Fix Summary

**Date:** 2026-08-14
**Status:** All work in this report is **non-destructive** (source-code changes + read-only DB investigation). **No database write, restore, or delete has been executed.** Batch 3 (Campaigns/Articles migration) remains paused pending your review.

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

## Awaiting your direction on:

1. Whether to execute the Battle of Britain restore as previewed in `battle-of-britain-recovery-preview.md`.
2. Whether to run the fixture-based save/merge verification for the Campaigns fix (ZZ-TEST fixture only, fully cleaned up afterward) before considering it proven.
3. Whether to extend the same `mergeMetadata()` fix to `articles.service.ts` (still unshipped/mid-migration in this batch) and/or `letters.service.ts` (already shipped, currently live and at-risk).
4. Whether to resume Batch 3 (Articles regression, then the batch-wide pass) once the above are resolved.

No further action will be taken until you respond.
