# Personnel Metadata-Loss Fix + Timeline Summary Fix — Final Report

**Date:** 2026-08-15
**Status:** Both fixes complete, tested, and verified. Admin restructuring is **not** declared complete — see §9.

---

## 1. Personnel metadata baseline (captured before any code change)

Full data: [`personnel-metadata-baseline.json`](personnel-metadata-baseline.json). Captured via a read-only scan of all 46 `PERSON` entities, comparing each record's metadata keys against the exact set `personnel-admin.js`'s form manages (`branch, rank, service, birthplace, portrait, biographyBlocks, commands, awards, campaigns, sources, related_records, gallery, documents`).

**46 total Personnel entities. 14 (30%) have unmanaged metadata fields:**

| Unmanaged field | Records carrying it |
|---|---|
| `kills` | 8 |
| `aircraft` | 8 |
| `ships_sunk` | 5 |
| `tonnage_sunk` | 5 |
| `tank_kills` | 2 |
| `vehicles` | 1 |

| Record | Unmanaged fields |
|---|---|
| Adolf Galland | kills, aircraft |
| Erich Hartmann | kills, aircraft |
| Erich Topp | ships_sunk, tonnage_sunk |
| Gerhard Barkhorn | kills, aircraft |
| Günther Prien | ships_sunk, tonnage_sunk |
| Hans-Ulrich Rudel | kills, aircraft, tank_kills |
| Hermann Göring | kills, aircraft |
| Joachim Schepke | ships_sunk, tonnage_sunk |
| Josef Kammhuber | kills, aircraft |
| Michael Wittmann | vehicles, tank_kills |
| Otto Kretschmer | ships_sunk, tonnage_sunk |
| Walter Nowotny | kills, aircraft |
| Werner Mölders | kills, aircraft |
| Wolfgang Lüth | ships_sunk, tonnage_sunk |

---

## 2. Root cause

Identical to the pattern already found and fixed in `campaigns.service.ts`, `articles.service.ts`, `letters.service.ts`, `records.service.ts`, and `timeline.service.ts`: `personnel.service.ts`'s `update()` passed the allowlisted, Admin-form-managed fields straight into `prisma.entity.update()`. Prisma's `Json` column update replaces the value wholesale — there is no partial write. `personnel.generator.ts` (confirmed by reading it) has a catch-all `extras` passthrough, documented in its own source comment as carrying exactly this class of field: *"kills, tank_kills, ships_sunk/tonnage_sunk, aircraft, vehicles."* Unlike Awards/Maps/Political Docs (zero real records at risk when their equivalent bug was fixed), this one was live: 14 real, populated historical records were one Admin save away from silent data loss.

---

## 3. The fix

Reused the existing `mergeMetadata()` helper (`src/utilities/metadata-merge.ts`) — **unmodified, no new implementation, no hardcoded field list** — in exactly the same position/pattern already proven five times over:

```ts
async update(id: string, data: object) {
  const fields = normalizeDateFields(pickEntityFields(data), DATE_FIELDS);
  if ("metadata" in fields) {
    const existing = await prisma.entity.findUnique({ where: { id }, select: { metadata: true } });
    fields.metadata = mergeMetadata(existing?.metadata, fields.metadata);
  }
  return notFoundAs404(
    () => prisma.entity.update({ where: { id }, data: fields as ... }),
    "Personnel record not found",
  );
}
```

One file changed: `src/modules/personnel/personnel.service.ts` (added the import + the merge block; `create()` untouched — a brand-new record has no prior metadata to preserve, same reasoning as every other service).

**Relationships, aliases, media, and citations are untouched by construction, not just by testing:** `pickEntityFields()`'s allowlist (`name, nationality, birthDate, deathDate, summary, biography, metadata, tags, published`) has never included any of `EntityAlias`, `Relationship`, `Citation`, or `MediaAsset` — `prisma.entity.update()` with a flat data object cannot touch those related tables at all. This fix only ever touches the `metadata` column; nothing else in `update()` changed.

`tsc --noEmit`: clean.

---

## 4. Fixture test — real Admin UI

Created a `ZZ-TEST` fixture with rich managed metadata (branch/rank/service/birthplace/commands/awards/campaigns/sources/related_records) **and** unmanaged metadata matching the real affected pattern exactly (`kills: 42, aircraft: "..."`) plus a genuinely novel field (`custom_future_field`) to prove the fix isn't tied to a known list — plus a real `EntityAlias` row and a translation, to test relations directly.

Logged into the real Admin UI, opened the fixture (selector scoped to `#personnel-list`, target ID verified before the click), changed one managed field (`branch`: `luftwaffe` → `army`) through the DOM, clicked the real Save button: **`200 OK`**.

Verified via direct DB read, including relations:

| Check | Result |
|---|---|
| `branch` changed to `army` | PASS |
| `kills`, `aircraft`, `custom_future_field` preserved | PASS (all 3) |
| `rank`, `service`, `birthplace`, `commands`, `awards`, `campaigns`, `sources`, `related_records` preserved | PASS (all 8) |
| `EntityAlias` row (1) intact | PASS |
| `relationsFrom`/`relationsTo`/`citations`/`media` (0 each, none created) | PASS |
| Translation intact | PASS |

**15/15 checks passed.** Deleted the fixture via the real Delete button + confirm dialog (scoped selector, ID verified); confirmed the entity gone and its `EntityAlias` row cascade-deleted automatically (schema `onDelete: Cascade`); manually deleted the leftover `Translation` row (no cascade FK, same as every other entity type in this schema) — matching the established cleanup pattern from every prior batch. Global sweep after: zero `ZZ-TEST-*` entities, zero `ZZ-TEST-*` aliases, zero `ZZ-TEST-*` translations, `MediaAsset` still 0.

---

## 5. Non-mutating proof for the 14 real affected records

Per your explicit instruction not to mass-save or rewrite production records, this was proven two ways, **with zero `prisma.entity.update()`, `.create()`, or `.delete()` calls made against any real record anywhere in this step**:

1. **Read-only re-confirmation**: re-read all 14 records' current metadata and compared against the baseline captured in §1 — all 14 unchanged (expected, since nothing had touched them between the baseline capture and this check).
2. **In-memory simulation of the fixed `update()` path**: for each of the 14 records, built the exact payload the real Admin form would send today (only the managed fields — no combat-stat keys, since the form has no field for them), ran it through the actual `pickEntityFields()` → `normalizeDateFields()` → `mergeMetadata()` call chain in isolation (the same three functions `personnel.service.ts`'s `update()` calls, invoked directly in a script, never touching `prisma.entity.update()`), and verified the resulting simulated metadata still contained every one of that record's real unmanaged fields, byte-identical.

**28/28 checks passed** (14 records × 2 checks each). All 14 — Adolf Galland, Erich Hartmann, Erich Topp, Gerhard Barkhorn, Günther Prien, Hans-Ulrich Rudel, Hermann Göring, Joachim Schepke, Josef Kammhuber, Michael Wittmann, Otto Kretschmer, Walter Nowotny, Werner Mölders, Wolfgang Lüth — confirmed both **currently intact** and **provably protected** by the fix, without a single write to any of them.

---

## 6. Timeline `summary` fix — separate, narrowly scoped

**Root cause, traced end to end:** the Admin form has always had a Summary field, and `timeline-admin.js`'s `handleSubmit` has always sent `summary` in the request body. `timeline.validator.ts` had no validator for `summary` at all (unvalidated, passed through). `timeline.service.ts`'s `EventInput` interface and `toDbData()` — the function that builds the Prisma write — **never declared or read `data.summary`**, even though `TimelineEvent.summary` is a real schema column. The value was silently dropped at the service layer, for every one of the 83 real timeline events, since long before this migration.

**Fix, scoped to exactly this gap:**
- Added `summary?: string | null` to `EventInput`.
- Added `summary: data.summary ?? null,` to `toDbData()`.
- Added a `summary` validator to both `createTimelineEventValidator` and `updateTimelineEventValidator` (`.optional({nullable:true}).trim().isLength({max:2000})`, matching the same cap used by every other module's summary field — this field had no validation at all before, unlike every sibling field).

No other Timeline behavior touched — pagination, the delete button, filters, metadata-merge, date normalization all unchanged from the pilot migration.

**Tested via the real Admin UI:**
- **Create**: title + year + summary → `201`; verified `summary` persisted exactly as typed (previously would have been `null`).
- **Edit-repopulate**: reopened the created event — `summary` correctly reloaded into the form (previously would have shown empty).
- **Edit-save**: changed `summary`, saved → `200`; verified the new value persisted.
- Fixture deleted via the real UI; global sweep confirmed zero `ZZ-TEST-*` timeline events remaining.

---

## 7. Database before/after

| Table | Before this round (`personnel-fix-final` baseline = prior `timeline-pilot-final`) | After (`personnel-fix-final.json`) |
|---|---|---|
| Record total | 184 | 184 |
| Entity (PERSON) | 46 | 46 |
| TimelineEvent | 83 | 83 |
| Translation | 72 | 72 |
| Collection | 42 | 42 |
| Relationship | 28 | 28 |
| MediaAsset | 0 | 0 |
| AuditLog | 44 | 44 |
| EntityAlias | 0 | 0 |
| Citation | 0 | 0 |

**Zero drift on every table.** Neither `personnel.service.ts` nor `timeline.service.ts` write audit-log entries (pre-existing, unchanged), so the fixture create/edit/delete cycles produced no audit entries, consistent with that.

---

## 8. Console / TypeScript status

- `tsc --noEmit`: clean (checked after the Personnel fix, again after the Timeline fix, and once more as the final step before this report).
- Fresh Admin console (new tab, fresh login, all 11 tabs including NSDAP): zero errors.
- Fresh public-site console: zero errors.
- Global sweep: zero `ZZ-TEST-*` records, entities, timeline events, or aliases anywhere in the database; zero orphaned `record`/`entity`/`timeline_event` translations; `MediaAsset` still 0; `Citation` still 0; `Relationship` still exactly 28 (unchanged).

---

## 9. Confirmation: no real production content was unintentionally modified

- The 14 real, affected Personnel records were read from **before** any code change (§1), re-read **after** the fix (§5.1) — byte-identical, confirming nothing drifted during this work.
- The fix's protective effect on those same 14 records was proven via pure in-memory simulation (§5.2) — **zero write operations of any kind were issued against any real record's row**, confirmed by inspection of the verification script itself (no `prisma.entity.update/create/delete` calls exist in it).
- The only database writes performed this entire round were: one `ZZ-TEST` Personnel fixture (created, edited, deleted) and one `ZZ-TEST` Timeline fixture (created, edited twice, deleted) — both fully cleaned up, confirmed by the global sweep in §8.
- Table-count comparison (§7) independently confirms zero drift anywhere, including the real 46-entity Personnel table and 83-event Timeline table.

---

## Remaining Admin patterns still requiring a separate architecture review

Per your explicit instruction, NSDAP was **not** migrated this round or any prior round — it remains outside `createContentModule()` because it's architecturally a fixed-file site-content editor (a hardcoded sidebar of ~23 JSON keys under the generic `/api/site-content` endpoint), not a CRUD list of records. The same applies to:
- **NSDAP** (`/api/site-content?key=nsdap/*`)
- **Content Pages** (same `/api/site-content` system, different key namespace)
- **Homepage** (same system again)

All three share one underlying pattern that is genuinely different from the record-list-with-create/edit/delete abstraction `createContentModule()` generalizes. If any of them are ever restructured, they'd need their own factory (something like "a fixed-key content-file editor with optional structured sub-forms"), not this one. None of the three were touched, inspected further, or altered in any way this round.

---

**Both fixes are complete and fully verified. The Admin restructuring is still not declared complete** — this was explicitly a data-integrity fix, not a migration step, and NSDAP/Content Pages/Homepage remain open, unaddressed patterns by design. Awaiting your direction on next steps.
