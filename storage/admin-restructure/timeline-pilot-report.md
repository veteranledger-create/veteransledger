# Phase 4 — Admin/CMS Restructure — Timeline Pilot Migration Report

**Date:** 2026-08-15
**Scope:** Migrate Timeline onto `createContentModule()`. Inspect NSDAP; **not migrated — does not fit this factory's abstraction (see §6)**.

Per your explicit pilot-first instruction, this batch migrates and fully verifies **one** of Timeline/NSDAP before touching the other. Timeline was chosen because it genuinely fits the CRUD-list-of-records pattern this factory generalizes; NSDAP does not (see §6) — forcing it in would have been the wrong call, not a matter of adding one more hook. **Stopping here, as instructed — NSDAP migration is not started.**

---

## 1. Architecture inspection findings

Timeline (`TimelineEvent` — its own Prisma model, not `Record` or `Entity`) is structurally close to every other migrated module, but with real differences from the established pattern, found by reading the full stack before writing any code:

1. **No pagination.** `timeline.service.ts`'s `list()` returned a bare array (`prisma.timelineEvent.findMany(...)`), not the `{data, total, page, limit, pages}` envelope every other module's list endpoint returns — and `createContentModule()`'s `loadList()` hard-requires that envelope shape. Every other migrated module already has this; Timeline's original code simply never needed it because nobody had added pagination to it. Not a deliberate design difference worth preserving as a permanent quirk.
2. **A delete button lives in the form itself** (`timeline-delete-btn`, in the panel header, shown only while editing an existing event), not only in each list row — the one genuinely new UI pattern among all modules migrated so far.
3. **No preview at all** — no `/api/timeline/:id/preview` route, no generator, no conformance checker. `createContentModule()` already treats preview as fully optional (`id("preview-btn")` is looked up defensively everywhere), so this needed no factory change — just omitting `renderPreview`/the preview HTML from Timeline's config, which its markup already didn't have.
4. **No media** — Timeline's metadata has never included `gallery`/`documents`; confirmed by reading both the admin JS and the schema. No `extraDraftKeys`, no media wiring needed.
5. **A required-field cross-check**: "at least Year or Start Date" — not enforceable by a single `required` attribute, handled via the factory's existing `validate` hook.
6. **The metadata wholesale-replace bug** (found in Campaigns → Articles/Letters → Awards/Maps/Political Docs) — turned out to affect Timeline too. `toDbData()` builds a full-replacement object including `metadata` with no merge. Discovered by inspection before migrating, exactly the pattern your instructions asked me to check for in every module ("use... metadata merge protection").

None of these required forcing Timeline into a shape it doesn't have — they required either a small, precedented backend change (pagination — matching what nine other modules already do) or a genuinely reusable factory addition (the optional delete button — see §2). Both were the right scope of change, not workarounds.

---

## 2. Files changed

**Backend:**
- `src/modules/timeline/timeline.service.ts` — `list()` now accepts `page`/`limit` and returns the standard paginated envelope (same `skip`/`take`/`count` pattern as every other module's `list()`); `update()` now merges metadata via the existing `mergeMetadata()` helper (import + one conditional block, identical pattern to Campaigns/Articles/Letters/records.service.ts — no new implementation).
- `src/modules/timeline/timeline.controller.ts` — `list()` reads `page`/`limit` from the query string (default `1`/`50`), matching every other controller.
- `src/validators/timeline.validator.ts` — added `page`/`limit` validation to `listTimelineValidator`, matching every other list validator.

**Frontend:**
- `frontend/pages/Admin/admin-content-module.js` — added optional `${idPrefix}-delete-btn` support: shown/hidden in `openForm()` based on new-vs-editing (mirroring Timeline's own prior logic exactly), wired to a new `deleteCurrentAndClose()` that deletes the currently-open record and closes the form on success (bypassing the dirty-discard confirm, since there's nothing left to discard). `deleteRecord()` now returns a boolean success flag (existing callers that ignore the return value are unaffected). Doc comment updated to record this as a real, reusable extension point, not a Timeline-only patch.
- `frontend/pages/Admin/timeline-admin.js` — rewritten on `createContentModule()`.

No HTML changes were needed — Timeline's existing markup already matched the required `${idPrefix}-*` id convention exactly, including the one new element (`timeline-delete-btn`) the factory now knows how to use.

---

## 3. Module-specific behavior preserved

- Year auto-derivation when left blank but a Start Date is set (`new Date(dateRaw).getFullYear()`) — verified live (created an event with only a date; `year` was correctly auto-set from it).
- The "Year or Start Date required" cross-field rule — verified live: submitting with neither produced the exact original error message, and **no network request was sent at all** (blocked client-side, confirmed via the network log).
- Year/category filters (Timeline has no search-by-text filter, unlike most other modules — preserved as-is, not added).
- Sources / Related Records repeatable groups, using the same shared `admin-form.js`/`admin-related.js` components every other module uses.
- The in-form Delete button's exact visibility rule and post-delete behavior (close the form, refresh the list).
- No preview button, no media sections — both correctly absent, not stubbed in.

---

## 4. A pre-existing bug found, NOT fixed (flagged, per standing instruction)

While testing a real create, `summary` was typed into the form, sent by the frontend, but read back as `null`. Traced the cause: **`timeline.service.ts`'s `EventInput` interface and `toDbData()` have never included `summary` at all**, even though `TimelineEvent.summary` is a real schema column and the Admin form has always had a Summary field. This means the Summary field has never actually persisted anything, for any of the 83 existing timeline events, via the Admin UI — a genuine, pre-existing silent-data-loss bug, unrelated to and unintroduced by this migration (the original bespoke frontend sent the same `summary` value; the loss has always happened purely on the backend). Not fixed — flagging per the standing "document, don't silently fix" rule that's applied to every other out-of-scope finding this whole engagement. Candidate for a small, separately-scoped follow-up (`toDbData()` needs one added line: `summary: data.summary ?? null,` plus adding `summary` to the `EventInput` interface — trivial once approved).

---

## 5. Tests performed — all via the real Admin UI

- **List + pagination**: loaded the real 83 events, confirmed "83 event(s) · page 1 of 2"; clicked Next → page 2 of 2 loaded correctly with different events. This is genuinely new behavior (pagination controls didn't exist before) — see §7.
- **Filters**: year filter (`1933` → 6 events) and category filter (`military` → 45 events) both correct.
- **Validation**: title-only submit correctly blocked with the exact original message, zero network requests sent.
- **Create**: full event with date/category/location/summary/significance/a source → `201`; verified `date` landed at exactly `1936-03-07T00:00:00.000Z` (UTC midnight, no drift) and `year` was correctly auto-derived from the date.
- **Edit-repopulate**: reopened the created event — title/year/date/category/location/significance/source all correctly reloaded (summary correctly empty, per §4's pre-existing bug).
- **Dirty-state**: editing a field correctly set `.is-dirty`.
- **In-form Delete button**: correctly hidden for a new record, correctly shown once editing; clicking it (confirmed) deleted the record and closed the form — verified gone via direct DB read.
- **Metadata-merge integration**: seeded a fixture with unmanaged metadata (`custom_future_field`, `casualty_estimate` — neither exists in any code path), edited `category` via the real UI, saved: category changed correctly, both unmanaged fields and `sources`/`date` survived byte-identical.
- **Translations panel**: loads correctly (`entityType: "timeline_event"`).
- **Tab-switch dirty guard**: declining the "unsaved changes" prompt correctly blocked leaving the Timeline tab; accepting allowed it.
- **Cleanup**: all `ZZ-TEST-*` fixtures and their translations deleted; global sweep confirmed zero remainder.
- **Batch-wide spot-check**: all 11 Admin tabs (including NSDAP, untouched) clicked with zero console errors; fresh public-site console clean.
- `tsc --noEmit`: clean.

---

## 6. NSDAP — inspected, not migrated

NSDAP is **not a CRUD list of records** — it's a fixed-file site-content editor: a hardcoded sidebar of ~23 JSON keys (`nsdap/overview.json`, `nsdap/hitler/bio.json`, etc.), each loaded/saved individually through the generic `/api/site-content?key=...` GET/PUT endpoint — the same system backing the (also not part of this migration effort) "Content Pages" and "Homepage" tabs. Three files get bespoke structured editors (overview/timeline/glossary); the rest get a raw-JSON textarea with client-side parse validation. There is no create/delete of items, no list of "records" with IDs — the whole `createContentModule()` abstraction (open a record by id, list with pagination, delete a row) has nothing to attach to here. Migrating NSDAP onto this factory would mean forcing a fundamentally different content-management pattern into a shape built for something else — exactly the case your instructions said not to force. **Recommendation: leave NSDAP as-is; if it's ever restructured, it should follow whatever pattern eventually gets applied to Content Pages/Homepage, not this one.**

---

## 7. Database before/after

| Table | `timeline-pilot-baseline` (before) | `timeline-pilot-final` (after) |
|---|---|---|
| Record total | 184 | 184 |
| Entity | 46 | 46 |
| TimelineEvent | 83 | 83 |
| Translation | 72 | 72 |
| Collection | 42 | 42 |
| Relationship | 28 | 28 |
| MediaAsset | 0 | 0 |
| AuditLog | 44 | 44 |

**Zero drift on every table**, including the real 83 timeline events (untouched, verified by count and by browsing them in the list). `timeline.service.ts` doesn't write audit-log entries (a pre-existing characteristic, unchanged), so the ZZ-TEST create/edit/delete cycles produced no audit entries, consistent with that.

---

## 8. Console / TypeScript status

- `tsc --noEmit`: clean.
- Fresh Admin console (all 11 tabs, including NSDAP): zero errors.
- Fresh public-site console: zero errors.

---

## 9. Remaining risks / findings

1. **Timeline's Summary field has never persisted** (§4) — pre-existing, not fixed, flagged for a future separately-scoped task.
2. **Pagination is now visible where it wasn't before** — a deliberate, disclosed consequence of adopting the shared list architecture (§1.1), not an accidental behavior change. With 83 events and `pageSize: 50`, the Admin now shows 2 pages instead of one long list. Nothing is hidden or lost — Next/Prev work correctly — but this is a visible UI change worth your awareness.
3. **`personnel.service.ts` has the identical metadata wholesale-replace bug — confirmed live and currently affecting real data.** While writing this report I checked the one Record/Entity-backed service that had never actually been verified for this pattern (Batch 1 shipped it before the Campaigns incident surfaced the bug class at all). `personnel.service.ts`'s `update()` passes allowlisted fields straight into `prisma.entity.update()` with no merge — same defect. **This is not theoretical**: `personnel.generator.ts` has the same catch-all `extras` passthrough as `campaigns.generator.ts`, explicitly documented in its own source comment as carrying "kills, tank_kills, ships_sunk/tonnage_sunk, aircraft, vehicles." A read-only check just now confirms **14 of the 46 real Personnel entities currently have such fields** — e.g. Erich Topp (`ships_sunk: 35, tonnage_sunk: 197460`), Günther Prien, Joachim Schepke, Otto Kretschmer, Wolfgang Lüth, and 9 others. **The next time any admin opens and saves any of these 14 records through the live Admin UI, those combat-statistics fields will be silently destroyed.** This is more urgent than the Awards/Maps/Political Docs case (which had zero real records at risk) — it's the closest parallel to the original Campaigns incident, except discovered before an accident rather than after one. **Not fixed here** — flagging prominently and stopping, per the standing "document, don't silently fix" rule, since fixing it wasn't part of this round's authorized scope. Given the live risk, recommend treating this as the next priority ahead of further module migrations.
4. **NSDAP is not migrated and, per §6, should not be forced onto this factory** — it needs its own, different approach if it's ever restructured.

---

**Timeline pilot is complete and fully verified. Per your instruction, stopping here — NSDAP is not migrated. Do not declare the Admin restructuring complete; two tabs (NSDAP, and whatever Content Pages/Homepage need) remain outside this factory's scope by design, not by omission.**
