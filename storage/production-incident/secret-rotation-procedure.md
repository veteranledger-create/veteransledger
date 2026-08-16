# Production Secret Rotation — Procedure & Startup-Guard Defect

**Date:** 2026-08-16
**Status:** ⛔ **NOT EXECUTED.** Prepared for approval. No secret changed, no restart, no `NODE_ENV` change.
**Severity:** 🔴 **Critical** — production is running publicly-known repository placeholder values.

---

## 1. The finding

Production's `veteransledger` service is running the literal placeholder values shipped in `.env.example`.

**Proof, without exposing any value** — measured length in production vs. the length of the shipped placeholder:

| Variable | Length measured in production | Length of `.env.example` placeholder | Match |
|---|---|---|---|
| `SESSION_SECRET` | 51 | 51 | ✅ exact |
| `JWT_SECRET` | 43 | 43 | ✅ exact |
| `ADMIN_PASSWORD` | 23 | 23 | ✅ exact |

Independently, the preflight's placeholder-comparison returned **DEFAULT** for all three. Two independent signals agree.

`.env.example` is committed to a **public GitHub repository** (`veteranledger-create/veteransledger`).

### Impact

- **`SESSION_SECRET`** signs session cookies. Anyone with the repo can forge a session cookie.
- **`JWT_SECRET`** signs auth tokens (`JWT_EXPIRES_IN=7d`). Anyone with the repo can mint a valid admin JWT and call every authenticated endpoint — full Admin CRUD, publish pipeline, media, site-content writes.
- **`ADMIN_PASSWORD`** is the documented placeholder. Only consumed by `prisma/seed.ts` at user creation, so it does **not** currently gate login — but it must not remain a public value.

The `JWT_SECRET` exposure is the most serious: it grants authenticated access without needing a password at all.

---

## 2. 🔴 Startup-guard defect

`src/config/app.ts:93-98` exists precisely to prevent this, and **it does not work.**

```ts
if (process.env.NODE_ENV === "production") {
  const WEAK = ["dev-secret-change-in-production", "dev-jwt-secret-change-in-production", "change-me"];
  if (WEAK.includes(config.session.secret)) throw new Error("SESSION_SECRET must be set in production");
  if (WEAK.includes(config.jwt.secret))     throw new Error("JWT_SECRET must be set in production");
  if (WEAK.includes(config.admin.password)) throw new Error("ADMIN_PASSWORD must be set in production");
}
```

The guard checks the **fallback constants from `optional()`** — the values used when a variable is *unset*. It does **not** check the placeholders actually shipped in `.env.example`, which are what a real operator copies into their environment.

| Guard checks for | Actually shipped in `.env.example` | Caught? |
|---|---|---|
| `dev-secret-change-in-production` | `change-me-to-a-long-random-secret-at-least-64-chars` | ❌ |
| `dev-jwt-secret-change-in-production` | `change-me-to-a-different-long-random-secret` | ❌ |
| `change-me` | `change-me-in-production` | ❌ |

**Zero overlap between the two lists.** The guard only fires when a variable is completely absent — the one case where deployment would likely fail anyway. It cannot catch the far more likely case: an operator copying `.env.example` and forgetting to replace the values. That is exactly what happened here.

Compounding it: the guard is wrapped in `if (process.env.NODE_ENV === "production")`, and production runs `NODE_ENV=development`. **So it has never executed at all.**

### Recommended code fix — separate change, NOT part of this rotation

Match on a prefix rather than an exact list, so any `change-me…` / `dev-…` variant is caught, plus a minimum-length floor:

```ts
const isWeak = (v: string) =>
  /^(change-me|changeme|dev-|your-|password|secret|admin)/i.test(v) || v.length < 32;
```

I have **not** applied this. It should be reviewed, tested, and deployed on its own. **Rotate the secrets first** — the code fix does not remove an already-exposed credential, and deploying a stricter guard while the weak values are still set would refuse to boot.

---

## 3. What the rotation will affect

Read this before approving.

| Effect | Detail |
|---|---|
| **Existing sessions invalidated** | Rotating `SESSION_SECRET` invalidates every `vl_session` cookie. Anyone signed into Admin is signed out. |
| **Existing JWTs invalidated** | Rotating `JWT_SECRET` invalidates all issued tokens immediately, including any already forged by a third party. This is the point. |
| **Admin must log in again** | Expected and harmless — log in with the **existing** credentials. |
| **`ADMIN_PASSWORD` does *not* change the DB password** | It is read only by `prisma/seed.ts` at user creation (`upsert` with `update: {}`). The live admin's `passwordHash` in the `users` table is untouched, so **your current login keeps working unchanged.** |
| **Public site unaffected** | Public content is static files plus unauthenticated `/api/translations`. No session or JWT involved. Zero visitor impact. |
| **Database untouched** | No schema or row changes. The restored 455 rows are unaffected. |
| **One restart** | All four variables set with `--skip-deploys`, then a single redeploy applies them together. Brief restart window only. |

> ⚠️ **Not covered by this rotation:** the admin account's actual login password lives as a hash in the `users` table. If you also want that changed, it is a separate deliberate operation — say so and I'll prepare it. I will not alter a stored credential without an explicit instruction.

---

## 4. The exact procedure — **DO NOT RUN UNTIL APPROVED**

Values are generated and piped **directly into Railway via stdin**. They are never printed to the terminal, never echoed, never written to a file, and never appear in shell history or in this conversation.

### Step 1 — rotate `SESSION_SECRET` (86 chars, 4/4 character classes)

```bash
node -e "console.log(require('crypto').randomBytes(64).toString('base64url'))" | railway variables --set-from-stdin SESSION_SECRET -s veteransledger --skip-deploys
```

### Step 2 — rotate `JWT_SECRET` (86 chars, independent value)

```bash
node -e "console.log(require('crypto').randomBytes(64).toString('base64url'))" | railway variables --set-from-stdin JWT_SECRET -s veteransledger --skip-deploys
```

### Step 3 — rotate `ADMIN_PASSWORD` (43 chars)

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('base64url'))" | railway variables --set-from-stdin ADMIN_PASSWORD -s veteransledger --skip-deploys
```

### Step 4 — enable production mode

```bash
railway variables --set "NODE_ENV=production" -s veteransledger --skip-deploys
```

### Step 5 — single restart, applying all four together

```bash
railway redeploy -s veteransledger
```

**Why `--skip-deploys` on every set:** Railway redeploys on each variable change by default. Without it you'd get four restarts and a window where `NODE_ENV=production` is live against not-yet-rotated secrets. This way nothing takes effect until Step 5.

**Generation quality:** `randomBytes(64)` → base64url → 86 chars from a CSPRNG, well beyond the 64-char guidance. base64url spans upper, lower, digits and `-`/`_` — 4/4 character classes. Retrieve the values later from the Railway dashboard if ever needed.

---

## 5. Post-rotation verification (prepared, runs after Step 5)

| # | Check | Method |
|---|---|---|
| 1 | Production boots successfully | `railway logs -s veteransledger`; site returns 200 |
| 2 | Default-secret protection now works | Re-run `prod-secret-preflight.ts` → expect **non-default**, guard PASS |
| 3 | `NODE_ENV=production` | Preflight reports current `NODE_ENV` |
| 4 | Secure cookies enabled | Inspect `Set-Cookie` on an auth response for the `Secure` flag |
| 5 | Stack traces no longer exposed | Trigger a handled error; body must contain **no** `details`/`stack` |
| 6 | Prisma debug logging reduced | `railway logs` shows no per-query `prisma:query` spam |
| 7 | Admin login works with existing DB account | Manual login by you — I will not enter credentials |
| 8 | Public content loads | `/`, `/campaigns`, `/public/data/*.json` → 200 |
| 9 | All 8 non-English translations | `/api/translations/site_content/homepage.json/{locale}` → 8 × 200 |
| 10 | No new console/network errors | Fresh browser check on public site |
| 11 | Pre-flight dump intact + gitignored | sha256 `17494884…27ca`, `git check-ignore` |

Item 7 requires you — I will not enter passwords into any form.

---

## 6. Current state

Nothing changed. No secret modified, printed, logged, hashed, or revealed. No restart. `NODE_ENV` still `development`.

Pre-flight dump verified this phase: sha256 `17494884db91f11ebb70feff4a2fe76184baa83c6ddb813cc08e838b870827ca`, 26,585 bytes, **gitignored ✅**.

Database untouched since the verified restore — 455 rows, 18/18 checks passed.

---

## Approval required

Reply to authorise Steps 1–5. Confirm also whether you want the admin account's **stored** password hash reset (separate operation, not included above).
