# Admin/CMS — Final Architectural Gap Audit + Migration Status Matrix + Roadmap

**Date:** 2026-08-15
**Scope:** Read-only. No code was modified, no database or file writes were performed, at any point during this audit. Confirmed via `git status` before and after — identical.

---

## 🔴 Critical finding, discovered during this audit, more urgent than anything else in this report

While cross-referencing the metadata-merge fix's coverage (to answer "any known pre-existing issues not yet addressed" below), I checked whether `formations.service.ts` and `armaments.service.ts` had ever been verified against the same wholesale-metadata-replace bug class fixed this session for Campaigns/Articles/Letters/Awards-Maps-PolDocs/Timeline/Personnel. They had not.

**`formations.service.ts`'s `update()` has zero metadata protection — the exact same defect, unfixed — and it is confirmed live on real data:**

```ts
async update(id: string, data: object, userId: string) {
  const record = await notFoundAs404(
    () => prisma.record.update({
      where: { id },
      data: pickFormationFields(data) as ...,   // wholesale metadata replace, no merge
    }),
    "Formation not found",
  );
  ...
}
```

`formations.generator.ts` reads a long list of optional metadata fields the Admin form does not manage: `overview_blocks`, `context_blocks`, `dossier`, `shield`, `flag`, `region`, `volunteer_origin`, `parent_formation`, `constituent_divisions`, `predecessor`, `fate`, `subordinate_units`, `campaign_participation`. A read-only scan of all 32 real Formation records confirms:

**All 32 of 32 real Formation records (100%) currently carry at-risk fields — `overview_blocks` and `context_blocks` are present on every single one.** These read as substantial narrative content (an "Overview" block-based section and a "Historical Context" block-based section per formation), not secondary statistics — likely richer and more central to each page than Personnel's kill counts were. Sample: Heeresgruppe Nord, Heeresgruppe Süd, Deutsches Afrikakorps, all three SS-Panzer divisions, all three Luftflotten, the Kriegsmarine surface fleet, every volunteer/foreign formation (several of which also carry `shield`, `flag`, `region`, `volunteer_origin`, `parent_formation`, `fate`) — literally every one of the 32.

**This was not fixed** — this turn was explicitly read-only, per your instruction, and Formations is outside this audit's nominal scope (NSDAP/Content Pages/Homepage/site-content). But it is more severe than the Personnel finding that triggered the whole metadata-merge fix chain (14/46 = 30% there; 32/32 = 100% here), on a real, populated, published content type. **Recommend this become the very next priority — ahead of any further migration work or the site-content cleanup below.**

`armaments.service.ts` was also checked: its `update()` already does a **manual, hand-rolled, field-by-field merge** (`input.X ?? existingMeta.X` for each named field) — functionally similar protective intent to `mergeMetadata()`, but implemented as an explicit list rather than the general helper. This means it's *less* exposed than Formations was, but it inherits the exact risk your Personnel-fix instruction explicitly warned against: **any metadata field not in that hand-written list is still silently dropped on save.** I did not fully audit `armaments.generator.ts` for a catch-all extras pattern or check real Armament records (85 of them — the largest content type) for at-risk fields, since that goes beyond this audit's read-only scope for this turn; flagging it as **worth the same targeted check Formations just got**, not confirmed either way.

---

## Part 1 — Site-content architecture audit (the requested scope)

### Backend: `site-content.service.ts` / `.controller.ts` / `.routes.ts`

- **File-based, not database-backed.** Reads/writes raw JSON files under `public/data/`, via Node's `fs/promises` — no Prisma involvement anywhere in this module.
- `ALLOWED_PREFIXES` allowlist (`navigation.json`, `site-settings.json`, `homepage.json`, `page-content.json`, `ui-strings.json`, `about`, `legal`, `site-policies`, `nsdap`, `formations`, plus 8 section `index.json` manifests) with real path-traversal protection (blocks `..`, absolute paths, backslashes; double-checks the resolved path stays inside the data directory).
- **`GET /api/site-content` has no auth middleware at all** — publicly readable without a token. `PUT` correctly requires `authenticate + requireAdmin`. This is very likely intentional (the public site itself needs to read this data to render pages), but it's worth stating explicitly rather than leaving implicit — it means anyone can read any allowed key's current content, including keys not yet published anywhere else.
- **Zero server-side schema/body validation on write.** No express-validator middleware on the PUT route at all — literally any JSON shape can be written to any allowed key. Every DB-backed module, by contrast, has an express-validator schema. This is a real, consistent gap across every site-content-backed area (see Part 3).
- **No history/rollback specific to site-content saves.** Unlike the Record publish pipeline (explicit validate → stage → promote → rollback), a site-content `PUT` is immediate, whole-file, and has no in-app undo.
- **The save pattern itself is architecturally sound**, unlike the DB metadata bug class: because each key IS one whole file (not a DB row with a client-supplied subset), every admin JS file that writes here first loads the *entire* current file into memory, mutates only the specific top-level keys its own UI manages, and writes the *entire* object back. That's the same effective guarantee `mergeMetadata()` gives the DB-backed services — just implemented ad hoc, per file, rather than via a shared helper. I did not find a single site-content admin file that replaces the whole file with only its own managed subset the way the DB bug class did.

### Per-area findings

**NSDAP** (`nsdap-admin.js`, ~23 fixed file keys under `nsdap/*`)
- Sidebar of hardcoded keys; 3 files get purpose-built structured editors (Overview, Chronology, Glossary); everything else gets a raw-JSON textarea with client-side parse validation before save.
- Save: whole-file replace per key — correct for this shape.
- Validation: none server-side; client-side JSON.parse() only.
- Translation integration: works (`TranslationsPanel("nsdap-translations-panel", "site_content")`, keyed by file path).
- **Dirty-state: none.** No `registerDirtyGuard()` call anywhere in the file — confirmed via `grep` across every site-content admin file (zero matches outside `admin-content-module.js`/`admin.js`/`admin-dirty-guard.js` itself).
- Modal usage: none of its own.
- Responsive: `.sidebar-layout` collapses to a single column at `max-width:768px` (confirmed in `admin.css`) — handled.
- Recommendation: **targeted cleanup only** (add dirty-guard registration). Not a `createContentModule()` candidate — confirmed again this session, no new information changes that conclusion.

**Content Pages** (`pages-admin.js`, 13 fixed keys: `homepage.json` + `about/*` + `site-policies/*` + `legal/*`)
- Uses `admin-structured-editor.js` — a genuinely well-designed, already-reusable, schema-tolerant editor (strings → inputs, numbers/booleans → typed inputs, a `content` array → a full block editor matching the public renderers' block shapes exactly, everything else → per-key JSON in a collapsed "Advanced" section) plus an optional Developer-mode raw-JSON toggle.
- Save: `structured.read()` reconstructs the full object from the current editor state — correct pattern.
- Validation: none server-side; client-side JSON validation in both structured (per-Advanced-field) and Developer (whole-file) modes.
- Translation integration: works.
- **Dirty-state: none.**
- Responsive: `.sidebar-layout--narrow` collapses at 768px — handled.
- **Notable overlap: `homepage.json` is editable through *two* separate admin UIs** — this generic Pages editor *and* the dedicated Homepage tab below, both writing to the same file via the same endpoint. Not a data-corruption risk (both go through the same whole-file-load-then-write pattern), but a real source of admin confusion, and the two editors don't necessarily round-trip `archiveCards` identically (Homepage's dedicated card-collection UI vs. Pages' generic per-key JSON/Advanced-field handling for the same array).
- Recommendation: **targeted cleanup** (dirty-guard) + **resolve the Homepage overlap** (drop `homepage.json` from `PAGE_FILES`, since the dedicated tab is the better-purpose-built tool for it).

**Homepage** (`homepage-admin.js`, dedicated tab, `homepage.json`)
- Hero fields as a plain form; `archiveCards` as a genuinely well-built managed collection (add / duplicate / reorder / enable-disable / delete), integrating the shared `admin-icon-picker.js`.
- Save: loads whole file, mutates only `hero`/`browseSectionLabel`/`archiveCards`, writes whole file back — sound.
- The icon-picker modal (`#icon-picker-modal`) is **self-managed, not registered with the shared `admin-modal-stack.js`** — it has its own Escape handler and backdrop-click handler, which work correctly on their own, but it doesn't participate in the shared focus-trap/restoration/Ctrl+S-routing system every other Admin modal gets "for free." Low-impact (it has no save action to route to), but architecturally inconsistent with the stated design principle of that shared module.
- **Dirty-state: none.**
- Translation integration: works.
- Recommendation: **targeted cleanup** (dirty-guard; optionally register the icon-picker modal with the shared stack for consistency, though functionally it already works).

**Navigation** (`navigation-admin.js`, `navigation.json`)
- Structured fields for brand/footer text; 5 array-shaped sub-structures (stats, info items, legal links, social links, the nav-items tree) are exposed as **raw JSON textareas with no visual editor** — a real usability gap relative to Content Pages' block editor, though not a data-integrity one (still whole-file-load-then-mutate-then-save).
- Validation: none server-side; client-side try/catch JSON.parse for the 5 raw fields.
- **Dirty-state: none.**
- Translation integration: works.
- Recommendation: **targeted cleanup** (dirty-guard). The raw-JSON-array UX gap is a genuine usability improvement opportunity but not a correctness issue — optional, lower priority.

**Site Settings** (`site-settings-admin.js`, `site-settings.json`)
- Structured fields for general/contact-modal/cookie-banner text + a single "Advanced — Full JSON" textarea for the entire file, which becomes the merge *base* if non-empty (structured fields are then applied on top of whichever base is in play). Sensible design; the one subtlety is that if an admin edits both the structured fields and the Advanced JSON in a conflicting way in the same session, the structured fields silently win — a minor, low-probability UX footgun, not a data-loss bug.
- **Dirty-state: none.**
- Translation integration: works.
- Recommendation: **targeted cleanup** (dirty-guard) only.

**Page Content** (`page-content-admin.js`, `page-content.json`)
- Cleanest of the group: a hardcoded 14-page picker, structured `meta`/`hero`/(About-only)`archiveInfo` fields, no raw-JSON exposure at all.
- Save: targeted property assignment onto the already-loaded per-page entry — sound, and (unlike a wholesale key replace) implicitly preserves any other properties that entry might carry beyond `meta`/`hero`/`archiveInfo`.
- **Dirty-state: none.**
- Translation integration: works.
- Recommendation: **targeted cleanup** (dirty-guard) only. This is the best-behaved of the six areas already.

**Translation Dashboard** (`translations-admin.js`, `tab-translations`)
- **Not a site-content editor** — a cross-cutting coverage/bulk-action dashboard spanning every translatable content type (records, personnel, timeline events, *and* the 5 core site_content keys via a small hardcoded `SITE_CONTENT_KEYS` list). Every action (Generate/Regenerate) is applied immediately via its own API call — there is no "unsaved form state" to protect, so it correctly has no save button and needs no dirty-guard.
- Recommendation: **no restructuring at all.** This is a distinct, appropriately-scoped tool, not part of the "fixed-file editor" family and not a migration candidate of any kind.

### Cross-cutting findings across the six file-editing areas (NSDAP, Content Pages, Homepage, Navigation, Site Settings, Page Content)

1. **Zero dirty-state protection, consistently, across all six.** The single most important, most uniform gap found. None call `registerDirtyGuard()`. An admin who types a long NSDAP chapter, a full Homepage rewrite, or an extensive Navigation edit and then switches tabs or closes the browser gets no warning at all — everything is silently lost. This is the one issue every one of the six areas shares identically.
2. **Ctrl+S already works uniformly for all six**, and I want to give credit rather than just flag gaps: `admin.js`'s global Ctrl+S handler has a third fallback branch specifically for "Sidebar editors (NSDAP, Pages)" that looks for `.btn-primary[id$='-save-btn'], .btn-primary[id$='-save']` on the active tab panel — and every one of the six save buttons (`nsdap-save-btn`, `nav-save-btn`, `settings-save-btn`, `pce-save-btn`, `homepage-save-btn`, `pages-save-btn`) matches that convention. This already-existing infra is well-designed and needs no change.
3. **Zero server-side schema validation**, uniformly, backend-side (see Part 1's backend section above) — a single fix at the `site-content.service.ts`/route level (if ever addressed) would benefit all six areas at once, rather than needing six separate changes.
4. **Translation integration works correctly and consistently** across all six — no gap here at all.
5. **Responsive layout is fine across all six** — either via `.sidebar-layout`'s explicit 768px breakpoint (NSDAP, Content Pages) or via the same shared `.contact-form__input`/`.form-grid-*` classes every DB-backed form already uses and has already been verified responsive (Navigation, Settings, Homepage, Page Content).
6. **No database/file consistency risk of the DB-metadata-wholesale-replace kind** — confirmed above, the load-whole-then-mutate-then-save pattern is already correct everywhere in this group.

---

## Part 2 — Recommendation: shared abstraction, targeted cleanup, or no restructuring?

**Targeted cleanup — not a new shared abstraction — for all six file-editing areas.** The actual defect surface here is narrow and identical everywhere: missing dirty-state registration. The save logic itself is already sound in every case (unlike the DB metadata bug class, which needed a real architectural fix). Building a parallel "fixed-file editor factory" alongside `createContentModule()` would be solving a problem that mostly doesn't exist here — there's no create/delete/list/pagination concept to generalize, and the six files' save logic is each correctly hand-fit to its own file's shape already.

The one piece of *genuinely reusable* infrastructure worth adding is small and already has a template to follow: each of the six files' `handleSave()`/`loadX()` pair already tracks a `fullData`/`currentData` snapshot in a closure variable — the same shape `createContentModule()`'s own `computeSnapshot()`/`isDirty()` internally use for DB-backed forms. A ~10-line addition per file (or one small shared helper each file calls with its own snapshot-comparison function) would let all six call `registerDirtyGuard(tabPanelId, isDirtyFn)` using the *existing* `admin-dirty-guard.js` primitive — no new module needed, no `createContentModule()` involvement, just closing the one real gap using infrastructure that already exists.

**Translation Dashboard needs nothing at all** — it's correctly scoped as-is.

---

## Part 3 — Full Admin migration status matrix

| Admin area | Status | Notes |
|---|---|---|
| Formations | **Needs Work** | Migrated onto `createContentModule()` (Phase 3 pilot) and fully regression-tested, but **metadata wholesale-replace bug confirmed live and unfixed** — 32/32 real records affected. Highest-priority outstanding item in the whole Admin system. |
| Armaments | **Needs Work** (lower confidence) | Migrated (Batch 1), regression-tested. Has a hand-rolled, field-by-field metadata merge in `update()` — not the shared `mergeMetadata()` helper, and not confirmed complete (an unlisted/future field would still be dropped). Not fully re-audited this session; flagged for a dedicated check. |
| Personnel | **Stabilized** | Migrated (Batch 1); metadata-merge bug found and fixed this session (14/46 real records were affected, now protected and verified — see `personnel-metadata-fix-report.md`); date-normalization applied. |
| Letters | **Stabilized** | Migrated (Batch 1); metadata-merge applied early in the incident-response chain; date-normalization applied. |
| Campaigns | **Stabilized** | Migrated (Batch 3); the metadata-merge bug that started this whole chain was found and fixed here first; date-normalization applied; fully regression-tested including the Battle of Britain recovery. |
| Articles | **Stabilized** | Migrated (Batch 3); metadata-merge applied; full regression completed (including the one previously-incomplete pass). |
| Awards | **Stabilized** | Migrated (Batch 2); shares `records.service.ts`, which now has metadata-merge applied. |
| Maps | **Stabilized** | Same as Awards. |
| Political Documents | **Stabilized** | Same as Awards; date-normalization applies to its `date` field specifically, verified. |
| Timeline | **Stabilized** | Migrated this session (pilot for Batch 4); metadata-merge applied; the pre-existing `summary`-never-persisted bug found and fixed; pagination added (new, disclosed behavior change); optional in-form delete-button support added to the shared factory as a genuine reusable extension. |
| NSDAP | **Intentionally Separate** | Fixed-file site-content editor, not a CRUD record list — confirmed again this audit. Needs targeted cleanup (dirty-guard), not migration. |
| Content Pages | **Intentionally Separate** | Same file-based pattern as NSDAP. Needs targeted cleanup + resolving the Homepage dual-editability overlap. |
| Homepage | **Intentionally Separate** | Same pattern. Needs targeted cleanup (dirty-guard). |
| Navigation | **Intentionally Separate** | Same pattern. Needs targeted cleanup (dirty-guard); optional raw-JSON-array UX improvement. |
| Site Settings | **Intentionally Separate** | Same pattern. Needs targeted cleanup (dirty-guard) only. |
| Page Content | **Intentionally Separate** | Same pattern, cleanest of the group. Needs targeted cleanup (dirty-guard) only. |
| Translation Dashboard | **Intentionally Separate** | Cross-cutting tool, not a content editor of any kind. No restructuring, no cleanup needed. |
| Media Library | **Intentionally Separate** | Its own dedicated upload/browse/delete tool (`admin.js`'s `loadMedia()`/`renderMediaGrid()`), not a record-list pattern, not touched or audited this round — out of scope, noted for completeness. |
| Publish Pipeline | **Intentionally Separate** | Its own validate/stage/promote/rollback dashboard (`admin.js`'s `runPublishAction()` family), fundamentally different from every other area, not touched or audited this round. |

**9 of 11 original content-record modules are migrated onto `createContentModule()`.** Formations and Armaments both need follow-up (Formations urgently); the other 7 are fully stabilized. NSDAP/Content Pages/Homepage/Navigation/Site Settings/Page Content/Translation Dashboard/Media/Publish are correctly outside that factory's scope by design — six of those nine need only the same small dirty-guard addition.

---

## Part 4 — Outstanding issues, consolidated

1. **🔴 Formations metadata wholesale-replace — live, 100% of real records affected, unfixed.** New finding this session (see top of report).
2. **🟡 Armaments' hand-rolled metadata merge — not confirmed complete.** New finding this session, needs a dedicated check (does `armaments.generator.ts` have a catch-all extras pattern the manual merge doesn't cover?).
3. **🟢 Date-normalization** (Task #50) — fixed and verified across every module with a date field (Campaigns, Letters, Political Docs, Personnel, Timeline).
4. **🟢 Metadata merge protection** — fixed and verified for Campaigns, Articles, Letters, Awards/Maps/PolDocs (`records.service.ts`), Timeline, Personnel. **Not yet applied to Formations (urgent) or confirmed for Armaments** — see #1/#2.
5. **🟢 Timeline summary persistence** — fixed and verified this session.
6. **🟡 Site-content: zero dirty-state protection**, uniformly across NSDAP/Content Pages/Homepage/Navigation/Site Settings/Page Content — new finding this audit, targeted cleanup recommended, not urgent (no data-integrity risk, just a missed-warning UX gap).
7. **🟡 Site-content: zero server-side schema validation** on the `PUT /api/site-content` route — new finding this audit, architectural note more than an active bug (nothing observed exploiting this), worth a future look.
8. **⚪ Site-content: `GET` route has no auth** — new finding, very likely intentional (the public site needs this data), documented rather than flagged as a bug.
9. **⚪ Homepage.json dual-editability** via both the Homepage tab and Content Pages — new finding, minor, recommend resolving alongside the dirty-guard cleanup.
10. **⚪ Icon-picker modal not registered with the shared modal stack** — new finding, cosmetic/architectural-consistency only, works correctly on its own.
11. **⚪ Formations' delete-confirmation text is generic** ("Delete this record?") instead of per-type — known since Batch 1, cosmetic, still deferred.
12. **⚪ Site-content saves have no history/rollback** (unlike the Record publish pipeline) — architectural note, not a bug, not evaluated for priority.

(🔴 urgent · 🟡 real but not urgent · 🟢 resolved · ⚪ informational/low-priority)

---

## Part 5 — Recommended final architecture

- **Keep `createContentModule()` exactly as-is** for the true CRUD-record-list pattern (Formations through Timeline). No changes to its shape are indicated by this audit — the `fixedListParams` (Batch 2) and optional `delete-btn` (this session's Timeline pilot) extensions have already proven it generalizes well without needing a rewrite.
- **Do not build a parallel "fixed-file editor factory."** The six site-content-backed areas' save logic is already correct and appropriately fit to each file's shape; the only common gap (dirty-state) is better solved by having each of the six make one small call into the *existing* `admin-dirty-guard.js`, not by introducing a new abstraction layer they'd all have to be rewritten to fit.
- **`admin-structured-editor.js` (currently used only by Content Pages) is the best-designed piece of infrastructure in this whole area** — schema-tolerant, already handles the block-content shape the public renderers expect, already has a clean `read()` contract. If NSDAP's three bespoke structured sub-editors (Overview/Chronology/Glossary) are ever revisited, converging them onto this same shared editor — rather than maintaining separate bespoke code for three specific files — would be a genuine simplification, not a new build. Not urgent; flagged as a "nice convergence," not a requirement.
- **Media Library and Publish Pipeline stay exactly as they are** — neither fits any CRUD-list or fixed-file-editor pattern; both are correctly their own thing.

---

## Part 6 — Final completion roadmap

1. **Fix Formations' metadata wholesale-replace bug** (apply `mergeMetadata()`, identical pattern to the other six services, same rigor: read-only baseline of all 32 records first, fixture-verify via the real Admin UI, prove the fix protects the real 32 without mutating them, full regression). This is the clear next step — more urgent than anything else on this list, given it's live and affects every real Formation record today.
2. **Audit + resolve Armaments' metadata-merge completeness** — determine whether its hand-rolled field-by-field merge has any gap the shared `mergeMetadata()` would close, using the same baseline-first methodology.
3. **Add dirty-guard registration to the six site-content areas** (NSDAP, Content Pages, Homepage, Navigation, Site Settings, Page Content) — one small, well-understood change per file, reusing existing infrastructure.
4. **Resolve the Homepage/Content-Pages dual-editability overlap** — most simply, drop `homepage.json` from Content Pages' file list.
5. *(Optional, lower priority)* Register the icon-picker modal with the shared modal stack for architectural consistency.
6. *(Optional, lower priority)* Consider a visual editor for Navigation's five raw-JSON array fields, converging on `admin-structured-editor.js`'s pattern.
7. *(Not scoped, deliberately deferred)* Site-content server-side schema validation, if ever prioritized — would benefit all six areas from one backend change.

**The Admin restructuring is not declared complete.** Steps 1–2 above are data-integrity work in the same category as the Personnel/Timeline fixes just completed, not new migration — recommend treating them as the immediate next priority, ahead of any further `createContentModule()` migration (there is none left to do — Formations through Timeline are all already migrated) and ahead of the site-content cleanup in steps 3–7.
