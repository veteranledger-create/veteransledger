# Production Content & Translation Incident Report

**Date:** 2026-08-16
**Environment:** `https://veteransledger.com` (Cloudflare in front)
**Method:** read-only. GET requests only. No login, no writes, no production data or configuration changed.
**Working tree at investigation start and end:** identical (see §16).

---

## 1. Exact symptoms as reported

| # | Reported symptom | Verdict |
|---|---|---|
| 1 | Admin may still appear to load | **Confirmed — and it fully works.** Not a defect. |
| 2 | Published/public website has no content | **Partly misattributed.** English text content *does* render. What is missing is every record **image**. |
| 3 | Content Pages may appear empty | **Not a defect.** "Select a page →" is the normal pre-selection state; all Admin modules load 200. |
| 4 | Public site cannot retrieve published content | **Not confirmed.** All `public/data/*.json` return 200, byte-identical to local. |
| 5 | Translation does not work for any language | **Confirmed. HTTP 500 on all 8 locales.** This is the real production-only failure. |

---

## 2. Local baseline

| Path | Status | Bytes | Backing store |
|---|---|---|---|
| `/public/data/homepage.json` | 200 | 1750 | file |
| `/api/site-content?key=homepage.json` | 200 | 1455 | file |
| `/api/translations/site_content/homepage.json/de` | 200 | 2339 | **DB** |
| `/api/translations/site_content/homepage.json/ja` | 200 | 2320 | **DB** |

Local DB: **184 records** (all published), **72 translations** (exactly 9 per locale × 8 locales), 1 user.

---

## 3. Production baseline

| Path | Status | Bytes | Note |
|---|---|---|---|
| `/` | 200 | 6437 | renders correctly |
| `/campaigns` | 200 | 3278 | renders correctly |
| `/admin` | 200 (browser) | — | login page renders, zero console errors |
| `/public/data/homepage.json` | 200 | 1750 | identical to local |
| `/public/data/navigation.json` | 200 | 10861 | identical to local |
| `/public/data/campaigns/index.json` | 200 | 1220 | identical to local |
| `/public/data/campaigns/africa/tobruk.json` | 200 | 2986 | identical to local |
| `/api/site-content?key=homepage.json` | 200 | 1455 | identical to local |
| **`/api/translations/site_content/homepage.json/{locale}`** | **500** | 1310 | **all 8 locales** |

`MAINTENANCE_MODE` is **off** in production (`/` returns real content, not 503).

---

## 4. Local vs production comparison — same item, `homepage.json`

| Dimension | LOCAL | PRODUCTION | Diverges |
|---|---|---|---|
| Admin GET (`/api/site-content`) | 200, 1455 B | 200, 1455 B | no |
| Public GET (`/public/data/…`) | 200, 1750 B | 200, 1750 B | no |
| File content | identical | identical | no |
| ETag | `W/"6d6-1a00952ec66"` | `W/"6d6-1a006c970a0"` | size `6d6` identical; only mtime differs |
| Auth required for read | none | none | no |
| **Translation GET `/de`** | **200, 2339 B** | **500, 1310 B** | **YES ← the break** |
| Static asset `/storage/images/campaigns/sonnenblume.jpg` | **404** | **404** | no — broken in both |
| Search `?q=panzer` | **21 results** | **0 results** | **YES** |
| Search `?q=britain` | 11 results | **0 results** | **YES** |
| Search `?q=tiger` | 3 results | **0 results** | **YES** |

---

## 5. Data-flow diagram

```
                          ┌──────────────────────────────────────┐
  ADMIN  ──PUT /api/site-content?key=──▶│  public/data/**.json  (FILES)  │◀── git-tracked, 150/150
                          └──────────────────────────────────────┘
                                            │
  PUBLIC SITE ──GET /public/data/**.json────┘   ✅ WORKS IN PRODUCTION

                          ┌──────────────────────────────────────┐
  ADMIN  ──CRUD /api/{module}──────────▶│  PostgreSQL  (records, etc.)   │  ❌ PROD TABLE EMPTY
                          │              │  translations                  │  ❌ PROD TABLE MISSING
                          └──────────────────────────────────────┘
                                            │
  PUBLIC SITE ──GET /api/translations/──────┘   ❌ HTTP 500 ← BREAK IS HERE
```

The public site consumes exactly **two** API endpoints: `/api/contact` and `/api/translations`. Everything else is a static file read. That is why English content survives a totally broken database, and translations do not.

---

## 6. Exact root cause

```
The table `public.translations` does not exist in the current database.
```

Prisma **reached** the production database and returned a *schema* error, not a connection error. The production database is connected and healthy; its **schema is behind the repository**.

Stack trace from production (`/app/dist/modules/translations/translations.service.js:194`) proves:
- production runs from **`/app/dist/`** — a **container** layout, not a VPS checkout;
- the code deployed is current (line 194 matches the current source);
- only the **database** is stale.

**Migration state, established from read-only evidence:**

| # | Migration | Creates / Alters | Applied in prod? | Evidence |
|---|---|---|---|---|
| 1 | `20260101000000_init` | users, collections, **records**, entities, entity_aliases, relationships, timeline_events, sources, citations, media_assets, audit_logs, preservation_records | ✅ **Yes** | `/api/search` returns 200 (not 500) → `records` + `entities` exist |
| 2 | `20260629000000_add_translations` | **`translations`** + 2 indexes | ❌ **No** | explicit Prisma "table does not exist" |
| 3 | `20260712000000_add_translation_published_status` | `translations.publishedAt` + index | ❌ **No** | depends on #2 |
| 4 | `20260716000000_community_foundation` | 7 `community_*` tables | ❌ **No** | inferred — Prisma applies in order and halts |
| 5 | `20260717000000_fix_migration_drift` | `timeline_events.year`; relaxes 2 constraints; 7 indexes | ❌ **No** | inferred — depends on #2 |

**Production is 4 migrations behind.**

### Second, independent finding: the production database is empty

`/api/search` returns **0 results in production** for three separate queries that return 3 / 11 / 21 locally. The `records` table exists but holds **no rows**.

This definitively answers the open question: **production uses a separate database from local, and it has never been populated.**

Consequence not visible from the public site: once logged in, production Admin will show **empty lists for every DB-backed module** — Campaigns, Armaments, Personnel, Letters, Formations, Timeline, Awards, Maps, Political Docs, Articles.

---

## 7. Was Cloudflare involved?

**No — not in the content or translation failure.**

| Endpoint | Result | CF-Cache-Status | Verdict |
|---|---|---|---|
| `/` | 200 | DYNAMIC | passes through |
| `/public/data/*.json` | 200 | DYNAMIC | passes through, not cached |
| `/api/site-content` | 200 | DYNAMIC | passes through |
| `/api/translations/*` | **500** | DYNAMIC | **origin error passed through faithfully** |

Cloudflare returned the origin's own 500 with the origin's own Prisma error body. No WAF block, no cached empty response, no stale JSON, no CORS failure, no rate limit, no OPTIONS failure.

Two Cloudflare behaviours observed, **neither causal**:

1. **`/admin` returns 403 "Just a moment…" to curl.** This is a JS bot-challenge. A real browser solves it automatically — I loaded `/admin` in the browser and the login page rendered with **zero console errors** and **all 30+ Admin modules loading 200**. Legitimate admin access is not blocked.
2. **Cloudflare injects `static.cloudflareinsights.com/beacon.min.js`, which the site's own CSP blocks** (`script-src 'self' 'unsafe-inline'`). Cosmetic console error on every page. Cloudflare analytics simply won't work until either the CSP allows that host or Web Analytics is disabled. No content impact.

**Do not change Cloudflare configuration to fix this incident. It is not the cause.**

---

## 8. Content Pages diagnosis

Not a defect. `PAGE_FILES` in `pages-admin.js` is a hardcoded 13-entry array; the sidebar renders on tab click and the editor shows "Select a page →" until one is chosen. Production serves `pages-admin.js` 200 and the module initialises cleanly. The empty-looking state is the normal pre-selection state.

Verified in production: all Admin modules load 200, zero console errors on `/admin`.

---

## 9. Translation diagnosis

Cause: **missing database table** — none of the other candidates.

Ruled out by evidence: wrong API URL (frontend uses relative paths; endpoint resolves and reaches the origin), 401/403 (route is `optionalAuth`, and it returns 500 not 401), 404, 429, CORS (`access-control-allow-credentials: true` present, no preflight failure), CSRF, Cloudflare/WAF (see §7), caching (`DYNAMIC`, no `Age`), missing JSON files (translations are DB-backed, not file-backed), frontend/backend env vars, incorrect route, malformed response, production filesystem.

**Important — the migration alone will not make translations appear.** `isSourcePublished()` returns `true` unconditionally for `site_content`, so the call proceeds straight to `translation.findUnique()`. After the migration the table will exist but hold **zero rows**, so:

- `500` becomes `404`
- `translation-loader.js` treats 404 as "no translation" and **silently falls back to English**
- The public site stops erroring, but **still displays English only**

Restoring actual translated output additionally requires the 72 translation rows to exist in the production database. That is a **separate data question**, deliberately not folded into the fix below.

---

## 10. Deployment diagnosis

| Question | Answer |
|---|---|
| Is `public/data/*.json` committed source? | **Yes** — 150/150 tracked in git |
| Generated at build? | No |
| Runtime mutable? | **Yes** — Admin writes to it via `PUT /api/site-content` |
| Container or VPS? | **Container** — production stack traces show `/app/dist/…` and `/app/node_modules/…` |
| Filesystem writable? | Presumably yes (Admin save path exists), not tested — would require a production write |
| Filesystem persistent across redeploy? | **No, for `public/data`** — it is git-tracked, so a redeploy restores the committed version and discards runtime Admin edits |
| Does the deployment artifact contain the files? | **Yes** — verified byte-identical over HTTP |
| Are they readable by the production process? | **Yes** |
| Does the repo document this deployment? | **No.** No Dockerfile, no compose file, no CI workflow (`.github/` does not exist), no PaaS config, no nginx config, no process-manager config, and no commit in history mentions deployment. |

`config.paths` is **not** implicated: both `ts-node src/index.ts` and `node dist/index.js` resolve `../../public` to the same `<root>/public`.

---

## 11. Files, routes and services involved

| Item | Role |
|---|---|
| `src/modules/translations/translations.service.ts:194` | throw site — `translation.findUnique()` |
| `src/modules/translations/translations.routes.ts` | `optionalAuth`; public read is correctly unauthenticated |
| `src/modules/translations/translations.controller.ts:26` | propagates the Prisma error |
| `prisma/migrations/20260629000000_add_translations/` | **the missing migration** |
| `frontend/pages/shared/translation-loader.js` | catches failure, falls back to English |
| `src/app.ts:74` | `app.use("/public", express.static(config.paths.public))` — the working static path |
| `src/modules/site-content/site-content.service.ts` | file read/write, working correctly in production |

---

## 12. Security implications observed (read-only, not changed)

1. **🔴 Full stack traces are returned to unauthenticated callers in production.** The 500 body contained the Prisma invocation, source snippet with line numbers, internal paths (`/app/dist/…`, `/app/node_modules/…`), and a full JS stack. The 401 bodies also include `stack`. This discloses internal structure to anyone. Worth fixing, **separately from this incident** — it is what allowed me to diagnose this so precisely, but it should not be reachable publicly.
2. `GET /api/site-content` is unauthenticated. Consistent with the public site reading the same files; appears intentional.
3. `PUT /api/site-content` has no server-side schema validation (carried over from the prior audit; unchanged).

---

## 13. Verification matrix (current state, pre-fix)

| # | Check | Result |
|---|---|---|
| 1 | `/admin` reachable in real browser | ✅ login page renders |
| 2 | Admin modules load | ✅ all 200, zero console errors |
| 3 | Production login performed | ⛔ **not performed, by instruction** |
| 4 | Production write performed | ⛔ **none** |
| 5 | Public static content loads | ✅ all 200, byte-identical to local |
| 6 | Public pages render | ✅ `/` and `/campaigns` render |
| 7 | `/api/translations` fails | ✅ 500, all 8 locales, missing-table error |
| 8 | Migration state established | ✅ #1 applied, #2–#5 pending |
| 9 | Destructive migration present | ✅ **none** (see §14) |
| 10 | Cloudflare implicated | ✅ **no** |
| 11 | Migrations run | ⛔ **not run, awaiting approval** |
| 12 | Production config changed | ⛔ **none** |
| 13 | `tsc --noEmit` | ✅ clean |
| 14 | `git status` vs investigation start | ✅ identical |

---

## 14. Required fix plan — **NOT EXECUTED, approval requested**

### Exact command

```bash
npx prisma migrate deploy
```

Run **inside the production container**, with the production `DATABASE_URL` in the environment.

`migrate deploy` is the production-safe command: it applies pending migrations in order, never resets, never prompts, never generates new migrations. **Do not use `npm run prisma:migrate`** — that maps to `prisma migrate dev`, which is interactive and can reset a database.

### Recommended read-only precheck, first

```bash
npx prisma migrate status
```

This writes nothing and prints exactly which migrations are applied vs pending. It also resolves the one thing I could **not** determine remotely (see risk below).

### Migrations production is missing

1. `20260629000000_add_translations`
2. `20260712000000_add_translation_published_status`
3. `20260716000000_community_foundation`
4. `20260717000000_fix_migration_drift`

### Expected schema change

| Migration | Statements | Type |
|---|---|---|
| add_translations | `CREATE TABLE translations`; 2 indexes | additive |
| add_translation_published_status | `ALTER TABLE translations ADD COLUMN publishedAt`; 1 index | additive |
| community_foundation | `CREATE TABLE` × 7 (`community_*`); FK constraints | additive |
| fix_migration_drift | `ALTER TABLE timeline_events ADD COLUMN year`; `ALTER COLUMN date DROP NOT NULL`; `ALTER COLUMN translations.fields DROP DEFAULT`; 7 `CREATE INDEX` | additive + relaxing |

### Confirmation: no data-destructive migration

**Confirmed.** Scanned all 5 migration files for `DROP TABLE`, `DROP COLUMN`, `TRUNCATE`, `DELETE FROM`, `DROP TYPE`, `DROP DATABASE`, `DROP SCHEMA`: **0 matches in all 5**.

The only two `DROP` statements are constraint-relaxing, not data-removing:
- `ALTER COLUMN "date" DROP NOT NULL` — relaxes a constraint; existing rows unaffected
- `ALTER COLUMN "fields" DROP DEFAULT` — removes a DB-level default; existing rows unaffected, and Prisma Client always supplies `fields` explicitly

Combined with the fact that the target tables are currently **empty**, the data-loss risk is effectively nil.

### Backup / recovery position

⚠️ **I could not determine this and I am not able to.** It depends on the container host and managed-Postgres provider, neither of which is represented in the repository. **You must confirm a restore point exists before approving.**

### Risk I could not resolve remotely

If production's schema was created with `prisma db push` rather than `prisma migrate deploy`, there will be **no `_prisma_migrations` table**, and `migrate deploy` will attempt migration #1 first and **fail** with "relation already exists". That failure is **non-destructive** — it aborts before changing anything — but it would not fix the problem, and would need `prisma migrate resolve --applied 20260101000000_init` first.

`prisma migrate status` distinguishes these two cases in one read-only command. **Run it first.**

### What this fix will and will not achieve

| | After migration |
|---|---|
| `/api/translations/*` returns 500 | ✅ **Fixed** — becomes 404 |
| Public site error-free | ✅ **Fixed** |
| Public site shows translated text | ❌ **Not fixed** — table will be empty; falls back to English |
| Admin shows records | ❌ **Not fixed** — `records` table is empty |
| Missing images | ❌ **Unrelated** (item B) |

---

## 15. The four issues, deliberately kept separate

### A. Immediate blocker — missing production `translations` table
Production is 4 migrations behind; `/api/translations/*` 500s for all 8 locales. **Fix: `prisma migrate deploy` (§14), pending your approval.** This is the only item in the fix plan.

### A2. Related but distinct — production database has no data
`records` is empty (0 vs 184 locally). Not caused by, and not fixed by, the migration. Needs its own decision about how production content is seeded or imported. **No action proposed here.**

### B. Secondary asset problem — missing `/storage/images/**`
`public/data/**` references **91** unique `/storage/images/…` paths. Only **2** image files exist on disk locally and **0** are tracked in git (`.gitignore:18` — `storage/images/`). The same image returns **404 on both local and production**, so this is *not* a deployment regression and not production-specific. It is what produces the "FILE NOT AVAILABLE / ARCHIVE DOCUMENT MISSING" placeholders and is the visual basis for "the site has no content". Pre-existing, previously documented. **No action proposed here.**

### C. Architectural issue — `public/data` is git-tracked source *and* runtime-mutable
Admin writes to files that are also committed. Any redeploy restores the committed version and **silently discards production Admin edits**. There is no history or rollback for site-content saves. Real, but it is a design decision, not this incident's cause. **No action proposed here.**

### D. Deployment/documentation gap
Production runs from `/app/dist/` in a container, but the repository contains **no deployment configuration of any kind** and no migration step in any start command. That absence is precisely why the schema drifted: nothing in the repo ever runs `migrate deploy`. **No action proposed here** — but this is the systemic reason A happened, and it will recur until a deploy step exists.

---

## 16. Database / filesystem drift from this investigation

**Zero.** No production write, no login, no configuration change, no Cloudflare change, no migration. All production access was GET.

Local: `git status` byte-identical to the start of the investigation — the same 6 modified Admin files, 1 new `admin-file-editor-guard.js`, and 3 report files from the previous track. One scratch diagnostic script was created and deleted. `tsc --noEmit` clean.

---

## 17. Remaining unrelated issues

Carried forward, unchanged, from the prior audit: no server-side schema validation on `PUT /api/site-content`; `homepage.json` dual-editability; icon-picker modal not registered with the shared modal stack; no history/rollback for site-content saves. New from this investigation: stack traces exposed publicly in production (§12.1); Cloudflare beacon blocked by CSP (§7.2).

---

## 18. Recommended architecture (not implemented)

1. **Add a migration step to deployment.** `prisma migrate deploy` must run on every deploy before the server starts. Its absence is root cause D and the reason for A.
2. **Commit the deployment definition.** A Dockerfile/compose file in the repo would make the `/app` container reproducible and reviewable.
3. **Disable stack traces in production responses** — gate `details`/`stack` on `config.isDevelopment`.
4. **Decide what `public/data` is.** Either build-time source (Admin should not write it) or runtime data (it should leave git and move to a persistent volume). It cannot safely be both.
5. **Decide how production gets content.** The production DB is empty; there is currently no documented path from local content to production.

---

## Approval requested

I have **not** run any migration and have **not** written to production.

To proceed with item **A** only, I need:
1. Confirmation that a database backup or restore point exists;
2. Approval to run `npx prisma migrate status` (read-only) and then `npx prisma migrate deploy` in the production container;
3. Confirmation of how you want me to reach the production environment, since the repository documents no deployment mechanism.

Items **A2**, **B**, **C** and **D** remain untouched pending separate decisions.
