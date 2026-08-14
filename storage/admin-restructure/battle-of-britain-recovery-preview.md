# Battle of Britain — Read-Only Recovery Preview

**Status: READ-ONLY. No database write has been executed. This document requires explicit approval before any restore is run.**

Source of truth for every field below: `public/data/campaigns/western-front/britain.json` (the currently-published archive JSON for this record), cross-checked against direct read-only queries of neighboring, still-intact records from the same 2026-08-10 seed/import batch. Every field is marked with a confidence level and its exact source.

---

## Exact ID to be restored

```
cmqnusec20019dn0e7kvy5uod
```

Source: `britain.json`'s `recordId` field. Confirmed absent from the live `records` table as of this preview (`prisma.record.findUnique({where:{id:"cmqnusec20019dn0e7kvy5uod"}})` → `null`).

---

## Every DB field to be recreated, with exact source value

| Column | Exact value to write | Confidence | Source |
|---|---|---|---|
| `id` | `cmqnusec20019dn0e7kvy5uod` | **Certain** | `britain.json`'s `recordId`; matches the `cmqnuse…` cuid prefix shared by every other record in this seed batch |
| `type` | `CAMPAIGN` | **Certain** | Record was in the Campaigns list before deletion |
| `title` | `Battle of Britain` | **Certain** | Directly observed pre-deletion (list-view row, captured before any testing touched this record) AND matches archive |
| `slug` | `britain` | **High confidence, inferred** | `campaigns.generator.ts` line 91: `id: record.slug ?? record.id`. Archive's `id` is `"britain"` (not the cuid), which is only possible if `record.slug === "britain"`. Not directly observed pre-deletion. |
| `summary` | `"The Battle of Britain was the German Luftwaffe's attempt to establish air superiority over Britain as a precondition for a seaborne invasion (Operation Sea Lion). The RAF's successful defence, made possible by radar, ground control, and the Hurricane and Spitfire fighters, marked Germany's first major defeat."` | **High confidence, from archive** | `britain.json`'s `summary` field, verbatim |
| `startDate` | `1940-07-10` (as a proper `Date`, not a bare string — see §"Known bare-date bug" below) | **Certain** | Directly observed pre-deletion (list column) AND matches archive's `dates.start` |
| `endDate` | `1940-10-31` (as a proper `Date`) | **High confidence, from archive** | `britain.json`'s `dates.end`. Not directly observed pre-deletion (end date isn't shown in the list view), but internally consistent with the campaign's known historical end (RAF/Luftwaffe air campaign concluded with Hitler's 17 Sept postponement of Sea Lion and the tapering Blitz through October). |
| `published` | `true` | **Certain** | Directly observed pre-deletion ("Published" badge in the list row) |
| `collectionId` | `cmsnkcia50012frdhuli9fqu0` ("Western Front Campaigns" collection) | **High confidence, inferred** | Not present in the archive JSON at all (collections are an admin/DB-only grouping, not published). Verified read-only: every other `western-front`-theater campaign I sampled (Operation Market Garden, Battle of Normandy, Warsaw Uprising) shares this exact `collectionId`. No western-front campaign in the current dataset uses a different collection. |
| `createdAt` | *(not restorable with certainty — see below)* | **Unknown** | Never captured. See caveat. |
| `updatedAt` | Will be set by Prisma's `@updatedAt` automatically | N/A | Schema-managed, not a restore decision |
| `content`, `location`, `nationality`, `date`, `tags` | `null` / `[]` (Prisma defaults / left unset) | **High confidence** | Every sampled Campaign record (Market Garden, Normandy, Warsaw Uprising, the North Africa cluster) has these unset — Campaigns never use them |

### `metadata` (JSON column) — field by field

| Key | Exact value | Confidence | Source |
|---|---|---|---|
| `theater` | `"western-front"` | **Certain** | Directly observed pre-deletion (list badge) AND archive |
| `dates` | `{ "start": "1940-07-10", "end": "1940-10-31" }` | **High confidence, from archive** | `britain.json` |
| `context` | *(full paragraph, ~150 words, starting "The Battle of Britain was unlike any previous air campaign…")* | **High confidence, from archive** | `britain.json`'s `context` field, would be copied verbatim |
| `outcome` | `"British victory. The Luftwaffe failed to establish air superiority and Operation Sea Lion was postponed. Germany's first defeat of the war demonstrated that air power alone could not defeat a nation with effective air defences."` | **High confidence, from archive** | `britain.json`'s `outcome` field, verbatim |
| `significance` | `"Winston Churchill's words — 'Never in the field of human conflict was so much owed by so many to so few' — became the defining tribute to the RAF's 2,946 aircrew who fought in the battle."` | **High confidence, from archive** | `britain.json`'s `significance` field, verbatim |
| `background` | *(full paragraph starting "Following the fall of France in June 1940…")* | **High confidence, from archive** | `britain.json`'s `background` field, verbatim. **Not restorable via the Admin UI at all** — Campaigns admin form has no field for this. |
| `combatants` | `{axis: {nations:[], strength:"2,600 aircraft (at peak)", commanders:[3 names]}, allied: {nations:[], strength:"1,963 aircraft (at peak)…", commanders:[3 names]}}` | **High confidence, from archive** | `britain.json`'s `combatants` object, verbatim. **Not restorable via the Admin UI** — no form field. |
| `phases` | Array of 3 phase objects (Kanalkampf, Adlerangriff, London Blitz), each with `name`/`dates`/`description` | **High confidence, from archive** | `britain.json`'s `phases` array, verbatim. **Not restorable via the Admin UI.** |
| `casualties` | `{ "britain": "1,087 aircraft, 544 aircrew killed; 43,000 civilians killed in the Blitz", "germany": "1,977 aircraft, ~2,698 aircrew killed or captured" }` | **High confidence, from archive** | `britain.json`'s `casualties` object, verbatim. **Not restorable via the Admin UI.** |
| `image` | `"/storage/images/campaigns/britain.jpg"` | **High confidence, from archive** | `britain.json`'s `image` field. This is a static, pre-media-system path — the site-wide `MediaAsset` table has 0 rows (no live uploads exist anywhere in this environment), so this is not backed by an uploaded file the Admin media library would recognize. It doesn't map to the Admin form's `gallery` array shape either. Restoring it as a raw `image` key (matching every other campaign's pattern, e.g. Normandy's `"/storage/images/campaigns/normandy.jpg"`) preserves it exactly as the generator expects, without inventing a fake gallery entry. |
| `sources` | 4 entries, verbatim from archive (see shape caveat below) | **High confidence, from archive** | `britain.json`'s `sources` array |
| `related_records` | 7 entries, verbatim from archive (see shape caveat below) | **High confidence, from archive** | `britain.json`'s `related_records` array |
| `region_label`, `subtitle` | not set (absent from archive) | **High confidence** | Archive has no `region_label`/`subtitle` keys; every sampled neighbor (Market Garden, Warsaw Uprising) also has these as `null` |
| `importRunId` | `"b9b50951-b99c-42e7-b3ca-2fe1c043f892"` | **High confidence, inferred, NOT from archive** | This field is deliberately excluded from the published JSON by the generator (`campaigns.generator.ts` line 85: `key !== "importRunId"`), so it cannot come from `britain.json`. Found instead by directly reading three other western-front campaigns' live `metadata` (Market Garden, Normandy, Warsaw Uprising) and the "Western Front Campaigns" collection's own `metadata` — all four share this exact `importRunId`, consistent with a single bulk-import transaction. This is the one field in this table sourced from corroborating live data rather than the archive file itself. |
| `gallery`, `documents` | `[]` | **High confidence** | Site-wide `MediaAsset` count is 0; no uploaded media exists for any record in this environment |

**`sources` shape caveat:** the Admin's sources editor (`admin-form.js`'s `renderSources`) only round-trips `{ref, type}` per entry. The archive has 4 sources; entries 2–4 use a `note` field instead of (or in addition to) `type`:
```json
[
  { "ref": "National Archives (UK). AIR 16/635…", "type": "primary" },
  { "ref": "Bungay, Stephen. The Most Dangerous Enemy…", "note": "The most comprehensive modern account…" },
  { "ref": "Orange, Vincent. Dowding of Fighter Command…" },
  { "ref": "Overy, Richard. The Battle of Britain…" }
]
```
A restore that matches "what the Admin sources UI can display/edit" would need `type` on each entry (blank if absent), silently dropping the `note` text. **Recommendation: preserve the archive shape verbatim** (including `note`) — it's harmless to store, just not editable through the current sources UI, and matches how Operation Market Garden's and Warsaw Uprising's own `sources` are already stored live (I directly observed both have `note`-bearing entries in the DB right now, unmodified) — so this shape is not a restoration artifact, it's simply how this collection's data has always looked.

**`related_records` shape caveat:** archive entries use human-readable slug-style `id`s (`"bf-109"`, `"fw-190"`, `"erich-hartmann"`, `"werner-molders"`, `"adolf-galland"`, `"joseph-kammhuber"`, `"france"`) from the original static-content/import system — not live DB cuids. I directly confirmed this same pattern is how `related_records` are *already* stored on Market Garden, Normandy, and Warsaw Uprising's live metadata right now (e.g. Normandy's `related_records` includes `{"id":"pz-v-panther","type":"Armament",...}` — a slug, not a cuid). **This is the established, current data shape for this field across the whole Campaigns collection, not something restoration would introduce or distort.** I have not attempted to resolve each slug to a live record ID — that's consistent with how the other 34 campaigns already work, so no restoration-specific ambiguity here.

### Fields that cannot be reconstructed with certainty

- **`createdAt`**: never captured before deletion, and not present in the archive JSON (publish output doesn't include DB timestamps). The "Western Front Campaigns" collection and its sibling campaigns (Market Garden, Normandy, Warsaw Uprising) all cluster within the same second — `2026-08-10T18:26:53.4xxZ` — consistent with one bulk-seed transaction. I could set an approximate matching value, or accept Prisma's default (`now()`). **Cosmetic only**: the Admin Campaigns list sorts by `startDate`, not `createdAt`, so neither choice is visible anywhere in the UI or public site. Flagging as the one field this preview cannot state with certainty, per your requirement.
- **`slug`**: see table above — high-confidence inference, not a direct pre-deletion observation.
- Everything else in the table above is either directly observed pre-deletion or sourced verbatim from the published archive file, cross-checked against live sibling records where the archive doesn't cover a field (`collectionId`, `importRunId`).

---

## Related records

7 entries in `metadata.related_records` (archive, verbatim — see shape caveat above): Messerschmitt Bf 109 (Armament), Focke-Wulf Fw 190 (Armament), Erich Hartmann (Personnel), Werner Mölders (Personnel), Adolf Galland (Personnel), Josef Kammhuber (Personnel), Fall of France (Campaign). These are stored as JSON data inside `metadata`, not as `Relationship` table rows — restoring the record does not create any `Relationship` rows, matching how this field already works for every other campaign.

## Sources / citations

4 entries in `metadata.sources` (archive, verbatim — see shape caveat above). Note: these are **not** `Citation` table rows either — Campaigns' "sources" are stored as JSON inside `metadata`, same as `related_records`. The `citations` table (used elsewhere in this schema) has **zero rows referencing this record ID** currently, confirmed read-only, and restoring would not need to create any — consistent with how sources work for every other campaign (none of the sampled sibling campaigns have `Citation` rows either).

## Translations

**Zero.** Confirmed read-only: `translation.findMany({where:{entityType:"record", entityId:"cmqnusec20019dn0e7kvy5uod"}})` → 0 rows, both before my investigation began and currently. No translation exists to restore or lose.

## Media

**Zero.** Confirmed read-only: `mediaAsset.findMany({where:{records:{some:{id:"cmqnusec20019dn0e7kvy5uod"}}}})` → 0 rows. Consistent with the site-wide `MediaAsset` total of 0 — there are no uploaded media files anywhere in this environment, for any record. The archive's `image` field is a static path unconnected to the (empty) media-upload system, handled per the `metadata.image` row in the table above.

## Collection / type / theater

- **Collection**: `cmsnkcia50012frdhuli9fqu0` — "Western Front Campaigns" (`slug: campaigns-western-front`, `category: campaigns`). High-confidence inference (see table above) — not present in the archive, derived from the collection every other western-front campaign belongs to.
- **Type**: `CAMPAIGN`. Certain.
- **Theater** (a `metadata` field, not a DB column): `western-front`. Certain — directly observed pre-deletion and matches archive.

## Published state

`true`. Directly observed pre-deletion (the "Published" badge in the list row, captured before this record was ever touched).

## Expected before/after DB state

Current state (verified read-only, matches `storage/admin-restructure/batch3-checkpoint.json`, captured 2026-08-14T19:02:32Z):

| Table | Current | After proposed restore |
|---|---|---|
| `Record` total | 183 | 184 (net +1) |
| `Record` CAMPAIGN count | 34 | 35 (matches the `batch3-baseline.json` pre-incident count) |
| `Citation` rows referencing this id | 0 | 0 (unchanged — this record type doesn't use the Citation table) |
| `Relationship` rows referencing this id | 0 | 0 (unchanged — Campaigns don't use the Relationship table for related-records) |
| `Translation` rows referencing this id | 0 | 0 (unchanged — none existed) |
| `MediaAsset` rows referencing this id | 0 | 0 (unchanged — none existed, none would be created) |
| `Collection` (`cmsnkcia50012frdhuli9fqu0`) record count | 3 (Market Garden, Normandy, Warsaw Uprising, +others not sampled) | +1 (Battle of Britain rejoins its original collection) |

**No other row in any table would be touched.** The proposed operation is a single `prisma.record.create()` call with an explicit `id`, writing to the `records` table only.

---

## Not yet authorized

This preview is complete. Per your instruction, **no restore will be executed** until you've reviewed this and explicitly approve. If approved, I would run the `record.create()` call shown conceptually in my earlier note, with every field populated exactly as listed in the table above (not abbreviated), then re-run the read-only verification queries (record exists, correct collection, zero orphans elsewhere) to confirm the restore matches this preview exactly before reporting it complete.
