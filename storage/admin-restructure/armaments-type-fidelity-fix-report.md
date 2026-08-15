# Armaments Metadata Type-Fidelity Fix — Final Report

**Date:** 2026-08-15
**Status:** Complete and verified. No real Armament record was modified at any point.

---

## 1. Baseline (captured read-only, before any code change)

Full data: [`armaments-type-baseline.json`](armaments-type-baseline.json) — the exact JSON type and value of every unmanaged metadata field on all 85 real `ARMAMENT` records.

| Metric | Value |
|---|---|
| Total Armament records | 85 |
| Records with ≥1 non-string "extra" value | **83** |
| Records with a type-risky `SPEC_FIELD` value | **29** |
| Total non-string extra values at risk | **282** |

**Extra-value JSON type distribution (the `extraSpecs` round-trip):**

| JSON type | Count |
|---|---|
| string | 249 |
| **number** | **212** |
| **null** | **54** |
| **object** | **16** |

**`SPEC_FIELD` stored types** — `armament` is the type-risky one:

| Field | Stored types |
|---|---|
| `armament` | **string ×10, object ×15, array ×14** |
| `crew` | number ×38 |
| `units_produced` | number ×30 |
| `designation` / `manufacturer` / `engine` | string only |

Affected keys span 56 distinct names — `range_km` (31), `years_of_service` (35), `max_speed_kmh` (21), `year` (28), `weight_kg` (18), `dossier` (6), `type`/`image` (85 each), and many more.

---

## 2. Root cause

`armaments-admin.js` edits every metadata value through a plain text `<input>`. The round-trip was:

```js
// populateForm — value -> display text
value: typeof value === "object" ? JSON.stringify(value) : String(value)

// serializeForm — display text -> stored value
specs[key] = value;   // whatever string came back out of the input
```

So every value came back as a **string**, regardless of what it went in as. A save that changed one field silently retyped every other one on that record:

| Before | After a save (old behavior) |
|---|---|
| `range_km: 800` *(number)* | `range_km: "800"` *(string)* |
| `zz_boolean: true` *(boolean)* | `"true"` *(string)* |
| `dossier: { photos: [...] }` *(object)* | `'{"photos":[...]}'` *(a JSON **string**)* |
| `some_field: null` *(null)* | `"null"` *(string)* |
| `armament: ["7.5cm", "MG34"]` *(array)* | `'["7.5cm","MG34"]'` *(string)* |

This is why `mergeMetadata()` could not fix it: the form actively **sent** the corrupted values, and the merge faithfully preserved them. The fix had to be in the frontend round-trip.

---

## 3. The fix — generic, no hardcoded fields

Three small helpers in `armaments-admin.js`, applied to **any** key. No field is named anywhere; unknown and future metadata is covered identically.

```js
function metaValueToDisplay(value) {
  if (value === null) return "null";
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}

// Interpret edited text, preferring the original's type where compatible.
function displayToMetaValue(text, original) { /* null|number|boolean|object|array|string */ }

// The guarantee: unchanged text returns the original value untouched.
function resolveMetaValue(text, original) {
  if (original !== undefined && text === metaValueToDisplay(original)) return original;
  return displayToMetaValue(text, original);
}
```

**The key insight:** the original parsed value now rides alongside its display string (`{ key, value, original }` for extra specs; a `_specOriginals` map for the fixed `SPEC_FIELDS` inputs). If the admin didn't actually edit that input, the **original value is handed back verbatim** — exact type, exact content. That alone fixes the real bug, since the corruption only ever hit fields the admin never touched.

This also resolves a genuine ambiguity the old code could not: `zz_number: 800` (number) and `zz_numeric_string: "800"` (string) render as the *identical* text `"800"`. Only the retained original can tell them apart — and it does (verified in §4).

**Edited values** keep the original's type when the new text is compatible (`800` → `900` stays a number), and fall back to generic JSON inference otherwise. Malformed JSON returns the raw text rather than throwing.

**Deliberate, disclosed behavior change:** a *newly added* extra-spec row now infers its type (typing `1234` stores the number `1234`, not `"1234"`). Previously every new row stored a string. This is more correct and matches the "preserve arbitrary types" intent, but it is a change — flagging it rather than burying it. `SPEC_FIELDS` behavior for edited/new values is deliberately **unchanged** (`crew`/`units_produced` still `Number()`, everything else still string), so that path carries no regression risk.

**File changed:** `frontend/pages/Admin/armaments-admin.js` only. No backend change; no data-model change.

---

## 4. Fixture test — real Admin UI

Created a `ZZ-TEST` Armament carrying one of **every** JSON type, plus the two ambiguous cases and an arbitrary unknown field. Edited **exactly one managed field** (`summary`) through the real Admin UI and clicked the real Save button → **`200 OK`**.

**Before / after JSON types and values — every unmanaged field:**

| Field | Type before | Value before | Type after | Value after | Result |
|---|---|---|---|---|---|
| `zz_number` | number | `800` | **number** | `800` | PASS |
| `zz_boolean` | boolean | `true` | **boolean** | `true` | PASS |
| `zz_boolean_false` | boolean | `false` | **boolean** | `false` | PASS |
| `zz_null` | null | `null` | **null** | `null` | PASS |
| `zz_object` | object | `{photos:[{src,caption}],nested:{deep:1}}` | **object** | identical | PASS |
| `zz_array` | array | `[1,2,3]` | **array** | `[1,2,3]` | PASS |
| `zz_string` | string | `"ZZ-TEST plain string"` | **string** | identical | PASS |
| `zz_numeric_string` | string | `"800"` | **string** | `"800"` | PASS |
| `zz_float` | number | `3.14` | **number** | `3.14` | PASS |
| `zz_zero` | number | `0` | **number** | `0` | PASS |
| `custom_future_field` | string | `"ZZ-TEST-novel-field"` | **string** | identical | PASS |
| `armament` *(SPEC_FIELD)* | array | `["ZZ-TEST 7.5cm","ZZ-TEST MG34"]` | **array** | identical | PASS |
| `crew` *(SPEC_FIELD)* | number | `5` | **number** | `5` | PASS |
| `designation` *(SPEC_FIELD)* | string | `"ZZ-TEST-D1"` | **string** | identical | PASS |

Plus the provenance keys from the previous fix (`importRunId`, `fileNation`, `schemaType`) — all preserved. Translation intact. **17/17 passed.**

Under the old code, rows 1–6, 9, 10 and 12–13 would all have become strings.

**Second save — edit and new-row paths:**

| Case | Input | Result |
|---|---|---|
| Edited `zz_number` `800` → `900` | typed in the form | **`900` (number)** — stayed a number, PASS |
| New row `zz_new_number` = `1234` | typed in a new row | **`1234` (number)** — inferred, PASS |
| All 9 untouched fields after this *second* save | — | all types + values intact, PASS |

**Isolated unit tests of the round-trip logic: 27/27 passed** (untouched fidelity for all 12 type cases, edited-value type preference, new-row inference, malformed-JSON fallback).

---

## 5. Zero-write proof against the real records

Two steps, with **no `prisma` write call of any kind** in the verification script:

1. **Re-confirmed all 85 real Armaments byte-identical to the pre-fix baseline.** PASS.
2. **Replayed the new round-trip** (helpers copied verbatim) against every record's live metadata — simulating populate → no edits → serialize — and compared every rebuilt value against the live value and type.

| Metric | Result |
|---|---|
| Records replayed | 85 |
| Metadata values checked | **696** |
| Non-string values preserved with exact type | **379** |
| Type distribution preserved | string 317 · number 280 · null 54 · object 31 · array 14 |
| **All values + types preserved** | **PASS** |

---

## 6. CRUD + feature regression

| Feature | Result |
|---|---|
| Create (fixture) / Read (list + edit repopulate) / Update (×2 saves) / Delete (real UI button) | PASS |
| Media sections (gallery / blueprints / videos / documents) | PASS — rendered, unchanged |
| Translations panel | PASS — loaded |
| Sources | PASS — 2 inputs rendered |
| Related records | PASS — list present |
| **Duplicate detection** | PASS — matches within category (`aircraft` + "Focke-Wulf Fw 190" → 1 hit), correctly returns none across categories |
| Dirty-state | PASS — `false` on open, `true` after an extra-spec edit |
| Preview modal | PASS — opens, `role="dialog"`, focus trapped inside, correct rendered JSON showing `"crew": 5` and `"zz_null": null` |
| Escape | PASS — closes only the modal, form panel stays open |
| Ctrl+S | PASS — routes to the form submit |

---

## 7. Verification suite

- **`tsc --noEmit`:** clean.
- **`node --check`** on the modified file: clean.
- **Fresh Admin console** (new tab, fresh login, all 17 tabs): **zero errors.**
- **Fresh public-site console** (new tab, homepage): **zero errors.**
- **Public Armaments page:** 7 × `404` on `/storage/images/armaments/panzer/*.jpg`. **Pre-existing and unrelated** — verified three ways: the `storage/images/armaments/` directory does not exist at all; the paths originate in the published archive JSON (`public/data/armaments/panzer/germany.json`, i.e. original import data); and the public page never loads `armaments-admin.js` (confirmed 0 references). The page degrades gracefully to `placeholder-cards.webp`. Same class as the `/storage/images/campaigns/britain.jpg` path noted during the Battle of Britain recovery. Not introduced by this change; flagged as a separate pre-existing content issue.
- **Global `ZZ-TEST-*` sweep:** zero records, entities, timeline events, aliases.
- **Orphan sweep:** zero orphaned record/entity/timeline translations; MediaAsset 0; Citation 0; Relationship 28 (unchanged).
- **No leftover scratch scripts.**

---

## 8. Database before / after

| Table | `armaments-typefix-baseline` | `armaments-typefix-final` |
|---|---|---|
| Record total | 184 | 184 |
| — ARMAMENT | 85 | 85 |
| — FORMATION | 32 | 32 |
| Entity | 46 | 46 |
| TimelineEvent | 83 | 83 |
| Translation | 72 | 72 |
| Collection | 42 | 42 |
| Relationship | 28 | 28 |
| MediaAsset | 0 | 0 |
| AuditLog | 46 | 46 |

**Zero drift on every table**, AuditLog included (`armaments.service.ts` does not audit-log — a pre-existing characteristic, unchanged).

---

## 9. Proof that no real Armament record was modified

- All 85 read **before** the code change (baseline), re-read **after** the fix (step 1 of the proof), and re-read a **third** time in the final sweep — byte-identical every time.
- The protection proof ran the new logic **in memory only**; the script contains no `prisma.record.update/create/delete` call.
- The only writes this session were one `ZZ-TEST` Armament (created → saved twice → deleted) and its translation — fully removed, confirmed by the global sweep and by the Armament count returning to exactly 85.
- Table counts independently corroborate zero drift.

---

## 10. Scope discipline

Not touched, per instruction: NSDAP, Content Pages, Homepage, Navigation, Site Settings, Page Content — all still outside `createContentModule()`, all still needing only the dirty-guard addition documented in [`admin-architecture-audit-and-roadmap.md`](admin-architecture-audit-and-roadmap.md).

**Open items, unchanged:**
1. Site-content dirty-state protection (six areas).
2. No server-side schema validation on `PUT /api/site-content`.
3. `homepage.json` dual-editability.
4. Icon-picker modal not registered with the shared modal stack.
5. **New, noted this round:** missing `/storage/images/armaments/**` image files referenced by published archive JSON (pre-existing content gap, not code).

**The Admin data-integrity work is now complete across all eight DB-backed content services** — metadata wholesale-replace closed everywhere, date normalization applied, Timeline summary persistence fixed, Armaments provenance keys preserved, and Armaments metadata type fidelity restored.
