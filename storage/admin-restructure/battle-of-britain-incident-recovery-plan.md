# Incident Report + Read-Only Recovery Plan — "Battle of Britain" Campaign Deletion

**Date:** 2026-08-14
**Status:** Investigation complete. **No database write has been performed.** Awaiting explicit approval before any restore action.

---

## 1. What happened (root cause)

While testing the newly-migrated Articles module's delete-confirm flow, I ran this browser-JS test:

```js
window.confirm = () => false;
document.querySelector('[data-delete]').click();   // intended: my ZZ-TEST article fixture's delete button
...
window.confirm = () => true;
document.querySelector('[data-delete]').click();   // intended: same
```

`document.querySelector('[data-delete]')` is **unscoped** — it returns the first matching element anywhere in the document, not just the visible Articles panel. VeteransLedger's Admin tabs stay in the DOM when you switch tabs (each panel is just toggled `hidden`, never removed), and in `Admin/index.html`'s markup order the **Campaigns tab panel comes before the Articles tab panel**. Moments earlier, I had reloaded the page for a responsive-layout check and reopened the Campaigns tab with **no search filter**, which rendered the full, unfiltered Campaigns list (real production data) into `#campaign-list` before I switched to Articles. That list — including its own `[data-delete]` buttons — remained in the hidden `#tab-campaigns` panel.

So `document.querySelector('[data-delete]')`, run from what I believed was Articles-only context, actually matched the **first row's delete button in the hidden Campaigns list**, not my Articles fixture. With `confirm()` forced to `true` for the test, that deleted a real Campaign record. (My actual ZZ-TEST article fixture was confirmed unaffected — `confirmTotal: 1` — which is what first tipped me off that something was wrong; I then correctly scoped the selector to `#article-list [data-delete]` and successfully cleaned up the real fixture afterward.)

**This was a test-tooling mistake on my part, not an application bug.** The application's delete confirmation, dirty-state guards, and CRUD logic all behaved correctly throughout — I aimed a delete at the wrong DOM node.

## 2. What was deleted — verified identity

| Fact | Value | Source |
|---|---|---|
| Record ID | `cmqnusec20019dn0e7kvy5uod` | `public/data/campaigns/western-front/britain.json`'s `recordId` field |
| Slug | `britain` (high confidence, derived below) | see reasoning below |
| Title | `Battle of Britain` | Directly observed pre-deletion, in my first (untouched) list-view capture of the Campaigns tab, AND matches archive |
| Theater | `western-front` → badge "WESTERN FRONT" | Directly observed pre-deletion (list badge) AND matches archive |
| Start date | `1940-07-10` | Directly observed pre-deletion (list column) AND matches archive |
| Published | `true` | Directly observed pre-deletion ("Published" badge) |
| Type | `CAMPAIGN` | Certain (was in the Campaigns list) |

**On the ID:** `cmqnusec20019dn0e7kvy5uod` follows the exact same `cmqnuse...` cuid prefix as every other campaign from the original 2026-08-10 seed batch I inspected during this incident (e.g. `cmqnusebr...` = Monte Cassino, `cmqnusecm...` = Warsaw Uprising) — consistent with genuinely being part of that same seeded batch, not a fabricated or mismatched value.

**On the slug:** `campaigns.generator.ts`'s `toCampaignJson()` sets the published JSON's `id` field to `record.slug ?? record.id` (line 91). The archive file's `id` is `"britain"` — a human-readable slug, not the cuid. Since `record.id` for this row is the cuid (`cmqnusec2...`), the *only* way the generator would have emitted `"britain"` as `id` is if `record.slug === "britain"`. This is a **derived, not directly observed**, fact — solid but one inference removed from certainty.

**Direct confirmation queries run (read-only), all against the live DB:**
- `record.findUnique({ where: { id: "cmqnusec20019dn0e7kvy5uod" } })` → `null` (confirms deletion)
- `citation.findMany({ where: { recordId: "cmqnusec20019dn0e7kvy5uod" } })` → 0 rows
- `relationship.findMany({ where: { OR: [{fromId: ...}, {toId: ...}] } })` → 0 rows
- `translation.findMany({ where: { entityType: "record", entityId: "cmqnusec20019dn0e7kvy5uod" } })` → 0 rows
- `mediaAsset.findMany({ where: { records: { some: { id: "cmqnusec20019dn0e7kvy5uod" } } } })` → 0 rows

**Zero orphaned citations, relationships, translations, or media** reference this ID. The deletion was clean — no collateral dangling references anywhere else in the database. (This is also consistent with `campaigns.service.ts`'s `delete()` not calling `prisma.auditLog.create()` at all — unlike `records.service.ts`, which I added audit logging to in Batch 2, `campaigns.service.ts` and `articles.service.ts` were never instrumented with audit logging, which is *why* I had to reconstruct this from DB inspection rather than reading it straight out of the audit log.)

## 3. Source data found — and its actual reliability

`public/data/campaigns/western-front/britain.json` is the **currently-published, public-facing archive JSON** for this record (referenced by both `public/data/campaigns/campaigns.archive.json`'s manifest and `storage/publish-history/campaigns.json`). It contains a rich object: `dates`, `combatants` (axis/allied commanders + strength), `phases` (3 phases with descriptions), `casualties`, `background`, `context`, `outcome`, `significance`, `summary`, `image`, `sources` (4 entries), `related_records` (7 entries).

**Important limitation, stated plainly:** I only *directly observed* four pre-deletion facts about this record before it was deleted (title, theater, start date, published — captured incidentally in an early, unmodified list-view read, before I ever opened it for editing). I never opened Battle of Britain in the edit form, so I have no independently-captured snapshot of its exact `metadata` JSON. Everything beyond those four fields — the archive file's richer content — is being taken on trust that the published archive reflects the database accurately as of just before deletion. That's a reasonable assumption (publish is a one-directional DB → generator → archive JSON pipeline, and nothing in this session touched Battle of Britain before the accidental delete), but it is an assumption, not a verified fact, and a full byte-for-byte "before vs. after" diff — the kind of rigor this project's audits normally require — isn't possible here because there is no "before" snapshot of the full record to diff against.

## 4. A second, separate, more serious finding — surfaced by this investigation

While tracing exactly how the archive JSON maps back to the DB record (via `campaigns.generator.ts`), I found that the Campaigns admin form's save path **silently discards any `metadata` field it doesn't itself manage, on every single save** — not just for Battle of Britain, for *any* campaign:

- `campaigns-admin.js`'s `serializeForm()` builds `metadata` as a **brand-new object literal** with exactly 9 keys: `theater, dates, context, significance, outcome, sources, related_records, gallery, documents`.
- `campaigns.service.ts`'s `update()` passes that object straight to `prisma.record.update({ data: { metadata: <that object> } })`. Prisma's `Json` column update **replaces the value wholesale** — there is no merge.
- But `campaigns.generator.ts`'s `toCampaignJson()` (the code that produces the *public* JSON) reads several *additional* metadata fields that the admin form has no UI for at all: `combatants`, `phases`, `casualties`, `background`, `image`, `subtitle`, `region_label` (explicitly enumerated in the generator's `EXPLICIT_FIELDS` set, lines 53–57).

**Net effect: if any admin opens any campaign in this UI and clicks Save — for any reason, even just to fix a typo — that campaign's combatants, phase breakdown, casualties, background narrative, cover image, subtitle, and region label are silently wiped**, with no warning, no error, no confirmation. This is not something I introduced — I preserved `campaigns-admin.js`'s pre-migration `handleSubmit` body construction exactly as it was (verified by comparing against the original bespoke file I read at the start of this batch), so **this bug predates my changes** and is a pre-existing architectural gap, not a migration regression. The same `pickRecordFields()` + wholesale-replace pattern is used identically by `articles.service.ts` and `letters.service.ts`, so the same risk class likely applies to Articles and Letters for any of *their* extra/legacy metadata fields the admin form doesn't surface — I have not checked those two generators' `EXPLICIT_FIELDS` equivalents to confirm the exact field lists, only confirmed the mechanism is shared.

I did **not** trigger this on Battle of Britain (I deleted it outright, I never saved an edit to it) or on Monte Cassino (I opened it, tested dirty-state, and closed without saving). So no campaign's rich metadata has actually been wiped by this session — but the *risk* is live for all 34 remaining campaigns, and is unrelated to fixing it right now unless you want it addressed. Flagging per the standing instruction to stop and document any newly-discovered data-integrity issue before deciding whether it's in scope.

## 5. Proposed restore operation (NOT YET EXECUTED)

A single, direct Prisma `record.create()` call — **bypassing `/api/campaigns` entirely** (its `POST` validator/service path is the one with the known bare-`YYYY-MM-DD`-date bug; a direct script call with real `Date` objects sidesteps it cleanly rather than needing to touch that code):

```ts
await prisma.record.create({
  data: {
    id: "cmqnusec20019dn0e7kvy5uod",   // preserves the original ID (frees no FK conflicts — confirmed no other table references it)
    type: "CAMPAIGN",
    title: "Battle of Britain",
    slug: "britain",                   // derived, see §2 — flagging as inferred, not directly observed
    summary: "<from archive: summary field>",
    startDate: new Date("1940-07-10T00:00:00.000Z"),
    endDate: new Date("1940-10-31T00:00:00.000Z"),
    published: true,
    metadata: {
      theater: "western-front",
      dates: { start: "1940-07-10", end: "1940-10-31" },
      context: "<from archive>",
      significance: "<from archive>",
      outcome: "<from archive>",
      background: "<from archive — NOT admin-editable, but preserved since it's part of the original record>",
      subtitle: undefined,             // archive has none
      region_label: undefined,         // archive has none
      combatants: { axis: {...}, allied: {...} },   // from archive, verbatim
      phases: [ /* 3 phases, verbatim from archive */ ],
      casualties: { britain: "...", germany: "..." },  // verbatim from archive
      image: "/storage/images/campaigns/britain.jpg",  // NOTE: see caveat below
      sources: [ /* see shape caveat below */ ],
      related_records: [ /* see shape caveat below */ ],
      gallery: [],
      documents: [],
    },
    // createdAt: intentionally left to default — see caveat below
  },
});
```

**Open decisions / caveats for you to weigh in on before I'd execute anything:**

1. **`sources` shape mismatch.** The admin's sources editor only round-trips `{ref, type}`. The archive has 4 sources; one uses `note` instead of `type`. A strict "matches what the admin UI can edit" restore would drop that `note` field to `type: ""`. I'd recommend preserving the richer archive shape verbatim (the extra `note` field is harmless to store — it's just not editable via the admin sources UI) rather than lossily normalizing it, but that's a judgment call.
2. **`related_records` shape mismatch.** The archive's related-record entries use human-readable slug-style `id`s (`"bf-109"`, `"erich-hartmann"`) from the original static-content system, not live DB cuids. Restoring them verbatim means these entries likely won't resolve as clickable in-app links via the admin's related-record UI (harmless, but not fully functional) unless I look up each one's actual current DB id — which I have not attempted, since that's additional write-adjacent research I paused pending your direction.
3. **`createdAt` is unknown.** I never captured it. Every other 2026-08-10-seeded campaign I sampled has `createdAt` clustered around `2026-08-10T18:26:53.4xxZ`; I could set an approximate matching value, or just let it default to "now" (cosmetic only — Campaigns' list sorts by `startDate`, not `createdAt`, so this has no visible effect on the Admin UI or public site).
4. **`image` field.** This is a legacy single-cover-image path from before the live media-upload system existed (the DB-wide `MediaAsset` count is 0 — there has never been an uploaded media file in this environment). It doesn't map to the admin's `metadata.gallery` array shape. I'd propose storing it as-is under a non-admin-managed `image` key (matching the archive, matching what the generator already reads) rather than trying to synthesize a gallery entry from it.
5. **Full field values.** I have the complete archive JSON in hand and would populate every field verbatim from it (not abbreviated as `"<from archive>"` above — that's just for readability in this preview) — I'm showing you the *shape and provenance* of the restore, not asking you to approve blind.

## 6. What I have NOT done

- No `INSERT`, `UPDATE`, or `DELETE` has been run against the database since discovering this.
- No file outside `storage/admin-restructure/` has been modified as part of this investigation.
- Batch 3 (Articles module regression) is paused. Campaigns and Articles' *migration* work itself is unaffected by this incident — the bug is in my test script, not in `campaigns-admin.js`/`articles-admin.js`/`admin-content-module.js`.

## 7. Testing-safety fix needed before any further destructive testing

Every prior batch's delete/CRUD tests in this engagement used `document.querySelector('[data-delete]')` or similar unscoped selectors, relying on "only one tab's content is visible" — which is true for *rendering* but not for *DOM querying*, since hidden tab panels keep their last-rendered rows (including action buttons) in the document. This was a latent risk in my own testing methodology in every prior batch too, not just this one — it simply hadn't been triggered before because I'd never left a *different* tab's list freshly (unfiltered, real-data) populated immediately before switching tabs mid-test.

**Going forward, every destructive test action (delete, in particular) will be scoped to its module's own list container** — e.g. `#article-list [data-delete]`, `#campaign-list [data-delete]` — never a bare `[data-delete]` — and I'll verify the target record's ID matches the intended fixture (via a direct API check) *before* confirming any delete, not just after.
