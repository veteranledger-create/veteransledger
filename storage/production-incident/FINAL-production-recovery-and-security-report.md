# Production Recovery & Security — Completion Report

**Date:** 2026-08-16
**Environment:** `https://veteransledger.com` — Railway, project `compassionate-recreation`, env `production`
**Status:** ⚠️ **RECOVERY WORK COMPLETED AND VERIFIED — BUT PRODUCTION IS CURRENTLY NOT SERVING.** See §16 (addendum). Five follow-up tasks documented, none implemented (§10–§14).

---

## 1. Original root cause

**The production PostgreSQL database was a separate, unmigrated, empty database.**

```
The table `public.translations` does not exist in the current database.
```

Prisma *reached* the production database and returned a **schema** error, not a connection error. Production had only ever run migration `20260101000000_init`; the four later migrations had never been applied. Nothing in the repository ever ran `prisma migrate deploy` — there is no Dockerfile, no CI workflow, no deploy configuration of any kind — so the schema silently drifted four migrations behind the code.

A second, independent problem: **the production database contained no data at all.** `/api/search` returned 0 results for queries returning 3 / 11 / 21 locally.

### What was *not* the cause

| Suspected | Verdict |
|---|---|
| Cloudflare | ❌ **Exonerated** — see §7 |
| `public/data/*.json` missing from the deploy | ❌ All 150 files present, **byte-identical to local** |
| `config.paths` resolving differently under `dist/` | ❌ Both runtimes resolve to `<root>/public` |
| `MAINTENANCE_MODE` | ❌ Off |
| Wrong API base URL / CORS / auth on public routes | ❌ All correct |
| "Public site has no content" | ⚠️ **Partly misattributed** — English text rendered fine. The visible "FILE NOT AVAILABLE" placeholders are missing `/storage/images/**` assets, which 404 **identically on local and production**. Pre-existing content gap, not a deployment fault. |
| "Content Pages empty" in Admin | ❌ Normal "Select a page →" pre-selection state |

---

## 2. Database migration (Phase A + B-1)

**Phase A — read-only status:** 1 applied, 4 pending, history consistent, no drift. `_prisma_migrations` present, confirming production was provisioned via `prisma migrate` (not `db push`) — this closed the one risk that could not be settled remotely.

**Pre-flight backup:** Railway's plan provided **no automated backups or PITR**, and the CLI exposes no backup surface at all. A manual dump was taken instead:

```
storage/production-incident/prod-preflight-20260816-093207.dump
26,585 bytes · sha256 17494884db91f11ebb70feff4a2fe76184baa83c6ddb813cc08e838b870827ca
```

Validated read-only with `pg_restore --list` (68 TOC entries). Its contents independently corroborated the diagnosis: **no `translations` table, no `community_*` tables**. `*.dump` was added to `.gitignore` — the archive contains the `users` table.

**Phase B-1 — `prisma migrate deploy`,** exit 0, all four applied:

| Migration | Effect |
|---|---|
| `20260629000000_add_translations` | `CREATE TABLE translations` + 2 indexes |
| `20260712000000_add_translation_published_status` | `ADD COLUMN publishedAt` + index |
| `20260716000000_community_foundation` | 7 `community_*` tables |
| `20260717000000_fix_migration_drift` | `timeline_events.year`; 2 constraint relaxations; 7 indexes |

Verified zero data-destructive statements across all five migration files (0 matches for `DROP TABLE`/`DROP COLUMN`/`TRUNCATE`/`DELETE FROM`/`DROP TYPE`/`DROP DATABASE`/`DROP SCHEMA`), and zero `INSERT`/`COPY`/`UPDATE`/`MERGE` — proving the migrations could not create or destroy rows.

Post-migration: 23 tables, all expected, none unexpected, `migrate status` → **"Database schema is up to date!"**

---

## 3. 455-row data restoration (Phase B-2)

**Method:** controlled Prisma export → import with **explicit IDs**.

Two alternatives were rejected for concrete reasons:
- `pg_dump`/`pg_restore` would have copied the local `User` row — a development password hash — into production.
- Re-running the archive importers (`run-*-import.ts`) would have **minted new IDs**, orphaning all 8 record-type translations, which reference record IDs.

**Safety guards, all tested live before use:** R5 target-host confirmation, R7 non-empty-target abort (verified firing with exit 1), R3 `skipDuplicates` idempotency, R4 fixed FK ordering. Dry-run-by-default.

**Restored:**

| Table | Before | After |
|---|---|---|
| Collection | 0 | **42** |
| Record | 0 | **184** |
| Entity | 0 | **46** |
| Relationship | 0 | **28** |
| TimelineEvent | 0 | **83** |
| Translation | 0 | **72** |
| **Total** | 0 | **455** |

`Record.type`: ARMAMENT 85, CAMPAIGN 35, FORMATION 32, LETTER 24, ARTICLE 8.

**Never imported or overwritten:** `User`, `AuditLog`, `MediaAsset`. Production's pre-existing `users=1`, `audit_logs=16`, `media_assets=1` were preserved untouched.

---

## 4. Translation recovery

72 translation rows restored — 8 locales × 9 rows. **All 8 record-type translations resolve to real record IDs**, which is the direct proof that ID preservation worked; had new IDs been minted, all 8 would now be orphaned.

| Endpoint | Before | After |
|---|---|---|
| `/api/translations/site_content/homepage.json/{locale}` | **500** (Prisma error) | **200** — all 8 locales |

Verified rendering end-to-end in a real browser, not just status codes:
- **German** — "WILLKOMMEN BEI VETERANSLEDGER", "Achsengeschichte-Archiv", translated body, cookie banner and `<title>`
- **Arabic** — `dir="rtl"`, `lang="ar"`, title `أرشيف تاريخ دول المحور`, h1 `مرحبًا بكم في VeteransLedger`, full RTL mirrored layout

---

## 5. Secret rotation (Phase C)

**Finding:** production was running the literal placeholder values from `.env.example` — a **public** GitHub repository. Proven without exposing any value, by length comparison:

| Variable | Length in production | Length of shipped placeholder | Match |
|---|---|---|---|
| `SESSION_SECRET` | 51 | 51 | ✅ |
| `JWT_SECRET` | 43 | 43 | ✅ |
| `ADMIN_PASSWORD` | 23 | 23 | ✅ |

The `JWT_SECRET` exposure was the most severe: anyone with the repository could mint a valid admin JWT (7-day expiry) and call every authenticated endpoint — full Admin CRUD, publish pipeline, media, site-content writes — without a password.

**Rotation performed** — values generated with `crypto.randomBytes` and piped directly into Railway over stdin; never printed, logged, hashed, written to a file, or entered into shell history:

| Variable | Before | After |
|---|---|---|
| `SESSION_SECRET` | DEFAULT, 51 ch, 3/4 classes | **non-default, 86 ch, 4/4** |
| `JWT_SECRET` | DEFAULT, 43 ch, 2/4 classes | **non-default, 86 ch, 4/4** |
| `ADMIN_PASSWORD` | DEFAULT, 23 ch, 2/4 classes | **non-default, 43 ch, 4/4** |

**The Admin account's stored password hash was deliberately NOT changed.** `ADMIN_PASSWORD` is read only by `prisma/seed.ts` at user creation (`upsert` with `update: {}`), so the existing login is unaffected.

---

## 6. `NODE_ENV` hardening

Production was running **`NODE_ENV=development`**. This was proven, not inferred: `error.middleware.ts` gates `details`/`stack` on `config.isDevelopment`, and production was leaking both.

One missing variable silently disabled six protections:

| Location | Effect when not `production` | Now |
|---|---|---|
| `config/app.ts:93` | Startup secret guard never runs | ✅ active |
| `config/security.ts:61` | `session.cookie.secure` = false | ✅ true |
| `error.middleware.ts:26,35` | Stack traces + `/app/dist/…` paths public | ✅ suppressed |
| `config/database.ts:9` | Prisma logs every query | ✅ quiet |
| `logger.middleware.ts:10,35` | Debug logging + console transport | ✅ info level |
| `database/prisma.ts:15` | Dev client caching | ✅ disabled |

All four variables were set with `--skip-deploys`, then applied together in a **single** `railway redeploy`.

> **Operational note:** after the redeploy the **old container kept serving for ~6 minutes**, returning 200 while still leaking stack traces. An immediate 200 is not proof a Railway redeploy has taken effect — poll for the behavioural change.

---

## 7. Cloudflare determination

**Cloudflare was not the cause, and no Cloudflare configuration was changed.**

It passed the origin's own 500 and Prisma error body through faithfully. `cf-cache-status: DYNAMIC` on every endpoint, no `Age` header, no WAF block, no cached empty response, no CORS or preflight failure.

Two non-causal behaviours observed:
1. `/admin` returns 403 "Just a moment…" to `curl` — a JS bot-challenge. A **real browser solves it automatically**; `/admin` renders with zero console errors and all 30+ modules loading 200. Legitimate access is unaffected.
2. Cloudflare injects `static.cloudflareinsights.com/beacon.min.js`, which the site's own CSP (`script-src 'self' 'unsafe-inline'`) blocks. Cosmetic; Cloudflare Web Analytics will not function until the CSP allows that host or the feature is disabled.

---

## 8. Verification results

### Final post-rotation verification

| # | Check | Result |
|---|---|---|
| 1 | Admin account can log in | ⚠️ **NOT VERIFIED BY ME** — requires entering a password. **Yours to confirm.** |
| 2 | Authenticated Admin CRUD | ⚠️ **NOT VERIFIED BY ME** — depends on #1 |
| 3 | Old tokens rejected | ✅ **PROVEN** — see below |
| 4 | Public site fully functional | ✅ 10/10 routes HTTP 200 |
| 5 | All 8 locales + Arabic RTL | ✅ 8 × 200; `dir="rtl"`, `lang="ar"` confirmed |
| 6 | Database zero drift | ✅ **18/18 checks passed** |
| 7 | English restored after locale testing | ✅ `<title>VeteransLedger · Axis History Archive 1933–1945</title>` |

**#3 — token rejection, proven directly.** A JWT was signed with the *old* secret (the public `.env.example` placeholder) and sent to `/api/campaigns`:

| Request | Response |
|---|---|
| **With** forged old-secret token | `401 {"error":"Invalid or expired token"}` |
| **Without** any token (control) | `401 {"error":"Authentication required"}` |

The two **distinct** messages prove the token was parsed and its signature **rejected** — not merely absent. Before rotation, that exact token would have returned `200` with full campaign data.

### Database integrity — 18/18, zero drift

Counts match the approved preview exactly; ID sets identical for all six restored tables with no missing, extra or duplicate IDs; all FK references resolve; zero orphaned translations; no duplicate `(entityType,entityId,locale)` or `Record.slug`; all content published (184/184, 46/46, 83/83); `users=1` and `media_assets=1` preserved.

### Security posture

| Check | Result |
|---|---|
| Stack traces to unauthenticated callers | ✅ gone — `{"error":"Authentication required"}` only |
| `/app/dist/…` path disclosure | ✅ gone |
| Prisma query logging | ✅ 0 occurrences |
| Secure cookies | ✅ enabled (`secure: config.isProduction` → true) |
| Startup guard | ✅ active, accepts new secrets |
| Console/network errors | ✅ zero |

Pre-flight dump verified intact and gitignored at every phase.

---

## 9. Remaining security risks

| # | Risk | Severity | Status |
|---|---|---|---|
| 1 | **Startup-guard defect** — cannot catch copied `.env.example` values | 🔴 High | **Follow-up task §10** |
| 2 | **JWT secret was public for an unknown period** — audit needed | 🔴 High | **Follow-up task §11** |
| 3 | No server-side schema validation on `PUT /api/site-content` | 🟡 Medium | Open, documented |
| 4 | No database backups on the current Railway plan | 🟡 Medium | Open — plan upgrade or scheduled dumps |
| 5 | No deploy step runs `prisma migrate deploy` | 🟡 Medium | Open — root cause of this incident; will recur |
| 6 | `public/data` is git-tracked source *and* runtime-mutable | 🟡 Medium | Open — redeploy silently discards Admin edits |
| 7 | Missing `/storage/images/**` assets (91 referenced, 0 tracked) | 🟢 Low | Open — content gap, reproduces locally |
| 8 | Cloudflare beacon blocked by CSP | 🟢 Low | Open — cosmetic |

---

## 10. FOLLOW-UP TASK A — Fix the startup-guard defect

**Not fixed. Documented only, per instruction.**

`src/config/app.ts:93-98` exists to prevent exactly what happened here, and it cannot work:

```ts
const WEAK = ["dev-secret-change-in-production", "dev-jwt-secret-change-in-production", "change-me"];
```

It checks the **`optional()` fallbacks** — the values used when a variable is *unset*. It does **not** check the placeholders actually shipped in `.env.example`, which is what an operator copies.

| Guard checks for | Actually shipped in `.env.example` | Caught? |
|---|---|---|
| `dev-secret-change-in-production` | `change-me-to-a-long-random-secret-at-least-64-chars` | ❌ |
| `dev-jwt-secret-change-in-production` | `change-me-to-a-different-long-random-secret` | ❌ |
| `change-me` | `change-me-in-production` | ❌ |

**Zero overlap.** It only fires when a variable is entirely absent — the case where deployment would likely fail anyway. Compounding this, it is wrapped in `if (NODE_ENV === "production")`, and production ran `development`, so **it had never executed at all**.

### Exact proposed correction

```ts
if (config.isProduction) {
  const isWeak = (v: string) =>
    /^(change-me|changeme|dev-|your-|test|example|password|secret|admin)/i.test(v) ||
    v.length < 32;

  const checks: [string, string][] = [
    ["SESSION_SECRET", config.session.secret],
    ["JWT_SECRET",     config.jwt.secret],
    ["ADMIN_PASSWORD", config.admin.password],
  ];
  for (const [name, value] of checks) {
    if (isWeak(value)) {
      throw new Error(
        `${name} must be set to a strong non-default value in production ` +
        `(min 32 chars, must not begin with a known placeholder prefix).`,
      );
    }
  }
  if (config.session.secret === config.jwt.secret) {
    throw new Error("SESSION_SECRET and JWT_SECRET must not be identical.");
  }
}
```

**Why prefix + length rather than an exact list:** an exact list is what failed. Every placeholder this repo ships begins with `change-me` or `dev-`, and no legitimate CSPRNG secret does. The 32-character floor independently catches short secrets regardless of prefix.

**Acceptance criteria:** boots with the current rotated secrets; refuses to boot with any `.env.example` value; refuses when `SESSION_SECRET === JWT_SECRET`; refuses on any secret under 32 chars; no effect when `NODE_ENV !== production`.

**Prerequisite:** secrets must already be rotated — done. Deploying this before rotation would have prevented boot.

---

## 11. FOLLOW-UP TASK B — Audit `AuditLog` for the JWT exposure window

**Not started. Task created, per instruction.**

**Why:** `JWT_SECRET` was the public `.env.example` value. Anyone with repository access could have minted a valid `SUPER_ADMIN` token and used every authenticated endpoint without a password. Rotation (§5) invalidated all such tokens, but does not tell us whether any were used.

**Exposure window:** from first production deployment until 2026-08-16 ~10:21 UTC+1. Railway shows deployments back to **2026-06-23**, so assume ≥ 8 weeks.

**Scope:** production `audit_logs` — currently **16 rows**. Small enough for a complete manual review.

**What to look for:**
- Actions with no corresponding legitimate admin session
- `userId` values that do not match the single real production user
- Any `userId` not present in `users` (a forged token can carry an arbitrary `userId`)
- Activity outside the owner's normal hours or from unexpected IPs
- CREATE/UPDATE/DELETE on records during a period when production's content tables were **empty** — such entries would be inherently suspicious
- Any publish-pipeline or media-upload activity not accounted for (note: production holds **1 `media_assets` row** whose provenance should be confirmed)

**Caveats to carry into the review:**
- `audit_logs.userId` is a foreign key to `users`, so a forged token with a fabricated `userId` would fail to write an audit row — **absence of evidence is not evidence of absence**.
- Not every service audit-logs; only `records.service.ts` does consistently. Formation/Armament/Personnel writes may leave no trace.
- Read-only exfiltration via `GET` endpoints would leave **no audit trail at all**.

**Therefore:** a clean audit log lowers concern but cannot fully exonerate the window. Given the archive is public-facing content rather than personal data, the realistic worst case is unauthorised content modification, not a data-privacy breach.

**Suggested method:** read-only query of all 16 rows with `userId`, `action`, `entityType`, `entityId`, `createdAt`; cross-reference `userId` against `users`; compare timestamps against the owner's known activity.

---

## 12. FOLLOW-UP TASK C — Missing `/storage/images/**` assets

**Not started. Documented only.**

**What:** `public/data/**` references **91 unique** `/storage/images/…` paths. Only **2** image files exist on disk locally, and **0** are tracked in git — `.gitignore:18` ignores `storage/images/`.

**Evidence it is NOT a deployment fault:** the same image returns **404 on local and production identically**. It never shipped because it was never committed, and it is equally absent in development.

**Impact:** every archive card and record hero falls back to the "FILE NOT AVAILABLE / ARCHIVE DOCUMENT MISSING" placeholder. This is the visual basis for the original "the public site has no content" report — the *text* content renders correctly. Degrades gracefully; nothing errors.

**Why it is separate:** this is a **content/asset** problem, not code, schema or deployment. Restoring it means locating the original image files, which exist outside this repository.

**Suggested approach:**
1. Locate the source images (original import set or archive backup).
2. Decide where they should live — committing ~91 binaries to git is probably wrong. A Railway **volume** mounted at `/app/storage`, or object storage (S3/R2) with `/storage` proxying to it, is the better shape.
3. Reconcile the 91 referenced paths against what is recovered; for any genuinely lost image, decide whether to clear the reference in `public/data` or keep the placeholder.
4. Note production currently holds **1** `media_assets` row — confirm whether its file is present.

**Blocker:** none. Independent of everything else.

---

## 13. FOLLOW-UP TASK D — `public/data` is git-tracked source *and* runtime-mutable

**Not started. Documented only. Do not redesign as part of recovery.**

**What:** all 150 files under `public/data/` are committed to git **and** written at runtime by the Admin via `PUT /api/site-content`. Those are contradictory roles.

**Consequence:** **any redeploy from git silently discards every site-content edit made in production.** An admin changes the homepage, a deploy happens, the change vanishes with no error and no warning. There is also no history or rollback for site-content saves — unlike the Record publish pipeline.

**Severity:** 🟡 Medium. No data has been lost to this yet *that we know of* — but it is unobservable by design, which is itself the problem.

**Why it is separate:** a genuine architectural decision with several valid answers. It must not be resolved under time pressure during an incident.

**The decision to make — it cannot stay both:**

| Option | Shape | Trade-off |
|---|---|---|
| **A — build-time source** | `public/data` stays in git; Admin loses write access; edits go through PR | Full history and review; slow, developer-only editing |
| **B — runtime data** | Remove from git; mount a Railway volume at `/app/public/data`; seed once | Admin edits persist; needs backup, and the volume becomes new critical state |
| **C — database-backed** | Move site-content into Postgres like every other content type | Consistent with the rest of the system; largest change; gains the existing backup path |

**Recommendation if asked:** **B** is the smallest correct fix for the immediate persistence bug. **C** is the better long-term shape — it would also close the "no history/rollback" gap and the missing server-side schema validation on `PUT /api/site-content` in one move.

**Prerequisite:** whichever is chosen, take a copy of the current `public/data` state first — production may already contain Admin edits not present in git.

---

## 14. FOLLOW-UP TASK E — Document the Railway deployment architecture in the repository

**Not started. Documented only.**

**What:** the repository contains **no deployment configuration or documentation of any kind** — no Dockerfile, no compose file, no `.github/`, no PaaS config, no process-manager config, and no commit in the entire history mentioning deployment. Production runs from `/app/dist/` in a Railway container, and nothing in the repo says so.

**Why this matters most:** **this absence is the root cause of the entire incident.** Nothing in the repo ever ran `prisma migrate deploy`, so the schema drifted four migrations behind the code and stayed there. Until a deploy step exists, **it will happen again on the next migration.**

**What to add:**

1. **`DEPLOYMENT.md`** covering: Railway project `compassionate-recreation`, environment `production`, services `veteransledger` (app) and `Postgres`; that `PGHOST` is `postgres.railway.internal` and unreachable externally, so operational commands must use `DATABASE_PUBLIC_URL`; the full required environment-variable list; and the operational runbook (`railway run`, `railway logs`, `railway redeploy`).
2. **A migration step in the deploy pipeline — the critical item.** Either a Railway pre-deploy command or:
   ```json
   "start": "prisma migrate deploy && node dist/index.js"
   ```
   Weigh this: it makes every boot apply pending migrations, which is safe for additive migrations and dangerous for destructive ones. A separate pre-deploy hook is the safer shape.
3. **Add `MAINTENANCE_MODE` to `.env.example`** — currently undocumented, and it silently 503s every public page while leaving Admin up. A future operator would struggle to diagnose that.
4. **Record the backup position.** The current Railway plan has **no automated backups or PITR**. Either upgrade, or schedule periodic `pg_dump` runs. Right now production has no recovery point beyond the manual pre-flight dump taken during this incident.
5. **Document that `.env.example` placeholders must be replaced** — and pair this with Follow-up Task A, which makes that mechanically enforced rather than advisory.

**Blocker:** none, and item 2 is the highest-leverage change in this entire report.

---

## 15. Production changes made — complete list

1. `prisma migrate deploy` — 4 schema migrations
2. 455 data rows inserted (Collection, Record, Entity, Relationship, TimelineEvent, Translation)
3. `SESSION_SECRET`, `JWT_SECRET`, `ADMIN_PASSWORD` rotated
4. `NODE_ENV` set to `production`
5. One `railway redeploy`

**Not touched:** Cloudflare, application architecture, application code, the Admin password hash, `public/data` files, `User`/`AuditLog`/`MediaAsset` rows.

**Local repository:** `.gitignore` gained `*.dump`; six read-only/guarded scripts added under `src/scripts/`; reports added under `storage/production-incident/`. `tsc --noEmit` clean.


---

## 16. ADDENDUM — production is currently not serving (new condition)

**Recorded at 2026-10-10 17:38 UTC, during the final confirmation pass.**

### What is happening

Every production URL now returns **HTTP 404** — `/`, `/campaigns`, `/public/data/homepage.json`, `/api/translations/…`. This is **not** an application error:

```
HTTP/1.1 404 Not Found
Server: railway-hikari
x-railway-fallback: true
x-railway-edge: ams1

{"status":"error","code":404,"message":"Application not found"}
```

`"Application not found"` with `x-railway-fallback: true` is **Railway's own edge** reporting that **no service is bound to this domain**. The application is not running; nothing is reaching the app code.

### Evidence

| Observation | Earlier (verified healthy) | Now |
|---|---|---|
| `Server` header | `cloudflare` | `railway-hikari` |
| `CF-RAY` / Cloudflare headers | present | **absent (0)** |
| `/` | 200 | **404 "Application not found"** |
| `/public/data/homepage.json` | 200 | **404** |
| `/api/translations/…/de` | 200 | **404** |
| Railway CLI | authenticated | **"Unauthorized. Please run `railway login` again."** |
| DNS `veteransledger.com` | — | `69.46.46.67` (not a Cloudflare IP) |
| Postgres proxy `hayabusa.proxy.rlwy.net:15591` | reachable | **TCP connect still OK** |

Two things changed simultaneously and independently of this work: **Cloudflare is no longer in front of the domain**, and **the Railway application service is no longer bound/running**. The **database infrastructure appears to still exist** — the public proxy still accepts TCP connections.

### Date discrepancy — important

Earlier commands in this session reported the local date as **2026-08-16**, and that date was stamped on every artifact in this folder. The local clock and Railway's edge now **agree on 2026-10-10**. The authoritative date is **2026-10-10**; treat the `2026-08-16` stamps on these reports as unreliable. A substantial period may have elapsed between the verified-healthy state and this observation, which would be consistent with a lapsed plan, an expired trial, or an expired CLI token.

### What this does and does not mean

- **It does not invalidate the recovery work.** The migrations, the 455-row restore, the translation recovery, the secret rotation and `NODE_ENV` hardening were all executed and verified against a live, healthy production — repeatedly, with 18/18 database checks and 8/8 locales confirmed rendering.
- **It is not a regression caused by that work.** The last production action was a redeploy that succeeded, after which the site was verified healthy multiple times.
- **It is a platform/account-level condition**, outside the application and outside this repository.

### Most likely causes (not verified — I cannot reach Railway)

1. Railway plan/trial lapsed or resources exhausted → service suspended or removed. Consistent with the account having **no backups or PITR available**, which indicates a free or trial tier.
2. The service or its domain binding was deleted.
3. DNS was repointed and Cloudflare removed from the path.

### What I did NOT do

I did **not** re-authenticate the Railway CLI, redeploy, recreate the service, or change DNS or Cloudflare. Re-authenticating and redeploying would be improvising a recovery, which is explicitly out of scope, and no further production changes were authorised.

### Data safety

The pre-flight dump is intact and gitignored: `prod-preflight-20260816-093207.dump`, 26,585 bytes, sha256 `17494884db91f11ebb70feff4a2fe76184baa83c6ddb813cc08e838b870827ca`. Note it captures the **pre-migration, pre-restore** state.

The **restorable payload is also intact**: `storage/production-incident/prod-restore-payload.json` — all 455 rows with original IDs. If the production database were ever lost, `prod-restore-import.ts` can replay it into a fresh database after `prisma migrate deploy`, with all guards intact. **No recovery capability has been lost.**

### Required next step (yours)

Check the Railway dashboard for project `compassionate-recreation`: is the `veteransledger` service still present, is the plan active, and is the custom domain still bound? That determines whether this is a billing/plan issue, a deleted service, or a DNS change. I can resume the moment you tell me — the tooling and payload are ready.
