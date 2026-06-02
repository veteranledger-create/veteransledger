# PROJECT STATE — VeteranLedger

> **Last updated**: 2025-01-XX  
> **Status**: Active development — Migration Phase 1 complete  
> **Build**: `npm run build` — production-ready static site

---

## 1. Architecture Status Overview

| Layer | Status | Details |
|-------|--------|---------|
| **Vite Build Pipeline** | ✅ Operational | Multi-page HTML + JS entry points. 29 modules compiled. |
| **CSS Architecture** | ✅ Complete | 14 modular files across 5 layers. Variable-driven theming. |
| **JS Module Architecture** | ✅ Complete | 7 page modules, 4 components, 3 core modules, 3 utilities. |
| **Data Pipeline** | ✅ Complete | JSON-first loading with JS fallback. All 6 datasets validated. |
| **HTML Pages** | 🔶 Legacy (untouched) | 10 HTML pages with inline styles. Parallel to new modules. |
| **Image Assets** | ⚠️ Partial | Some image directories empty (hero backgrounds, battle images). |

## 2. Completed Migration Phases

### Phase 0 — Foundation (Pre-existing)
- [x] Project root initialized with Vite
- [x] `package.json` with npm scripts
- [x] `vite.config.js` with multi-page config, path aliases
- [x] Google AdSense and Analytics integration
- [x] Tailwind CSS CDN (legacy pages only)

### Phase 1 — Core Architecture
- [x] Central site configuration (`src/config/site.js`)
- [x] CSS modular architecture (14 files, 5 layers)
- [x] JS core modules (config, data-loader, theme-manager, image-attribution)
- [x] JS utility modules (dom, format, validation)
- [x] JS component modules (navigation, footer, modal, return-to-top)
- [x] JS page modules (home, veterans, battles, technology, articles, letters, political)
- [x] JSON data conversion and validation
- [x] Post-build static file copying
- [x] Audit and validation scripts
- [x] README documentation

## 3. Active Systems

### Production Build (`npm run build`)
```
Root: project root (.)
Build tool: Vite 8.x
Output: dist/
Entry points: 10 HTML files + 7 JS page modules
Post-step: copy-static-files.mjs (copies large HTML + assets)
Total build time: ~250ms
```

### Development Server (`npm run dev`)
```
Port: 3000
Hot reload: Yes (CSS changes only)
Static assets: From public/ directory
Data files: Served from /data/ (public/data/ → /data/)
```

### Data Loading Strategy
```
1. Check for inline <script> tag with id="{key}-data"
2. Fetch JSON from /data/{key}.json
3. Fallback to legacy .js file via Function constructor
4. Return empty array/object if all fail
```

### Theme System
```
Key: localStorage.getItem('theme')
Default: 'light'
Dark mode: [data-theme="dark"] on <html>
Toggle: theme-manager.js toggleTheme()
Persistence: localStorage
Respects: prefers-reduced-motion
```

## 4. Preserved Legacy Systems

The following remain unchanged for backward compatibility:

| System | Location | Status |
|--------|----------|--------|
| **Legacy data files** | `data/*.js` (6 files) | ✅ Untouched |
| **Legacy data loader** | `templates.js` | ✅ Present, unused by pages |
| **Original HTML pages** | Root `*.html` (10 files) | ✅ Untouched, fully functional |
| **Inline CSS** | Within each HTML page | ✅ Preserved |
| **Inline JS** | Within each HTML page | ✅ Preserved |
| **Tailwind CDN** | `<script src="cdn.tailwindcss.com">` | ✅ Preserved (legacy pages) |
| **Google AdSense** | All pages | ✅ Preserved |
| **Google Analytics** | All pages | ✅ Preserved |
| **Backup directory** | `backup/` | ✅ Preserved |

## 5. Production Readiness

### ✅ Ready
- Vite build pipeline produces valid `dist/`
- All 10 HTML pages present in output
- All datasets available (JSON + legacy JS)
- All images present in `images/` directory
- All navigation links point to existing pages
- All external URLs (Wikimedia Commons) are live
- CSS variable system is complete and consistent
- JS module imports all resolve correctly
- Modal component is accessible (keyboard, focus, ARIA)
- Theme toggle works with localStorage persistence
- Return-to-top button functions across viewport sizes

### ⚠️ Needs Content
- **Hero background images** (8 files in `images/background-hero/`) — empty directory
- **Battle images** (2 files in `images/battels/`) — empty directory
- **Technology images** (5 data-referenced files) — not yet sourced

### 🔶 Not Yet Migrated
- HTML pages still use inline styles (Tailwind, custom CSS)
- HTML pages still use inline JS for data rendering
- New JS modules not linked from HTML pages (separate entry points only)
- CSS modules not imported from HTML pages (inline CSS still active)
- No Tailwind removal performed

## 6. File Inventory

### Source Files (35 total)
```
src/
├── config/     (1 file — 3.1KB)
├── css/        (14 files — 43.5KB)
│   ├── base/           (2 files)
│   ├── components/     (4 files)
│   ├── layout/         (4 files)
│   ├── pages/          (1 file)
│   └── utilities/      (3 files)
└── js/         (15 files — 48.6KB)
    ├── components/     (4 files)
    ├── core/           (4 files)
    ├── pages/          (7 files)
    └── utils/          (3 files)
```

### Scripts (6 files — 20.3KB)
```
scripts/
├── audit.mjs
├── convert-data-files.mjs
├── copy-static-files.mjs
├── validate-images.mjs
├── validate-json.mjs
└── write-css-files.mjs
```

### Data Files (12 files — 2.27MB)
```
data/public/data combined:
├── veterans.json    (429.6KB) — 57 entries
├── battles.json     (349.5KB) — 38 entries
├── weapons.json     (336.1KB) — 29 entries
├── topics.json      (93.8KB)  — 6 entries
├── letters.json     (17.3KB)  — 12 entries
├── modal.json       (6.1KB)   — 1 object
└── 6 legacy .js files (duplicates)
```

### Image Assets (~17MB total)
```
images/
├── background-hero/  (0 files — empty, awaiting content)
├── battels/          (0 files — empty, awaiting content)
├── technology/       (9 PNG files — 13.8MB)
├── ui/               (3 files — 1.8MB)
└── veterans/         (5 JPG files — 1.6MB)
```

## 7. Dependency Map

```
HTML Pages (inline) ← data/*.js (legacy)
     |
     v
Vite Build ← src/config/site.js
     |           |
     v           v
src/css/* ← src/js/core/config.js
     |              |
     v              v
CSS Modules ← JS Components/Pages/Utils
                  |
                  v
             data-loader.js → public/data/*.json
                                  |
                                  v
                             fallback → data/*.js
```

---

*This document should be updated after each migration phase.*
