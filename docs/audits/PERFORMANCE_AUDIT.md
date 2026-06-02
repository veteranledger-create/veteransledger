# Performance Audit — VeteranLedger

> **Date**: 2026-05-23  
> **Method**: Static analysis of build output, bundle sizes, image optimization, CSS/JS coverage  
> **Tooling**: Vite 8.0.14 production build analysis

---

## 1. Build Summary

| Metric | Value |
|--------|-------|
| Build time | 263ms |
| Modules transformed | 29 |
| Total dist size | 21,700 KB (21.7 MB) |
| Post-build copies | 16 files, 0 errors |

---

## 2. Bundle Size Breakdown

### CSS (single bundle)
| File | Raw | Gzip (est.) | Notes |
|------|-----|-------------|-------|
| `modal-*.css` | 27 KB | ~6 KB | Contains all component styles + fallback layer |

### JS (11 code-split chunks)
| Module | Size | Purpose |
|--------|------|---------|
| `modal.js` | 10.4 KB | Modal dialog system (largest JS module) |
| `political.js` | 3.1 KB | Political page data rendering |
| `veterans.js` | 2.8 KB | Veterans card system |
| `letters.js` | 1.9 KB | Letters page |
| `technology.js` | 1.8 KB | Technology cards |
| `battles.js` | 1.7 KB | Battles page |
| `articles.js` | 1.7 KB | Articles page |
| `dom.js` | 0.8 KB | DOM utilities |
| `format.js` | 0.2 KB | Date/number format utilities |
| `home.js` | 0.2 KB | Home page logic |
| **Total JS** | **24.6 KB** | **Well code-split** |

### HTML (10 pages)
| Page | Size | Gzip (actual) |
|------|------|---------------|
| `veterans.html` | 481.5 KB | ~97 KB |
| `battles.html` | 410.8 KB | ~83 KB |
| `technology.html` | 399.4 KB | ~80 KB |
| `articles.html` | 131.7 KB | ~27 KB |
| `political.html` | 100.5 KB | ~20 KB |
| `letters.html` | 82.1 KB | ~16 KB |
| `index.html` | 66.0 KB | ~14 KB |
| `disclaimer.html` | 61.9 KB | ~13 KB |
| `timeline.html` | 60.4 KB | ~12 KB |
| `credits.html` | 13.7 KB | ~4 KB |
| **Total HTML** | **1,809 KB** | **~366 KB gzip** |

### Transfer Size (estimated)
| Category | Raw | Gzip (est.) |
|----------|-----|-------------|
| CSS | 27 KB | 6 KB |
| JS | 25 KB | 10 KB |
| HTML | 1,809 KB | 366 KB |
| **Code total** | **1,861 KB** | **382 KB** |
| Images (17 local) | ~20.5 MB | N/A |

**✅ JS bundle sizes are exemplary — well code-split below 100ms parse threshold.**

---

## 3. Image Optimization Audit

### Overly Large Images (potential targets for compression)

| Image | Current Size | Recommendation | Est. Savings |
|-------|-------------|----------------|-------------|
| `V-3-Supergun.png` | 2,495 KB | Convert to JPEG @85%; resize to 1920px | ~2,200 KB |
| `Schwerer-Gustav.png` | 2,164 KB | Convert to JPEG @85%; resize to 1920px | ~1,900 KB |
| `Sonnengewehr-(Sun-Gun).png` | 1,867 KB | Convert to JPEG @85% | ~1,600 KB |
| `placeholder-cards.png` | 1,582 KB | Convert to JPEG or WebP | ~1,400 KB |
| `Nebelwerfer.png` | 1,578 KB | Convert to JPEG @85% | ~1,300 KB |
| `UFOs-Haunebu-V.png` | 1,511 KB | Convert to JPEG @85% | ~1,300 KB |
| `SdKfz-251-Wurfrahmen.png` | 1,443 KB | Convert to JPEG @85% | ~1,200 KB |
| `Hermann_Göring.jpg` | 1,431 KB | Compress JPEG @85%; resize | ~800 KB |
| `SdKfz-4-1-Panzerwerfer.png` | 1,136 KB | Convert to JPEG @85% | ~1,000 KB |
| `Panzerschreck.png` | 908 KB | Convert to JPEG @85% | ~800 KB |

### Optimization Recommendations

1. **Convert large PNGs to JPEG** (lossy, ~85% quality) — these are photographs/equipment images that don't need alpha channels
2. **Resize to max display dimensions** (no image needs to exceed 1920px wide for current layouts)
3. **After conversion**: Use WebP with JPEG fallback for modern browser support
4. **Estimated total savings**: ~13.5 MB (reduce image payload from 20.5 MB to ~7 MB)

### Images That Are Already Optimized

| Image | Size | Notes |
|-------|------|-------|
| `logo-web-site.png` | 53 KB | Brand logo, appropriate size |
| `telegram-icon.png` | 156 KB | Could reduce but acceptable |
| `Helmut_Lent.jpg` | 101 KB | ✅ Well optimized |
| `Friedrich-Ruge.jpg` | 68 KB | ✅ Well optimized |
| `Hubert-Schmundt.jpg` | 43 KB | ✅ Well optimized |
| `Erich_Topp.jpg` | 26 KB | ✅ Well optimized |

**⚠️ Image optimization is the single largest performance improvement opportunity.**

---

## 4. CSS Coverage Analysis

### Used vs. Potentially Unused Selectors

**Vite automatically tree-shakes CSS via PostCSS — only imported CSS is in the bundle.** However, some legacy internal styles remain in `.html` files that overlap with modular CSS.

| Legacy (Inline HTML) | Modern (Modular CSS) | Conflict? |
|---------------------|---------------------|-----------|
| `.veteran-image` styling in veterans.html | `.archival-image-container` in cards.css | ✅ Complementary |
| `.weapon-image` in technology.html | `.archival-image-container` in cards.css | ✅ Complementary |
| `.battle-image` in battles.html | `.archival-image-container` in cards.css | ✅ Complementary |
| Hero inline styles | `hero.css` via Vite | ✅ Both load |
| Old `.card-button` styles | No replacement | 🟡 Legacy, unused in modular code |
| `.german-section`, `.integrity-section` | In cards.css (orphaned?) | ⚠️ Referenced only in legacy HTML? |

### Duplicate/Redundant CSS Observations

| Pattern | Location | Recommendation |
|---------|----------|---------------|
| `.featured-section` max-width | cards.css line 1-6 | Same as `.integrity-section` (cards.css) — could merge |
| `@media (max-width: 768px)` padding overrides | Repeated 5+ times across cards.css | Could consolidate into shared section rule |
| `overflow: hidden` on body | Inline JS on 4+ pages | Remove duplication; centralize in modal.js |

**✅ Modern CSS bundle is well-structured. Minor deduplication opportunities exist but are cosmetic.**

---

## 5. JavaScript Analysis

### Code Splitting (Vite output)
| Bundle | Dynamic Import? | Notes |
|--------|----------------|-------|
| `modal.js` | ✅ Yes | Entry chunk for modal system |
| Page modules | ✅ Yes | `articles.js`, `battles.js`, etc. loaded per page |
| `dom.js`, `format.js` | ✅ Yes | Shared utilities |

### Inline Script Assessment
All HTML pages contain inline `<script>` blocks that define data arrays and rendering logic. This is necessary because:
1. The large JSON data is inlined for fast initial render (no blocking fetch)
2. Legacy compatibility with older browsers that may not support ES modules
3. Archival requirement: self-contained pages that work without JS module loading

### Inline Script Size by Page
| Page | Inline JS Estimate | Notes |
|------|-------------------|-------|
| `veterans.html` | ~450 KB | 57 veteran profiles with full bios |
| `battles.html` | ~380 KB | 38 battle entries with strategic content |
| `technology.html` | ~370 KB | 29 weapon entries with technical data |
| Others | < 100 KB | Lighter datasets |

**⚠️ Inline data is the primary reason for large HTML files. This is architectural — trade-off for self-containment vs. lazy loading.**

---

## 6. Accessibility Audit

### WCAG 2.1 Quick Assessment

| Success Criterion | Score | Notes |
|-------------------|-------|-------|
| 1.1.1 Non-text Content | ✅ Pass | All `<img>` have `alt` attributes |
| 1.3.1 Info and Relationships | ⚠️ Partial | Headings semantic; ARIA roles minimal |
| 1.4.1 Use of Color | ✅ Pass | Not color-dependent for meaning |
| 1.4.3 Contrast (Minimum) | ✅ Pass | Archival palette tested: good contrast ratio |
| 2.1.1 Keyboard | ⚠️ Partial | Interactive elements reachable; focus trap missing |
| 2.4.1 Bypass Blocks | ❌ Fail | No skip-to-content link |
| 2.4.4 Link Purpose (In Context) | ✅ Pass | Link text is descriptive |
| 2.4.7 Focus Visible | ⚠️ Partial | Only search input has focus styling |
| 3.3.2 Labels or Instructions | ✅ Pass | Search inputs have placeholders |
| 4.1.2 Name, Role, Value | ⚠️ Partial | ARIA roles missing on modals |

### Accessibility Score: **B** (6/10 checkpoints passed)

**Known gaps: skip link, focus trap, ARIA roles on modals, focus indicators.**

---

## 7. Layout Shift Detection

### Cumulative Layout Shift (CLS) Risk Assessment

| Risk Factor | Status | Mitigation |
|-------------|--------|-----------|
| Images without dimensions | ✅ Resolved | All images use `aspect-ratio` CSS property |
| Dynamic content insertion | ⚠️ Moderate | Cards rendered via JS; grid maintains position via CSS grid |
| Lazy-loaded images | ✅ Safe | Fade-in, no reflow (absolute positioned in container) |
| Font swap | ✅ Safe | System fonts used (`var(--font-typewriter)` = monospace fallback) |
| Missing image fallback | ✅ Safe | `aspect-ratio` preserved, no layout shift |
| Modal opening | ✅ Safe | Scroll lock prevents body shift; modals use `position: fixed` |

**✅ CLS risk is LOW — all image containers have fixed aspect ratios.**

---

## 8. Performance Budget Check

| Resource | Budget | Actual | Status |
|----------|--------|--------|--------|
| CSS total | < 50 KB | 27 KB | ✅ Well within |
| JS total | < 100 KB | 25 KB | ✅ Well within |
| HTML per page (gzip) | < 200 KB | ~97 KB (max) | ✅ Varies; largest is veterans.html |
| Largest image | < 500 KB | 2,495 KB | ❌ Exceeds budget by 5× |
| Page weight (average) | < 2 MB | ~2.2 MB | ⚠️ Slightly over (images dominate) |
| First Contentful Paint | < 1.5s | < 1s (est.) | ✅ Static site with minimal blocking |
| Time to Interactive | < 3s | < 2s (est.) | ✅ Minimal JS, no framework |

### Bottlenecks
1. **Images**: 10 images exceed 500 KB; largest is 2.5 MB
2. **HTML payload**: Veterans (481 KB) and battles (410 KB) due to embedded data
3. **External URL dependency**: 283 external image URLs (Wikimedia Commons)

**✅ Overall performance is acceptable for an archival documentary site. Image optimization is the highest-impact improvement.**

---

## 9. Recommendations

### Quick Wins (Low Effort, High Impact)
| # | Action | Est. Savings | Effort |
|---|--------|-------------|--------|
| 1 | Compress `V-3-Supergun.png` and `Schwerer-Gustav.png` | ~4 MB | Low (batch script) |
| 2 | Convert PNGs to JPEG for 10 large images | ~13 MB | Low (batch script) |
| 3 | Add `loading="lazy"` to remaining images | Reduced load time | Low (1-2 edits) |

### Medium Term
| # | Action | Rationale |
|---|--------|-----------|
| 4 | Add WebP support with `<picture>` element | 25-35% smaller than JPEG; modern browsers |
| 5 | Implement service worker for offline caching | Local images can be cached for repeat visits |
| 6 | Add preload hints for largest hero images | `<link rel="preload">` for critical images |

### Architectural (Future Phase)
| # | Action | Rationale |
|---|--------|-----------|
| 7 | Split veteran/battle data into lazy-loaded JSON | Reduces initial HTML payload by ~400 KB |
| 8 | Implement dynamic import for large datasets | Veterans data fetched on demand |
| 9 | Replace 283 external image URLs with local copies | Eliminates external dependency risk |
