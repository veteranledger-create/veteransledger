# Formations Metadata-Loss Fix + Armaments Assessment — Final Report

**Date:** 2026-08-15
**Status:** Formations fix complete and verified. Armaments audit found a **second, worse concrete data-loss path** and — per your instruction #5's conditional authorization — it was fixed and verified too. A third Armaments defect (type corruption) was found, documented, and **deliberately not fixed** (different layer, needs its own scoped task).

---

## 1. Formation metadata baseline (captured before any code change)

Full data: [`formations-metadata-baseline.json`](formations-metadata-baseline.json). Read-only scan of all 32 `FORMATION` records, comparing each record's metadata keys against the exact 10 keys `formations-admin.js`'s `serializeForm()` builds (`section, formation_type, service, theater, active, peak_strength, context, commanders, sources, related_records`).

**32 of 32 records (100%) carry unmanaged metadata.** Distinguishing substantive values from present-but-null placeholders:

| Unmanaged field | Records with a **substantive** value |
|---|---|
| `context_blocks` | **32** |
| `overview_blocks` | **32** |
| `fate` | 10 |
| `parent_formation` | 8 |
| `flag` | 7 |
| `region` | 6 |
| `shield` | 6 |
| `volunteer_origin` | 6 |
| `constituent_divisions` | 5 |
| `dossier` | 2 |
| `predecessor` | 1 |

**115 substantive unmanaged fields total, including 199 individual `overview_blocks` + `context_blocks` entries** — the per-formation narrative content rendered as the "Overview" and "Historical Context" sections on every public formation page. Every one of the 32 records was affected; the volunteer/foreign formations (Charlemagne, Croatian 369th, Norwegian Legion, Frikorps Danmark, Wallonie, Cossack Corps) carried the most, at 6–8 substantive fields each.

---

## 2. Root cause

Identical to the pattern fixed this session for Campaigns, Articles, Letters, Awards/Maps/Political Docs, Timeline, and Personnel. `formations.service.ts`'s `update()` passed the allowlisted, Admin-form-managed fields straight into `prisma.record.update()`. Prisma replaces a `Json` column wholesale — there is no partial write — so every key the form doesn't rebuild was dropped on save.

`formations.generator.ts` reads all of these fields when producing the public site's JSON (`overview_blocks`, `context_blocks`, `dossier`, `shield`, `flag`, `region`, `volunteer_origin`, `parent_formation`, `constituent_divisions`, `predecessor`, `fate`, `subordinate_units`, `campaign_participation`), but `formations-admin.js`'s form has no input for any of them. So the loss was silent and total: open any formation in the Admin, click Save, and its entire narrative content disappeared from the public site.

**Severity vs. the earlier Personnel finding:** Personnel was 14/46 records (30%) losing secondary statistics. Formations was **32/32 (100%) losing primary narrative content.** This was the most severe instance of this bug class found in the entire engagement.

---

## 3. The fix

Reused the existing `mergeMetadata()` helper (`src/utilities/metadata-merge.ts`) — **unmodified, no new implementation, no hardcoded field list, no data-model change** — in the same position and pattern already proven seven times:

```ts
async update(id: string, data: object, userId: string) {
  const fields = pickFormationFields(data);
  if ("metadata" in fields) {
    const existing = await prisma.record.findUnique({ where: { id }, select: { metadata: true } });
    fields.metadata = mergeMetadata(existing?.metadata, fields.metadata);
  }
  const record = await notFoundAs404(
    () => prisma.record.update({ where: { id }, data: fields as ... }),
    "Formation not found",
  );
  await prisma.auditLog.create({ data: { userId, action: "UPDATE", entity: "Record", entityId: id } });
  return record;
}
```

One file changed: `src/modules/formations/formations.service.ts`. `create()` untouched (a new record has no prior metadata). Audit-logging, slug handling, and the Phase 3 field-allowlist all unchanged.

---

## 4. Fixture test — real Admin UI

Created a `ZZ-TEST` Formation with all 10 managed fields populated **and** all 13 real at-risk unmanaged fields in their exact real shapes (multi-entry `overview_blocks`/`context_blocks`, a nested `dossier` object, the volunteer extras, the org-chart extras) plus a `custom_future_field` that exists nowhere in the codebase — proving the fix isn't tied to any known list. Added a translation to test relations.

Logged into the real Admin UI, opened the fixture (selector scoped to `#formation-list`, target ID verified before the click), changed one managed field (`theater`) through the DOM, clicked the real Save button: **`200 OK`**.

Verified by direct DB read:

| Check | Result |
|---|---|
| `theater` changed as intended | PASS |
| **All 14 unmanaged fields byte-identical** (`overview_blocks`, `context_blocks`, `dossier`, `shield`, `flag`, `region`, `volunteer_origin`, `parent_formation`, `constituent_divisions`, `predecessor`, `fate`, `subordinate_units`, `campaign_participation`, `custom_future_field`) | **14/14 PASS** |
| All 9 managed-but-untouched fields preserved | 9/9 PASS |
| `slug`, `nationality` top-level columns preserved | PASS |
| Citations / media relations (0 each, none created) | PASS |
| Translation intact | PASS |

**28/28 checks passed.** Fixture deleted through the real Delete button + confirm dialog (scoped selector, ID verified); confirmed gone; leftover translation cleaned up (no cascade FK — consistent with every other content type in this schema).

---

## 5. Proof the 32 real records are protected — without writing to any of them

Two independent verifications, with **zero `prisma.record.update/create/delete` calls anywhere in the verification script**:

1. **Read-only re-confirmation** — re-read all 32 records and compared every unmanaged key against the pre-fix baseline: **32/32 unchanged.**
2. **In-memory simulation of the fixed `update()` path** — for each of the 32, built the exact payload today's Admin form sends (the 10 managed keys only, no narrative fields), ran it through the actual `pickFormationFields()` → `mergeMetadata()` chain in isolation, and confirmed the resulting metadata still contained every substantive unmanaged field byte-identical.

**64/64 checks passed** (32 records × 2). **115 substantive fields and all 199 narrative blocks confirmed protected**, with no real Formation row touched.

---

## 6. Armaments assessment — two defects found, one fixed, one documented

You asked me to document whether the hand-rolled merge is complete or fragile, and authorized a rewrite only if a concrete data-loss path was proven. I found two.

### 6a. Confirmed data-loss — provenance keys deleted on every save (**FIXED**)

`armaments-admin.js`'s `populateForm()` round-trips unknown metadata keys into an `extraSpecs` draft, but filters out everything in `KNOWN_META_KEYS` first. That set includes `importRunId`, `fileNation`, and `schemaType` — and `buildRecordData()` never re-adds them. So they were excluded from the form *and* absent from the write: **deleted on every single admin save.**

**83 of 85 real Armament records carry all three** (e.g. Focke-Wulf Fw 190, He 111, Adua — `importRunId="b711f21c-…"`, `fileNation="germany"/"italy"`, `schemaType="full"`). These link each record to the import run that created it and describe its source schema — real provenance data for a historical archive.

This is a concrete, live data-loss path, so per your instruction I applied the same `mergeMetadata()` fix (one line plus a comment in `armaments.service.ts`'s `update()`, merging onto current metadata after the existing field-by-field build). **Verified via the real Admin UI**: created a fixture carrying all three provenance keys plus a novel field, changed `category` through the form, saved — all four preserved, `category` correctly updated. Fixture deleted; Armament count back to 85.

**On the existing hand-rolled merge's completeness:** it is key-complete for everything the form knows about, but it is exactly the fragility your Personnel instruction warned against — a hand-written list that silently drops anything not on it. The `mergeMetadata()` addition now closes that generally, so a future metadata key can't reintroduce this.

### 6b. Confirmed type corruption — **NOT fixed, needs its own task**

`populateForm()` stringifies every `extraSpecs` value (`typeof value === "object" ? JSON.stringify(value) : String(value)`), and `serializeForm()` writes those strings straight back. Across the 85 real records, the extras contain **212 number values, 16 object values, and 54 nulls** — **83 of 85 records have at least one non-string extra.** After any admin save, `range_km: 800` (number) becomes `"800"` (string), `dossier: {...}` becomes a JSON *string*, and `null` becomes `"null"`. The `armament` SPEC_FIELD is similarly affected (stored as array/object on some records, written back as a string).

**I did not fix this**, deliberately: it's a frontend round-trip fidelity bug, not a backend merge bug — `mergeMetadata()` cannot fix it, because the form actively *sends* the corrupted values and the merge would faithfully preserve them. The fix belongs in `armaments-admin.js`'s populate/serialize pair (preserve original types, or store the original value alongside the display string), and it needs its own baseline + fixture + verification cycle with the same rigor. **Recommend this as the next task.** Note it only triggers when an admin actually opens and saves an armament through the form — it is not currently corrupting anything at rest.

---

## 7. Database before / after

| Table | `formations-fix-baseline` | `formations-fix-final` |
|---|---|---|
| Record total | 184 | 184 |
| — FORMATION | 32 | 32 |
| — ARMAMENT | 85 | 85 |
| Entity | 46 | 46 |
| TimelineEvent | 83 | 83 |
| Translation | 72 | 72 |
| Collection | 42 | 42 |
| Relationship | 28 | 28 |
| MediaAsset | 0 | 0 |
| AuditLog | 44 | 46 |

**Zero drift on every content table.** AuditLog +2 is exactly the two audited operations on the Formation fixture (1 UPDATE via the real UI + 1 DELETE via the real UI) — `formations.service.ts` is one of the services that audit-logs; `armaments.service.ts` does not, so its fixture cycle produced no entries. Both fixtures fully cleaned up.

---

## 8. Verification suite results

- `tsc --noEmit`: **clean** (after the Formations fix, after the Armaments fix, and as the final step).
- Fresh Admin console — new tab, fresh login, **all 17 tabs** clicked (Formations, Armaments, Personnel, Timeline, Campaigns, Articles, Letters, Awards, Maps, Political Docs, NSDAP, Content Pages, Homepage, Navigation, Site Settings, Page Content, Translations): **zero errors.**
- Fresh public-site console: **zero errors.**
- Global `ZZ-TEST-*` sweep: zero records, zero entities, zero timeline events, zero aliases.
- Orphan sweep: zero orphaned record/entity/timeline_event translations; MediaAsset 0; Citation 0; Relationship 28 (unchanged).
- Final re-confirmation: **all 32 real Formation records byte-identical to the pre-fix baseline.**
- No leftover scratch scripts (`src/scripts/` clean).

---

## 9. Confirmation: no real production content was modified

- The 32 Formation records were read before the fix, re-read after, and re-confirmed a third time in the final sweep — byte-identical each time.
- Their protection was proven by in-memory simulation with **zero write calls** against any real record.
- The only writes this session: one ZZ-TEST Formation (created → edited → deleted) and one ZZ-TEST Armament (created → edited → deleted), both fully removed.
- Table counts independently confirm zero drift, including the real 32 Formations and 85 Armaments.

---

## 10. Remaining site-content issues (unchanged — nothing touched)

Per instruction #7, NSDAP, Content Pages, Homepage, Navigation, Site Settings, and Page Content were **not modified** and remain outside `createContentModule()`. Outstanding items from the architecture audit, all still open:

1. **Zero dirty-state protection** across all six file-editing areas — none register with `admin-dirty-guard.js`. Small fix each, reusing existing infrastructure; the one genuinely uniform gap.
2. **No server-side schema validation** on `PUT /api/site-content` — one backend change would cover all six.
3. **`GET /api/site-content` has no auth** — likely intentional (public site reads it), documented not flagged.
4. **`homepage.json` is dual-editable** via both the Homepage tab and Content Pages.
5. **Icon-picker modal not registered** with the shared modal stack — cosmetic consistency only.
6. **No history/rollback** for site-content saves, unlike the Record publish pipeline.

---

## Recommended next steps

1. **Armaments type-corruption fix (6b)** — the one remaining proven defect, needs a frontend fix in `armaments-admin.js` with its own baseline and verification cycle.
2. Site-content dirty-guard cleanup (items 1 + 4 above).
3. Optional lower-priority polish (items 2, 5, 6).

**The Admin restructuring is still not declared complete.** All eight Record/Entity/TimelineEvent-backed services now share the same metadata protection (Campaigns, Articles, Letters, Awards/Maps/PolDocs, Timeline, Personnel, Formations, Armaments) — the bug class that started with the Battle of Britain incident is now closed across every DB-backed content type.
