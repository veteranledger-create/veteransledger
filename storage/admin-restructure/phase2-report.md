# Phase 2 — Admin Shell Isolation — Completion Report

Date: 2026-08-12. Status: **complete, all checklist items verified, zero regressions found. One pre-existing (not introduced, not fixed) CSS bug discovered and documented below.**

## Files changed

Frontend only — no backend/API/database files touched.

| File | Change |
|---|---|
| `frontend/layouts/AdminLayout/admin-layout.js` | **New.** Minimal Admin shell bootstrap: theme (dark/light) toggle only, using the same shared `"theme"` localStorage key / `data-theme` attribute convention as the public site's `navigation.js`. No fetch, no i18n, no locale dependency of any kind. |
| `frontend/pages/Admin/index.html` | Added a static `<header class="admin-topbar">` (brand link, "View Site" link, theme toggle button) as the first child of `<body>`, present on both the login screen and the dashboard. Replaced `<script type="module" src="/layouts/MainLayout/layout.js">` with `<script type="module" src="/layouts/AdminLayout/admin-layout.js">`. |
| `frontend/styles/admin.css` | Added `.admin-topbar` and sub-element rules (brand, logo, actions, link, theme button), a responsive rule collapsing brand text/View Site link below 480px, a `min-height: calc(100vh - var(--admin-topbar-h))` correction on `#admin-login.al-page` so the always-present topbar doesn't push the full-viewport-centered login card into overflow, and a `top: var(--admin-topbar-h)` offset on `#admin-tabs` / `#admin-tabs-mobile-wrap` so the tab bar would stack below the topbar rather than overlap it if sticky positioning is ever restored (see "Discovered, out-of-scope" below). |

Not touched: `frontend/layouts/MainLayout/layout.js` and all its component fragments (used unchanged by every public page), `frontend/styles/core.css`, `frontend/pages/shared/i18n.js`/`locale-constants.js`/`translation-loader.js`/`ui-strings.js`, `frontend/pages/Admin/admin.js` or any `*-admin.js` tab module, backend/API code, database schema, publish/import pipeline, recovery system, Community module.

## Database changes

**None.** `phase2-after.json` is byte-for-byte identical to `phase1-after.json` except for label/timestamp (see table below). Expected, since Phase 2 is a pure frontend change with no server-side code touched.

## API changes

None. No route, controller, or service file was modified.

## UI changes

- Admin now shows a static topbar (VeteransLedger Admin brand, "View Site ↗" link, theme toggle) on every screen, including the login screen — previously the public site's full header+sidebar (with whatever locale text was last active) rendered there instead.
- Everything else in the Admin UI — login form, dashboard, all 20 tabs, modals, forms — is visually and functionally unchanged. The dashboard no longer has a left sidebar (the public site's `.sidebar` component, which Admin never used for its own navigation — `#admin-tabs` was always the real tab system); removing it recovers horizontal space but changes no functionality.
- Public frontend: zero visual or behavioral change (no public files touched).

## Security implications

None. Phase 2 touched no auth, authorization, or data-handling code. `sessionStorage`-based admin token flow is unchanged.

## Tests performed & results

| Test | Result |
|---|---|
| `tsc --noEmit` | Clean, zero errors |
| Admin login → dashboard → sign out → sign back in | Works correctly at every step |
| All 20 Admin tabs (Overview, Armaments, Personnel, Letters, Campaigns, Articles, Timeline, NSDAP, Formations, Awards, Maps, Political Docs, Media, Publish, Navigation, Settings, Pages, Homepage, Page Content, Translations) present; 11 sampled via programmatic click (Armaments, Timeline, Formations, Maps, Media, Publish, Navigation, Settings, Homepage, Page Content, Translations) all switch panels correctly, `aria-controls` wiring intact | Pass |
| Mobile `<select>` tab switcher (`#admin-tabs-mobile`) dispatches the correct panel switch | Pass |
| Network trace of a clean `/admin` reload | Zero requests for `header.html` / `sidebar.html` / `mobile-menu.html` / `footer.html` / `cookie-banner.html` / `contact-modal.html`, zero requests for `navigation.json` / `site-settings.json` / `homepage.json` / `ui-strings.json`, zero i18n/translation-loader/language-switcher module loads. Only Admin's own JS modules, `admin.css`, and the API calls the dashboard itself makes (`/api/dashboard/stats`, `/api/dashboard/recent`) |
| `document.documentElement.lang` / `dir` on `/admin` | `en` / `ltr`, unconditionally |
| Admin locale independence — public site's `vl_locale` cookie/localStorage set to `de`, `ja`, `ar` (Latin, CJK, and RTL scripts) via the real `setLocale()` API, then `/admin` loaded fresh each time | Admin rendered 100% English/LTR every time; `vl_locale` cookie remained at the tested value (confirming Admin correctly never reads it) — visually and via `lang`/`dir` attribute check. `it`/`ru`/`es`/`fr`/`uk` not individually live-tested but are covered by the same code path — `admin-layout.js` and `admin.js` import nothing from `i18n.js`, `locale-constants.js`, or any translation module, so no locale value can reach them |
| Public homepage still renders correctly in Arabic (RTL) after the Admin-side changes | Pass — full RTL mirroring, translated content, unaffected |
| Desktop (1280px screenshot-equivalent), tablet (768px), mobile (375px) Admin layouts | All correct: topbar collapses to icon-only + theme toggle below 480px; tablet shows the horizontal scrolling tab row; mobile shows the `<select>`-based tab switcher below the stats grid; no overlap or clipping at any size |
| Theme toggle (dark ↔ "light") | Functions identically to the public site's existing toggle — see note below on the pre-existing light-theme dead-CSS quirk (not introduced by Phase 2) |
| Console errors across all of the above | None |
| Before/after DB counts | Identical (see below) |

**Zero regressions found in Admin functionality.**

## Before / after counts

| | phase1-after | phase2-after |
|---|---|---|
| Record | 184 | 184 |
| Entity | 46 | 46 |
| TimelineEvent | 83 | 83 |
| Translation | 72 | 72 |
| Collection | 42 | 42 |
| Relationship | 28 | 28 |
| User | 1 | 1 |
| AuditLog | 0 | 0 |
| MediaAsset | 0 | 0 |

Identical in every field.

## Discovered during implementation, confirmed pre-existing, NOT fixed (out of scope)

Two issues were found while verifying Phase 2. Both were confirmed, via direct testing, to already exist before Phase 2 and to be unrelated to the locale-isolation work, so — per "if you discover a new issue during implementation, stop and document it rather than silently expanding the scope" — neither was touched:

1. **`#admin-tabs` / `#admin-tabs-mobile-wrap`'s `position: sticky` does not actually stick.** Root cause: `main { overflow-x: hidden; }` in `core.css` implicitly computes `overflow-y: auto` on `<main>` (a well-known CSS behavior: setting only one overflow axis to a non-`visible` value forces the other to `auto`), which makes `<main>` — not the window — the "nearest scrolling ancestor" for any `position: sticky` descendant. Because `<main>` has no bounded height (it auto-grows to fit its content, both with and without the old `body.has-app-shell` grid class — verified empirically by temporarily re-adding that class live and confirming the sticky behavior does not change), `<main>` itself never actually scrolls, so its sticky descendants never engage. **Verified this is not a Phase 2 regression**: the `main` rule was not touched this session (confirmed via `git log`/`git status` — `core.css` has no pending changes), and re-adding `body.has-app-shell` (the old system's grid wrapper class) live in the browser did not restore sticky behavior, disproving the hypothesis that omitting it caused the break. This bug therefore predates Phase 2 and would have affected the tab bar identically under the old `layout.js`-based shell. Left undisturbed; flagging for a future, separately-scoped CSS fix (likely: give `<main>` a bounded height or drop the implicit `overflow-y:auto`) since it is unrelated to Admin/locale isolation and a `core.css` change needs its own public-site-wide regression pass.
2. **The site's "light" theme is effectively unreachable.** `core.css` defines colors for `[data-theme="light"]`, but neither `navigation.js` (public site, pre-existing) nor the new `admin-layout.js` (mirrors it intentionally, for consistency) ever sets that literal attribute value — both only ever call `setAttribute("data-theme","dark")` or `removeAttribute("data-theme")`. So the toggle button's "Dark"/"Light" label changes, but the color palette does not, since the default (no-attribute) state and the explicit `"dark"` state render identically. `admin-layout.js` deliberately mirrors this existing behavior rather than diverging from it (the requirement was that Admin *share* the theme mechanism, not fix it). One real bug this did surface and which **was fixed** as part of Phase 2: an early draft of the topbar's logo-inversion CSS used `:not([data-theme="dark"])` instead of `[data-theme="light"]`, which — given the above — incorrectly matched the common default state and made the eagle logo render unfiltered (nearly invisible) against the dark background. Caught via live testing before completion; corrected to match the same `[data-theme="light"]` pattern used everywhere else in the codebase.

Neither issue blocks or is touched by Phase 2's checklist; both are noted here for a future, explicitly-scoped fix.

## Regressions discovered

None, after the one CSS mistake above was caught and corrected during this same implementation pass (never shipped/reported as done until fixed).

## Next recommended step

Proceed to **Phase 3 — Admin architecture restructuring** (shared Admin component architecture, Formations as pilot) once you confirm Phase 2 is acceptable. Recommend deciding, before Phase 3 starts, whether the two out-of-scope findings above should be scheduled as their own micro-phase (they're small, low-risk, and site-wide rather than Admin-specific) or folded into Phase 4's visual/cleanup pass as originally planned.
