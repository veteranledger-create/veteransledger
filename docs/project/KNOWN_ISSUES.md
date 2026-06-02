# KNOWN ISSUES — VeteranLedger

> **Last updated**: 2026-05-23  
> **Severity legend**: 🔴 Critical · 🟡 Major · 🔵 Minor · ⚪ Info  
> **Status**: Migration Phase 1 complete — HTML Integration not yet started
> **📋 Asset audit**: See [MISSING_ASSETS.md](../restoration/MISSING_ASSETS.md) for full missing image inventory with source file references, line numbers, and restoration priority

---

## 🔴 Critical Issues

### 1. Missing Hero Background Images (8 files)

| File                                                     | Referenced By     |
| -------------------------------------------------------- | ----------------- |
| `/images/background-hero/articles-hero-background.png`   | `articles.html`   |
| `/images/background-hero/battles-hero-background.png`    | `battles.html`    |
| `/images/background-hero/home-hero-background.png`       | `index.html`      |
| `/images/background-hero/letters-hero-background.png`    | `letters.html`    |
| `/images/background-hero/nsdap-hero-background.png`      | `political.html`  |
| `/images/background-hero/Technology-hero-background.png` | `technology.html` |
| `/images/background-hero/timeline-hero-background.png`   | `timeline.html`   |
| `/images/background-hero/veterans-hero-background.png`   | `veterans.html`   |

**Impact**: Hero sections display with CSS background color only. Images show broken `alt` fallback. Visual degradation but no functional breakage — hero has CSS `background` fallback and `object-fit: cover` with `mix-blend-mode: multiply`.

**Root cause**: Directory `images/background-hero/` exists but is empty. These images need to be sourced and added.

**Resolution**: Add hero background PNGs to `images/background-hero/`. Recommended dimensions: 1920×800px or larger. Not a code issue — requires content acquisition.

---

### 2. Missing Battle Images (2 files)

| File                                                   | Referenced In                                 |
| ------------------------------------------------------ | --------------------------------------------- |
| `images/battels/1940/Battle-of-France-(Fall Gelb).jpg` | `data/battles.js`, `public/data/battles.json` |
| `images/battels/1945/operation-steiner.png`            | `data/battles.js`, `public/data/battles.json` |

**Impact**: Battle cards referencing these images show broken image placeholders. External Wikimedia URLs (the majority of battle images) work fine.

**Root cause**: Local image directories `images/battels/1940/` and `images/battels/1945/` are empty.

**Resolution**: Source appropriate public-domain battle images.

---

### 3. Missing Technology Images (5 files)

| File                                             | Referenced In                                 |
| ------------------------------------------------ | --------------------------------------------- |
| `images/technology/Die-Glocke-(The Bell).png`    | `data/weapons.js`, `public/data/weapons.json` |
| `images/technology/Amerika-Rakete.png`           | Same                                          |
| `images/technology/Landkreuzer-P-1000-Ratte.png` | Same                                          |
| `images/technology/MP-40.png`                    | Same                                          |
| `images/technology/Heinkel-He-111.jpg`           | Same                                          |

**Impact**: Weapon cards referencing these images show broken placeholders. Directory `images/technology/` has 9 other images that work fine.

**Resolution**: Source missing technology reference images.

---

## 🟡 Major Issues

### 4. Large HTML Files Bypass Vite Processing

**Files affected**: `veterans.html` (481KB), `battles.html` (410KB), `technology.html` (399KB), `articles.html` (131KB), `letters.html` (82KB), `political.html` (100KB)

**Impact**: These files are copied as-is to `dist/` by `copy-static-files.mjs` rather than being processed through Vite's HTML plugin. This means:

- No automatic `<script type="module">` injection for Vite-processed JS
- No CSS/JS minification for inline code
- No asset fingerprinting for referenced images
- No HMR (hot module replacement) in dev mode

**Mitigation (current)**: The post-build copy script ensures all HTML pages are present in `dist/`. The original inline styles and scripts continue to function.

**Resolution path**: Phase 2 (HTML Integration) will refactor these pages to use the modular architecture, making them small enough for Vite to process.

### 5. CSS Duplication — Inline vs Modular

**Impact**: Every HTML page contains its own copy of the full CSS (including variables, layout, components). The new `src/css/` modular system contains the same styles. This means:

- ~25KB of CSS duplicated 10 times = ~250KB of redundant CSS
- Changes must be made in both places during transition
- Risk of styles diverging

**Resolution path**: Phase 2 will remove inline CSS and replace with `<link>` to the modular CSS.

### 6. JS Duplication — Inline vs Modular

**Impact**: Every HTML page has inline data loading and rendering logic. The new `src/js/pages/` modules contain parallel implementations. During transition:

- Page functionality works independently from new modules
- New modules are compiled but never loaded on pages
- Changes must be duplicated during transition

**Resolution path**: Phase 2 will add `<script type="module">` tags to HTML pages, then gradually remove inline scripts.

---

## 🟡 Major (Pre-existing)

### 7. Empty scripts with no content

**Files**: `scripts/convert-data-files.mjs` (0 bytes), `scripts/write-css-files.mjs` (0 bytes)

**Impact**: Non-functional. These are placeholder scripts that were created but never populated. The `convert-data-files.mjs` functionality is partially covered by the manual conversion already done.

**Resolution**: Either populate with content or remove. Currently harmless.

---

## 🔵 Minor Issues

### 8. External CDN Dependencies

| Dependency                      | Purpose                            | Issue                                                             |
| ------------------------------- | ---------------------------------- | ----------------------------------------------------------------- |
| `cdn.tailwindcss.com`           | Responsive utilities               | Unnecessary — all pages use custom CSS. Adds 3.5MB+ to page size. |
| `fonts.googleapis.com`          | Special Elite, Courier Prime fonts | External dependency. Should be self-hosted for reliability.       |
| `pagead2.googlesyndication.com` | Google AdSense                     | Required for ad monetization. Intentional.                        |
| `www.googletagmanager.com`      | Google Analytics (gtag.js)         | Required for analytics. Intentional.                              |
| `img.icons8.com`                | Telegram icon (SVG)                | Inline data: URI (no external request). Fine.                     |

**Resolution path**: Phase 2 will remove Tailwind CDN. Phase 5 can self-host Google Fonts.

### 9. Theme Toggle Label Inconsistency

**Issue**: Inline theme toggles use `LIGHT`/`DARK` labels. The new modular `navigation.js` uses `☀︎ LIGHT`/`☽ DARK` with Unicode symbols.

**Impact**: Minor visual difference. Both work correctly.

**Resolution**: Standardize in Phase 3 (UI refinement).

### 10. No Skip-to-Content Link

**Impact**: Keyboard users must tab through the entire navigation to reach main content. Accessibility best practice violation.

**Resolution path**: Add in Phase 3 (UI refinement).

### 11. Focus Indicators Not Visible

**Impact**: The default `:focus` outline is removed by `reset.css` (`outline: none`). No `:focus-visible` styles exist yet.

**Resolution path**: Add `:focus-visible` styles in Phase 3.

### 12. Images Without `loading="lazy"`

**Impact**: All archival images load immediately on page load, increasing initial load time.

**Resolution path**: Add `loading="lazy"` to all content images below the fold in Phase 3.

---

## ⚪ Informational

### 13. Templates.js Not Referenced

**File**: `templates.js` (6.8KB)

**Status**: Present in root, contains data loading utilities, but not referenced by any HTML page. Appears to be a legacy utility file. All pages have their own inline data loading.

**Action**: Could be removed (with verification) or kept for reference. Currently harmless.

### 14. No TypeScript or Unit Tests

**Decision**: TypeScript would add complexity without significant benefit for a 15-module JS project. Unit tests should be added in Phase 5 (Production Hardening).

### 15. Veterans Images Not Optimized

| Image                | Size       |
| -------------------- | ---------- |
| `Hermann_Göring.jpg` | 1.4MB      |
| Other portraits      | 26KB–100KB |

**Impact**: The Göring portrait is large. Remaining portraits are reasonable.

**Resolution**: Convert to WebP, compress in Phase 5.

---

## Migration Limitations

### Current Phase Limitation

The migration architecture is **additive and non-destructive**. The new modular system runs in parallel with the existing inline system. This means:

1. **Both systems coexist** — old pages work as before; new modules compile but are unused
2. **No risk of regression** — existing inline code is never modified
3. **Double maintenance** — changes during transition must be made in two places
4. **Build complexity** — post-build copy step needed for large HTML files

### When Limitations Will Be Resolved

| Issue                               | Phase                          |
| ----------------------------------- | ------------------------------ |
| HTML pages not using modular CSS/JS | Phase 2 — HTML Integration     |
| CSS/JS duplication                  | Phase 2 — HTML Integration     |
| CDN dependencies                    | Phase 2 — HTML Integration     |
| Missing images (content)            | Phase 3 — Content Sourcing     |
| UI refinement                       | Phase 3 — UI Refinement        |
| Performance optimization            | Phase 5 — Production Hardening |

---

## Deployment Warnings

1. **Do NOT deploy with broken hero background images** — although functional, the broken images degrade the professional appearance
2. **Do NOT remove `copy-static-files.mjs` from build pipeline** — without it, 6 HTML pages and many assets will be missing from `dist/`
3. **AdSense/GA scripts required for monetization** — do not remove in any phase without explicit approval
4. **Inline CSS/JS removal must be incremental** — never delete inline code until modular replacement is verified working on live site
5. **Sitemap and robots.txt point to live URLs** — must be updated if URL structure changes
6. **All external image URLs (Wikimedia Commons) should be periodically verified** — external URLs can go down

---

## Quick Reference

### Commands

```bash
npm run dev              # Start dev server (port 3000)
npm run build            # Full production build
npm run preview          # Preview production build
npm run validate:json    # Validate all JSON data files
npm run validate:images  # Check all image references
npm run validate:all     # Full validation suite
```

### Build Success Criteria

```
✓ All 10 HTML pages in dist/
✓ All 6 JSON datasets valid
✓ 0 compilation errors
✓ All images (that exist) present in dist/images/
✓ All navigation links point to existing pages
```

### Key Files

| File                            | Purpose               |
| ------------------------------- | --------------------- |
| `src/config/site.js`            | Central configuration |
| `src/css/main.css`              | CSS entry point       |
| `src/js/core/data-loader.js`    | Data loading strategy |
| `vite.config.js`                | Build configuration   |
| `scripts/copy-static-files.mjs` | Post-build asset copy |
| `scripts/audit.mjs`             | Project audit         |

---

_This document should be reviewed before each deployment and updated as issues are resolved._
