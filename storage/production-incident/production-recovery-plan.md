# Production Recovery Plan — migration, data restoration, security

**Date:** 2026-08-16
**Status:** ⛔ **NOTHING EXECUTED.** No production command run, no production write, no config change.
**Preview tool:** `src/scripts/prod-restore-preview.ts` (read-only, local DB only, zero writes)

---

## 0. Blocking inputs I cannot obtain myself

Two of the required steps are outside the repository and outside my access. **Both must be answered before any production write.**

### ① Backup / restore point — **UNKNOWN, YOU MUST CONFIRM**

I cannot determine this. It depends on the container host and the managed-Postgres provider, neither of which is represented in the repository. I need one of:

- a managed-Postgres provider with automated backups (Neon/Supabase/RDS/DO — confirm provider + retention + latest snapshot timestamp), **or**
- a manual pre-flight dump taken immediately before the migration:

```bash
pg_dump "$DATABASE_URL" --format=custom --file=prod-preflight-$(date +%Y%m%d-%H%M%S).dump
```

**Mitigating fact:** production's tables are **empty** (0 records, 0 translations). There is currently no production data to lose. The backup requirement is therefore about protecting the *schema and the admin user row*, not archive content. This lowers the risk substantially but does not remove the requirement.

### ② Production access — **UNKNOWN, YOU MUST PROVIDE**

The repository documents no deployment mechanism. I know only what the stack traces prove: a container with the app at `/app`. I need to know how you reach it — e.g. `docker exec -it <container> sh`, a host provider's web console/SSH, or a one-off job runner. Both commands below must run **inside that container**, where `DATABASE_URL` already points at production.

---

## 1. Exact migration plan

### Step 1 — read-only status check (safe, run first)

```bash
npx prisma migrate status
```

Writes nothing. Prints applied vs pending migrations. **This resolves the one risk I could not settle remotely** (see §5, Risk R1).

**Expected output** — four pending:
```
Following migrations have not yet been applied:
20260629000000_add_translations
20260712000000_add_translation_published_status
20260716000000_community_foundation
20260717000000_fix_migration_drift
```

**Stop and report if instead it says** `No migration found in prisma/migrations` or that the database schema is not managed by migrations — that is Risk R1 and needs a different first move.

### Step 2 — apply (only after Step 1 is confirmed)

```bash
npx prisma migrate deploy
```

`migrate deploy` is the production-safe command: applies pending migrations in order, never resets, never prompts, never generates migrations.

> ⚠️ **Do not run `npm run prisma:migrate`.** That script maps to `prisma migrate dev`, which is interactive and can reset the database.

### Migrations production is missing

| # | Migration | Statements | Type |
|---|---|---|---|
| 1 | `20260629000000_add_translations` | `CREATE TABLE translations`; 2 indexes | additive |
| 2 | `20260712000000_add_translation_published_status` | `ADD COLUMN translations.publishedAt`; 1 index | additive |
| 3 | `20260716000000_community_foundation` | `CREATE TABLE` × 7 (`community_*`) + FKs | additive |
| 4 | `20260717000000_fix_migration_drift` | `ADD COLUMN timeline_events.year`; `DROP NOT NULL` on `timeline_events.date`; `DROP DEFAULT` on `translations.fields`; 7 indexes | additive + relaxing |

### Data-destructive check — **PASSED**

Scanned all 5 migration files for `DROP TABLE`, `DROP COLUMN`, `TRUNCATE`, `DELETE FROM`, `DROP TYPE`, `DROP DATABASE`, `DROP SCHEMA`: **0 matches in all 5 files.**

The only two `DROP` keywords present are constraint-relaxing and touch no rows:
- `ALTER COLUMN "date" DROP NOT NULL` — relaxes a constraint
- `ALTER COLUMN "fields" DROP DEFAULT` — removes a DB-level default; Prisma Client always supplies `fields` explicitly

### What Step 2 achieves — and what it does not

| | After migration |
|---|---|
| `/api/translations/*` returns 500 | ✅ fixed → becomes 404 |
| Public site free of server errors | ✅ fixed |
| Public site shows translated text | ❌ **no** — table exists but is empty |
| Admin shows archive records | ❌ **no** — `records` is empty |

**The migration is a schema fix only.** Restoring content is §2, a separate approval.

---

## 2. Exact data restoration plan

### Why not the obvious options

| Option | Verdict |
|---|---|
| `prisma db seed` | ❌ Only creates one admin user (`prisma/seed.ts`). No content. |
| Re-run the importers (`run-campaigns-import.ts` etc.) | ❌ **Would violate requirement 7.** They mint new IDs. All 8 `record` translations reference record IDs — new IDs orphan every one of them. |
| `pg_dump` / `pg_restore` full copy | ⚠️ Preserves IDs, but copies **everything** — including the local `User` row (a password hash from a dev environment) and 46 local `AuditLog` rows. Blunt and carries credential-hygiene risk. |
| **Controlled Prisma export → import, ID-preserving** | ✅ **Recommended.** Selective, reviewable, explicit IDs, correct FK order, dry-runnable, excludes credentials. |

### Recommended method

A two-phase script pair, matching the discipline used throughout this engagement (preview → approve → execute → verify):

1. **Export** — read local DB, write a single JSON artifact with explicit `id` on every row.
2. **Import** — read that artifact, insert into production in FK-safe order using `createMany({ skipDuplicates: true })`, wrapped in a transaction per table.

**Requirement 7 (preserve IDs) is satisfied** by writing `id` explicitly on every insert rather than letting Prisma/`cuid()` generate new ones. **Requirement 8 (do not modify local) is satisfied** because the export is `findMany()` only — the local database is read-only throughout.

### FK-safe insert order

```
1. Collection      (no deps)
2. Record          → Collection
3. Entity          (no deps)
4. EntityAlias     → Entity
5. Relationship    → Entity ×2
6. TimelineEvent   (no deps)
7. Source          (no deps)
8. Citation        → Source, Record?, Entity?
9. Translation     (loose refs — must come after 2/3/6)
10. PreservationRecord (no deps)
```

### Deliberate exclusions

| Table | Local | Restored | Why excluded |
|---|---|---|---|
| `User` | 1 | **0** | Never copy credentials between environments. Production's admin user already exists — that is how you log into prod Admin today. Copying local's row would overwrite or duplicate it. |
| `AuditLog` | 46 | **0** | Local development history. Has an FK to `User`; meaningless in production. |
| `MediaAsset` | 0 | **0** | Zero rows locally anyway. Has an FK to `User`. The underlying files are gitignored (see item B). |

---

## 3. Expected before/after counts

Generated read-only from the local database by `src/scripts/prod-restore-preview.ts`.

| Table | Local | Prod BEFORE | Prod AFTER | Note |
|---|---|---|---|---|
| **Collection** | 42 | 0 | **42** | insert 1st |
| **Record** | 184 | 0 | **184** | → Collection |
| **Entity** | 46 | 0 | **46** | |
| EntityAlias | 0 | 0 | 0 | |
| **Relationship** | 28 | 0 | **28** | → Entity ×2 |
| **TimelineEvent** | 83 | 0 | **83** | |
| Source | 0 | 0 | 0 | |
| Citation | 0 | 0 | 0 | |
| **Translation** | 72 | 0 | **72** | |
| PreservationRecord | 0 | 0 | 0 | |
| MediaAsset | 0 | 0 | 0 | excluded |
| AuditLog | 46 | 0 | **0** | excluded |
| User | 1 | (existing) | **unchanged** | excluded |

**Total rows inserted: 455.**

### Breakdown

- **Record.type** — `ARMAMENT=85`, `CAMPAIGN=35`, `FORMATION=32`, `LETTER=24`, `ARTICLE=8`
- **Entity.type** — `PERSON=46`
- **Translation.locale** — `de/ja/it/ru/es/fr/uk/ar = 9 each`
- **Translation.entityType** — `site_content=64`, `record=8`
- **Published** — records 184/184, entities 46/46, events 83/83

### ID-integrity verification (requirement 7) — all clean

| Check | Result |
|---|---|
| `site_content` translations resolvable | **64/64** |
| `record` translations resolvable | **8/8** |
| `Record.collectionId` orphans | **0** |
| `Citation` dangling refs | **0** |
| `Relationship` dangling refs | **0** |
| `ZZ-TEST` fixture residue | **0 records, 0 entities** |

The 8 `record` translations reference real record IDs, so **ID preservation is mandatory** — restoring with new IDs would silently orphan all 8.

---

## 4. Post-restore verification (to run after approval)

1. `npx prisma migrate status` → all applied
2. Re-run `prod-restore-preview.ts` pointed at production → counts match the AFTER column exactly
3. `GET /api/translations/site_content/homepage.json/de` → **200** with German fields
4. Repeat for all 8 locales → 8 × 200
5. `GET /api/search?q=panzer` → **21** (currently 0)
6. `GET /api/search?q=britain` → 11; `?q=tiger` → 3
7. Public site: switch language, confirm translated rendering
8. Public site: confirm English still renders (regression check)
9. Admin: confirm record lists populate
10. Fresh browser, desktop + mobile, console clean
11. Confirm `public/data/**` unchanged (`git status` on the container, or checksum compare)

---

## 5. Risks and rollback

| ID | Risk | Likelihood | Impact | Mitigation / rollback |
|---|---|---|---|---|
| **R1** | Prod schema was created with `db push`, so no `_prisma_migrations` table. `migrate deploy` tries migration #1 and fails "relation already exists". | Medium | Low | **Non-destructive** — aborts before changing anything. Fix: `npx prisma migrate resolve --applied 20260101000000_init`, then re-run deploy. **`migrate status` in Step 1 detects this before any write.** |
| **R2** | Migration partially applies, then fails. | Low | Medium | Prisma wraps each migration in a transaction; a failure rolls that migration back. Re-run after fixing. All statements are additive. |
| **R3** | Restore inserts duplicates if re-run. | Low | Medium | `skipDuplicates: true` + explicit IDs make the import idempotent. Re-running is a no-op. |
| **R4** | FK violation during restore (wrong order). | Low | Medium | Fixed insert order (§2); preview confirms 0 dangling refs. Per-table transaction → partial failure rolls back that table. |
| **R5** | Restore writes to the wrong database. | Low | **High** | Echo and visually confirm the target host in `DATABASE_URL` before executing. Confirm prod counts are 0 immediately before insert. |
| **R6** | Local data contains test residue. | **None** | — | Verified: 0 `ZZ-TEST` records/entities. |
| **R7** | Production has data we'd overwrite. | **None** | — | Verified: all target tables are 0 rows. |

### Rollback

- **Migration** — no down-migrations exist. Since every statement is additive and the tables are empty, rollback = `DROP TABLE translations, community_*` if ever needed. In practice unnecessary.
- **Data restore** — production tables are empty beforehand, so rollback is a clean `DELETE FROM` of the restored tables in reverse FK order, or restore from the §0 backup.
- **Worst case** — restore the pre-flight dump from §0①.

---

## 6. Separate security change — **NOT deployed, and it is not the fix you'd expect**

I prepared this as instructed, and found something more important than the stack-trace leak itself.

### The code is already correct

`src/middleware/error.middleware.ts` **already** gates the leak:

```ts
res.status(500).json({
  error: "Internal server error",
  ...(config.isDevelopment && { details: err.message, stack: err.stack }),
});
```

`config.isDevelopment` is `process.env.NODE_ENV !== "production"`.

### Therefore: `NODE_ENV` is not set to `production` in the production container

The leak is **observed** in production, and this is the only code path that emits it. That is proof, not inference.

### This silently disables six things at once

| Location | Behaviour when `NODE_ENV` ≠ production | Severity |
|---|---|---|
| `config/app.ts:93` | **The weak-secret startup guard never runs.** Production can boot with `dev-secret-change-in-production`, `dev-jwt-secret-change-in-production`, `change-me` and nothing stops it. | 🔴 **Critical** |
| `config/security.ts:61` | `session.cookie.secure` = **false** — session cookies not restricted to HTTPS. | 🔴 High |
| `middleware/error.middleware.ts:26,35` | Stack traces + internal paths returned to unauthenticated callers. | 🔴 High (observed) |
| `config/database.ts:9` | Prisma logs **every query** in production. | 🟡 Medium |
| `middleware/logger.middleware.ts:10,35` | Debug-level logging + console transport. | 🟡 Medium |
| `database/prisma.ts:15` | Dev hot-reload client caching retained. | 🟢 Low |

### The fix

**Set `NODE_ENV=production` in the production container environment.** One variable. No code change.

> ⚠️ **Do this *after* the database work, not before.** Setting it activates the startup guard at `config/app.ts:93`, which **throws on boot** if `SESSION_SECRET`, `JWT_SECRET`, or `ADMIN_PASSWORD` are still defaults. If any of them are, **the container will fail to start.** Verify all three are set to real values first — that is the correct behaviour working as designed, but it will take the site down if you hit it unprepared.

**Recommended order:** ① confirm the three secrets are strong → ② set `NODE_ENV=production` → ③ restart → ④ confirm `/api/translations/...` no longer returns `details`/`stack`.

No code change is proposed. If you want defence-in-depth regardless of `NODE_ENV`, I can additionally gate on an explicit `EXPOSE_ERRORS` flag — say the word and I'll prepare it as its own diff.

---

## 7. Explicitly out of scope for this operation

Real findings, deliberately **not** mixed into the database recovery:

- **B — missing `/storage/images/**` assets.** 91 referenced paths, 0 tracked in git, 404 on local *and* production identically. Pre-existing content gap, not a deployment regression.
- **C — `public/data` is git-tracked source *and* runtime-mutable.** A redeploy silently discards production Admin edits. Design issue.
- **D — undocumented deployment configuration.** No Dockerfile, no CI, no compose file. This absence is *why* the schema drifted — nothing ever runs `migrate deploy`. Systemic cause; will recur until a deploy step exists.

---

## Approval checklist

Before I execute anything, I need:

- [ ] **Backup/restore point confirmed** (§0①) — provider + snapshot, or approval to take a `pg_dump` first
- [ ] **Production access method provided** (§0②)
- [ ] **Approval for Step 1** — `npx prisma migrate status` (read-only)
- [ ] **Approval for Step 2** — `npx prisma migrate deploy`
- [ ] **Approval for the data restore** (§2), after you have reviewed the §3 counts
- [ ] **Separate decision on `NODE_ENV=production`** (§6), including confirming the three secrets are non-default

Nothing proceeds without these.
