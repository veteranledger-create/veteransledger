# MIGRATION PROGRESS — VeteranLedger

> **Last updated**: 2025-01-XX  
> **Current phase**: Phase 1 — Core Architecture  
> **Next phase**: Phase 2 — HTML Integration  
> **Total completion**: ~40%

---

## Phase Legend

| Icon | Meaning |
|------|---------|
| ✅ | Complete |
| 🔶 | In Progress / Partial |
| ⚠️ | Blocked / Has Issues |
| ⬜ | Not Started |
| 🚫 | Won't Do |

---

## Phase 0 — Project Foundation (✅ Complete)

### Milestones
- [x] **Vite initialization** — `vite.config.js` with multi-page support
- [x] **Package setup** — `package.json` with scripts and dependencies
- [x] **Path aliases** — `@`, `@css`, `@js`, `@components`, `@utils`, `@core`, `@pages`, `@data`, `@public`
- [x] **Build output** — `dist/` with hash-named assets, clean separation
- [x] **Google integrations** — AdSense + Analytics preserved in all pages

### Deliverables
- `vite.config.js` — fully configured
- `package.json` — build, dev, preview, validate scripts
- `dist/` — production build output

---

## Phase 1 — Core Architecture (✅ Complete)

### Milestones
- [x] **Site configuration** — Centralized `src/config/site.js`
  - Site metadata, navigation, legal links, theme, data sources
- [x] **CSS architecture** — 14 modular files in 5 layers
  - Base: variables, reset
  - Utilities: animations, typography, responsive
  - Layout: navbar, hero, section-container, footer
  - Components: buttons, cards, modal, attribution, watermark
  - Pages: home
  - Entry: `src/css/main.css` with @import cascade
- [x] **JS core modules** — 4 modules
  - `config.js` — Re-exports from site config
  - `data-loader.js` — Multi-strategy loading (JSON → JS → inline)
  - `theme-manager.js` — Dark/light toggle with persistence
  - `image-attribution.js` — Attribution block rendering
- [x] **JS utility modules** — 3 modules
  - `dom.js` — `createElement`, `clearChildren`, `getEl`, `escapeHTML`, event delegation
  - `format.js` — `branchLabel`, `branchClass`, `formatLifespan`, `nl2br`
  - `validation.js` — Schema, required fields, image URL validation
- [x] **JS component modules** — 4 modules
  - `navigation.js` — Build nav, mobile menu, theme toggle bindings
  - `footer.js` — Build footer with legal links
  - `modal.js` — Open/close, keyboard trap, focus management, scroll lock
  - `return-to-top.js` — Scroll-to-top button with throttle
- [x] **JS page modules** — 7 modules
  - `home.js` — Home page entry
  - `veterans.js` — Card rendering, biography modals
  - `battles.js` — Card rendering, detail modals
  - `technology.js` — Card rendering, detail modals
  - `articles.js` — Card rendering, article modals
  - `letters.js` — Card rendering, full-content modals
  - `political.js` — Card rendering, topic modals
- [x] **Data pipeline**
  - Legacy `.js` files preserved in `data/`
  - JSON files in `public/data/` (and copied to `dist/data/`)
  - `DATA_SOURCES` config maps keys → paths → variable names
  - All 6 datasets validated (57 veterans, 38 battles, 29 weapons, 6 topics, 12 letters, 1 modal object)
- [x] **Validation scripts** — 6 scripts
  - `audit.mjs` — Multi-layer project audit
  - `validate-json.mjs` — JSON syntax + structure validation
  - `validate-images.mjs` — Image existence scanning
  - `convert-data-files.mjs` — JS → JSON conversion
  - `copy-static-files.mjs` — Post-build asset copy
  - `write-css-files.mjs` — CSS file generation (legacy)
- [x] **Documentation**
  - `README.md` — Setup, build, architecture
  - `PROJECT_STATE.md` — Current architecture status
  - `MIGRATION_PROGRESS.md` — This file
  - `ARCHITECTURE.md` — Detailed architecture reference
  - `KNOWN_ISSUES.md` — Known limitations and risks

### Deliverables
- Complete `src/` directory with 35 source files
- 6 validation/utility scripts
- 5 documentation files
- Production build produces `dist/` with all 10 pages, all data, all images

---

## Phase 2 — HTML Integration (⬜ Not Started)

### Goals
- Link new CSS modules into HTML pages (replacing inline `<style>` blocks)
- Link new JS page modules into HTML pages (replacing inline `<script>` blocks)
- Remove CDN dependencies (Tailwind, Google Fonts — load locally)
- Remove duplicate CSS variables from HTML pages
- Add `<script type="module">` tags referencing Vite-processed assets

### Tasks
- [ ] Create incremental CSS import for each HTML page
- [ ] Add module script tags to HTML pages
- [ ] Remove duplicate inline CSS variable declarations
- [ ] Remove Tailwind CDN script (not used in pages)
- [ ] Handle Vite HTML processing for large files (>80KB)
- [ ] Test each page in dev mode (`npm run dev`)
- [ ] Verify no visual regressions between inline and modular CSS
- [ ] Test all modals and interactive elements

### Risk Assessment
| Risk | Severity | Mitigation |
|------|----------|------------|
| Vite drops large HTML files | High | Use `copy-static-files.mjs` as fallback |
| CSS cascade conflicts | Medium | Layer with `@layer` or specificity scoping |
| JS module scope conflicts | Medium | Use `DOMContentLoaded` listeners, no globals |
| Missing images break layout | Low | Hero has CSS background fallback |

---

## Phase 3 — UI Refinement (⬜ Not Started)

### Goals
- Consistent spacing system (now defined: `--space-xs` through `--space-2xl`)
- Typography hierarchy refinement
- Responsive grid layouts across all pages
- Smooth, non-distracting transitions
- Improved navigation structure
- Better mobile usability (touch targets, swipe)
- Accessibility improvements (ARIA, focus indicators, skip links)
- Performance optimization (image lazy loading, CSS containment)

### Tasks
- [ ] Audit existing inline CSS for consistency with new variable system
- [ ] Apply spacing system across all components
- [ ] Refine typography scale and rhythm
- [ ] Add skip-to-content links
- [ ] Add focus-visible styles for keyboard users
- [ ] Add `prefers-reduced-motion` compliance
- [ ] Add `loading="lazy"` to all content images
- [ ] Optimize large images (~2MB Hermann Göring portrait)
- [ ] Add CSS `content-visibility` to offscreen sections

---

## Phase 4 — Data Enhancement (⬜ Not Started)

### Goals
- Add schema validation for all 6 datasets
- Add cross-references between datasets (veteran → battles, battles → weapons)
- Add search/filter functionality powered by data-loader
- Add timeline visualization improvements
- Add map integration for battle locations

### Tasks
- [ ] Add required field validation to all datasets
- [ ] Add relational IDs (e.g., `veteranId` in battles)
- [ ] Build search component using data-loader
- [ ] Add tag/category filtering
- [ ] Improve timeline chronological rendering

---

## Phase 5 — Production Hardening (⬜ Not Started)

### Goals
- SEO optimization
- Performance budget (target: <2s load time, <500KB critical path)
- Accessibility score (target: 95+ Lighthouse)
- Security headers review
- Sitemap and robots.txt audit
- Image optimization pipeline
- Caching strategy for static assets

### Tasks
- [ ] Add meta descriptions to all pages
- [ ] Add Open Graph / Twitter Card tags
- [ ] Add structured data (JSON-LD for archive)
- [ ] Audit image sizes and formats (WebP conversion)
- [ ] Implement caching headers strategy
- [ ] Add `<link rel="preload">` for critical assets
- [ ] Build CSS/JS chunk optimization (code splitting)
- [ ] Add 404 page
- [ ] Test with disabled JavaScript

---

## Completed Validations

### JSON Validated (Phase 1)
| Dataset | Entries | Size | Status |
|---------|---------|------|--------|
| veterans.json | 57 | 429.6KB | ✅ Valid |
| battles.json | 38 | 349.5KB | ✅ Valid |
| weapons.json | 29 | 336.1KB | ✅ Valid |
| topics.json | 6 | 93.8KB | ✅ Valid |
| letters.json | 12 | 17.3KB | ✅ Valid |
| modal.json | 1 | 6.1KB | ✅ Valid |

### Build Validated (Phase 1)
- 29 modules transformed successfully
- 16 output files generated
- 0 compilation errors
- 0 broken CSS imports
- 0 unresolved JS imports
- 0 missing CSS variables
- 16 static assets copied post-build

### Audit Results (Phase 1)
| Check | Issues | Status |
|-------|--------|--------|
| JSON validity | 0 | ✅ Pass |
| Image existence | 15 (missing, pre-existing) | ⚠️ Needs content |
| CSS @import targets | 0 | ✅ Pass |
| JS import resolution | 0 | ✅ Pass |
| Vite config paths | 0 | ✅ Pass |
| Package.json scripts | 0 | ✅ Pass |
| CSS variable consistency | 0 | ✅ Pass |

---

## Unresolved Risks

| # | Risk | Impact | Likelihood | Phase Resolved |
|---|------|--------|------------|----------------|
| 1 | 8 hero background images missing | Visual — hero section shows alt text fallback | Certain | Phase 3 (content) |
| 2 | 2 battle images missing | Cards show no image placeholder | High | Phase 3 (content) |
| 3 | 5 technology images missing | Same as above | High | Phase 3 (content) |
| 4 | Large HTML files bypass Vite processing | Only matters when linking module scripts | Medium | Phase 2 |
| 5 | CSS duplication (inline vs modular) | Maintenance burden, not functional issue | Certain | Phase 2 |
| 6 | JS duplication (inline vs modular) | Same as above | Certain | Phase 2 |
| 7 | Tailwind CDN dependency | Loads external resource, unnecessary | Certain | Phase 2 |
| 8 | Google Fonts CDN | Same as above | Certain | Phase 2 |

---

*Update this file after completing each phase milestone.*
