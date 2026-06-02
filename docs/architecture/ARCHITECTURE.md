# ARCHITECTURE — VeteranLedger

> **Last updated**: 2025-01-XX  
> **Purpose**: Persistent reference for future development sessions  
> **Scope**: Full-stack static archival website

---

## 1. Folder Structure

```
veteranledger/
│
├── index.html                 # Home page (inline styles + scripts)
├── veterans.html              # Veterans archive page
├── battles.html               # Battles archive page
├── technology.html            # Weapons & technology page
├── articles.html              # Historical articles page
├── letters.html               # Historical letters page
├── political.html             # Political/leadership page
├── timeline.html              # Chronological timeline
├── disclaimer.html            # Legal disclaimer
├── credits.html               # Image credits/attributions
│
├── data/                      # Legacy .js data files (untouched)
│   ├── veterans.js
│   ├── battles.js
│   ├── weapons.js
│   ├── topics.js
│   ├── letters.js
│   ├── modal.js
│   └── README.md              # Data format documentation
│
├── public/                    # Vite's static directory
│   └── data/                  # JSON files (converted from .js)
│       ├── veterans.json
│       ├── battles.json
│       ├── weapons.json
│       ├── topics.json
│       ├── letters.json
│       └── modal.json
│
├── images/                    # Historical archive images
│   ├── background-hero/       # (empty — needs sourcing)
│   ├── battels/               # (empty — needs sourcing)
│   ├── technology/            # 9 files, 13.8MB
│   ├── ui/                    # 3 files (logo, placeholder, telegram icon)
│   └── veterans/              # 5 files, 1.6MB
│       ├── kriegsmarine/
│       └── luftwaffe/
│
├── src/                       # MODULAR ARCHITECTURE (NEW)
│   ├── config/                # Central configuration
│   │   └── site.js            #    Site metadata, nav, data sources
│   │
│   ├── css/                   # MODULAR CSS (14 files)
│   │   ├── main.css           #   Entry point (imports all)
│   │   ├── base/              #   Variables, reset
│   │   ├── components/        #   Buttons, cards, modal, attribution, watermark
│   │   ├── layout/            #   Navbar, hero, footer, section-container
│   │   ├── pages/             #   Page-specific styles
│   │   └── utilities/         #   Animations, typography, responsive
│   │
│   └── js/                    # MODULAR JAVASCRIPT (15 files)
│       ├── components/        #   Reusable UI components
│       ├── core/              #   Config, data loading, theme, attribution
│       ├── pages/             #   Page entry modules (1 per HTML page)
│       └── utils/             #   DOM helpers, formatting, validation
│
├── scripts/                   # BUILD AND VALIDATION SCRIPTS (6 files)
│
├── backup/                    # Snapshot of original data for safekeeping
│   └── data/                  #   veterans.json, images/ structure copy
│
├── dist/                      # PRODUCTION BUILD OUTPUT
│   ├── assets/                #   css/, js/, images/ (hash-named)
│   ├── data/                  #   All datasets (JSON + legacy .js)
│   └── images/                #   Copied archive images
│   └── *.html                 #   All 10 HTML pages
│
├── vite.config.js             # Vite configuration
├── package.json               # Dependencies and scripts
├── templates.js               # Legacy data loader (unused by pages)
├── README.md                  # Project documentation
├── docs/                      # Documentation hierarchy
│   ├── README.md              # Documentation index
│   ├── architecture/          # Architecture reference (this file)
│   ├── deployment/            # Deployment guides and checklists
│   ├── audits/                # Audit reports
│   ├── restoration/           # Asset and content restoration
│   ├── legal/                 # Legal and compliance docs
│   ├── project/               # Project state and issues
│   └── reports/               # QA and audit reports
├── ads.txt                    # Google AdSense verification
├── robots.txt                 # SEO
└── sitemap.xml                # SEO
```

---

## 2. CSS Architecture

### Layer Cascade

```
main.css (entry point)
│
├── 1. base/reset.css          # CSS reset, box-sizing, base element styles
├── 2. base/variables.css      # CSS custom properties (colors, fonts, spacing, transitions)
├── 3. utilities/animations.css # Fade-in, page transitions, card stagger
├── 4. utilities/typography.css # Font scaling, text balance, special classes
├── 5. utilities/responsive.css # Responsive breakpoints, container queries
├── 6. layout/navbar.css       # Fixed navigation, mobile menu
├── 7. layout/hero.css         # Hero section with overlay, title, subtitle
├── 8. layout/section-container.css # Page section containers, intro cards
├── 9. layout/footer.css       # Footer with logo, tagline, legal links
├── 10. components/buttons.css # Card buttons, overlay buttons, return-to-top
├── 11. components/cards.css   # Archival cards, figure cards, perspective cards
├── 12. components/modal.css   # Modal overlay, container, header, body, footer
├── 13. components/attribution.css # Image attribution below figures
├── 14. components/watermark.css  # Fixed "ARCHIVE" watermark background
└── 15. pages/home.css         # Home page specific styles
```

### CSS Custom Properties (Design Tokens)

All design tokens are defined in `src/css/base/variables.css`:

```css
:root {
  /* Color System */
  --doc-bg: #F2E8DA;              /* Page background (aged paper) */
  --doc-bg-secondary: #E5D9C8;    /* Secondary background */
  --doc-paper: #FCF5E8;           /* Card/container background */
  --doc-text: #1E1B16;            /* Primary text */
  --doc-text-secondary: #3A342C;  /* Secondary text */
  --doc-text-muted: #5F5345;      /* Muted/legal text */
  --doc-border: #7F6E5A;          /* Borders */
  --doc-accent: #8B7A66;          /* Accent (links, buttons) */
  --doc-accent-light: #A08F7A;    /* Light accent variant */
  --doc-iron: #5F5345;            /* Dark accent variant */
  --doc-shadow: rgba(0,0,0,0.12); /* Box shadows */

  /* Hero Section */
  --hero-title: #1E1B16;
  --hero-subtitle: #3A342C;

  /* Typography */
  --font-document: 'Special Elite', 'Courier Prime', 'Courier New', monospace;
  --font-typewriter: 'Special Elite', 'Courier Prime', 'Courier New', monospace;

  /* Logo */
  --logo-url: url("/images/ui/logo-web-site.png");
  --logo-filter: none;

  /* Spacing System */
  --space-xs: 4px;
  --space-sm: 8px;
  --space-md: 16px;
  --space-lg: 24px;
  --space-xl: 32px;
  --space-2xl: 48px;

  /* Transitions */
  --transition-fast: 0.15s ease;
  --transition-base: 0.25s ease;
  --transition-slow: 0.4s ease;
}

[data-theme="dark"] {
  /* Dark mode overrides for all color tokens */
  --doc-bg: #1E1B16;
  --doc-paper: #2A241E;
  --doc-text: #E5D9C8;
  --doc-accent: #A08F7A;
  --logo-filter: invert(100%) brightness(200%);
  /* ... see file for full dark mode palette */
}
```

### Visual Design Patterns

| Pattern | CSS Class | Effect |
|---------|-----------|--------|
| Aged paper texture | `body::before` + `body::after` | Subtle ruled lines + noise overlay via SVG filter |
| Archive watermark | `.archive-watermark` | Fixed rotated "ARCHIVE" text at 3-4% opacity |
| Fade-in animation | `.fade-in` | Opacity 0→1, translateY 20px→0 over 0.6s |
| Card hover lift | `.archival-card:hover` | translateY(-5px), enhanced shadow |
| Acid-free left border | `.archival-card`, `.document-card` | 4-6px solid accent border left |
| Dark overlay on hero | `.hero-overlay` | Linear gradient with `mix-blend-mode: multiply` |

---

## 3. JS Module Architecture

### Module Dependency Graph

```
Vite Entry Points
├── src/js/pages/home.js
├── src/js/pages/veterans.js
├── src/js/pages/battles.js
├── src/js/pages/technology.js
├── src/js/pages/articles.js
├── src/js/pages/letters.js
└── src/js/pages/political.js
         │
         ├──→ @core/config           (data: NAVIGATION, SITE, DATA_SOURCES, THEME, LEGAL_LINKS)
         │       └──→ src/config/site.js
         │
         ├──→ @core/theme-manager    (get/set/toggle theme, prefers-color-scheme detection)
         │
         ├──→ @core/data-loader      (loadData, clearCache, validateSchema, getById)
         │       └──→ DATA_SOURCES config
         │
         ├──→ @core/image-attribution (renderAttribution for image credit blocks)
         │
         ├──→ @components/navigation (buildNav, initNavigation)
         │       └──→ NAVIGATION + THEME configs
         │
         ├──→ @components/footer     (buildFooter)
         │       └──→ SITE + LEGAL_LINKS configs
         │
         ├──→ @components/modal      (openModal, closeModal, initModals)
         │       └──→ loadData for modal content
         │
         ├──→ @components/return-to-top (initReturnToTop)
         │
         └──→ @utils/dom             (createElement, clearChildren, getEl, escapeHTML)
         └──→ @utils/format          (branchLabel, branchClass, formatLifespan, nl2br)
         └──→ @utils/validation      (validateRequiredFields, validateImageUrl)
```

### Vite Path Aliases

| Alias | Resolves To |
|-------|-------------|
| `@` | `src/` |
| `@css` | `src/css/` |
| `@js` | `src/js/` |
| `@components` | `src/js/components/` |
| `@utils` | `src/js/utils/` |
| `@core` | `src/js/core/` |
| `@pages` | `src/js/pages/` |
| `@data` | `data/` |
| `@public` | `public/` |

### Shared Component Patterns

**Navigation** (`navigation.js`):
- Builds nav HTML from `NAVIGATION` config
- Highlights active page based on `window.location.pathname`
- Mobile menu with hamburger/close toggle, click outside to close
- Theme toggle button with label swap
- Responsive: desktop nav hidden <1024px, mobile visible

**Modal** (`modal.js`):
- Dynamic creation from JS (no HTML template required)
- Focus trap: Tab cycles within modal, Shift+Tab goes backwards
- Escape key closes
- Click overlay background to close
- Scroll lock on `<body>` while open
- Previous focus restored on close
- `aria-modal="true"`, `role="dialog"`, `aria-label` set dynamically
- Animation with 300ms CSS transition on `.modal-overlay`

**Return to Top** (`return-to-top.js`):
- Throttled scroll listener (requestAnimationFrame)
- Visible after 300px scroll distance
- Smooth scroll to top on click
- Creates button if not in DOM

### Page Module Pattern

Every page module follows this structure:

```javascript
import '@css/main.css';                  // Import CSS
import { initTheme } from '@core/theme-manager';
import { initNavigation, buildNav } from '@components/navigation';
// ... other imports

async function renderPage() {            // Async render function
  const data = await loadData('key');
  const grid = document.getElementById('grid-id');
  data.forEach(item => grid.appendChild(createCard(item)));
}

function createCard(item) {              // Card factory
  const card = createElement('div', { className: 'archival-card' });
  // ... build card content
  return card;
}

function openDetailModal(item) {         // Modal display
  openModal({ title: item.title, bodyHTML: '...' });
}

document.addEventListener('DOMContentLoaded', () => {  // Init
  initTheme();
  buildNav();
  buildFooter();
  initNavigation();
  initReturnToTop();
  initModals();
  renderPage();
});
```

---

## 4. Data Flow

### Loading Strategy (Priority Order)

```
loadData('veterans')
  │
  ├── 1. Try Inline Script Tag
  │      Check: document.getElementById('veterans-data')
  │      Check: window.veteranProfiles exists
  │      If found → cache + return
  │
  ├── 2. Try JSON File
  │      fetch('/data/veterans.json')
  │      Validate: JSON.parse
  │      If success → cache + return
  │
  └── 3. Try Legacy JS File
         fetch('/data/veterans.js')
         Evaluate: new Function(fn + 'window.__tmp = varName')
         If success → cache + return
         If all fail → return []
```

### Data Source Configuration

```javascript
DATA_SOURCES = {
  veterans:  { jsonPath: "/data/veterans.json",  jsPath: "/data/veterans.js",  variableName: "veteranProfiles" },
  battles:   { jsonPath: "/data/battles.json",   jsPath: "/data/battles.js",   variableName: "battlesData" },
  weapons:   { jsonPath: "/data/weapons.json",   jsPath: "/data/weapons.js",   variableName: "weaponsData" },
  topics:    { jsonPath: "/data/topics.json",    jsPath: "/data/topics.js",    variableName: "topicsData" },
  letters:   { jsonPath: "/data/letters.json",   jsPath: "/data/letters.js",   variableName: "lettersData" },
  modal:     { jsonPath: "/data/modal.json",     jsPath: "/data/modal.js",     variableName: "modalData" },
}
```

### Dataset Schemas

**veterans.json** (57 entries):
```json
{
  "id": "string",
  "name": "string",
  "rank": "string",
  "life": "string (birth-death)",
  "branch": "string (heeres/kriegsmarine/luftwaffe/ss/allgemeine-ss/waffen-ss)",
  "commands": "string",
  "nickname": "string (optional)",
  "image": "string (path)",
  "fullBio": {
    "earlyLife": "string",
    "militaryCareer": "string",
    "achievements": "string (optional)",
    "laterLife": "string (optional)"
  }
}
```

**battles.json** (38 entries):
```json
{
  "id": "number",
  "title": "string",
  "year": "string",
  "description": "string",
  "longContent": "string",
  "image": "string (path or external URL)",
  "credit": "string (attribution)"
}
```

**weapons.json** (29 entries):
```json
{
  "id": "number",
  "name": "string",
  "year": "string",
  "description": "string",
  "longContent": "string",
  "image": "string (path or external URL)",
  "credit": "string (attribution)"
}
```

**topics.json** (6 entries):
```json
{
  "id": "number",
  "title": "string",
  "year": "string",
  "description": "string",
  "longContent": "string",
  "image": "string (path or external URL)",
  "credit": "string (attribution)"
}
```

**letters.json** (12 entries):
```json
{
  "id": "number",
  "author": "string",
  "year": "string",
  "description": "string",
  "longContent": "string",
  "recipient": "string (optional)",
  "image": "string (path or external URL)",
  "credit": "string (attribution)"
}
```

**modal.json** (1 object):
```json
{
  "key-name": {
    "title": "string",
    "content": "string (HTML)",
    "link": "string (URL, optional)"
  }
}
```

---

## 5. Build Pipeline

### Development
```
npm run dev
  → Vite dev server on port 3000
  → Public/ served as /
  → src/css/* and src/js/* processed on-the-fly
  → Legacy HTML pages served as-is
  → data/ and public/data/ merged under /data/
```

### Production
```
npm run build
  → Stage 1: vite build
      → Processes: src/js/pages/*.js (with imports)
      → Processes: index.html, credits.html, timeline.html, disclaimer.html (smaller pages)
      → Output: dist/assets/css/, dist/assets/js/, dist/index.html, etc.
      → Note: Large HTML files may be skipped by Vite's HTML plugin
      
  → Stage 2: node scripts/copy-static-files.mjs
      → Copies: veterans.html, battles.html, technology.html, articles.html, letters.html, political.html
      → Copies: ads.txt, robots.txt, sitemap.xml
      → Copies: data/*, public/data/* → dist/data/
      → Copies: public/images/* → dist/images/
      → Copies: images/* → dist/images/
```

### Output Structure
```
dist/
├── index.html
├── veterans.html              (copied if Vite skipped)
├── battles.html               (copied if Vite skipped)
├── technology.html            (copied if Vite skipped)
├── articles.html              (copied if Vite skipped)
├── letters.html               (copied if Vite skipped)
├── political.html             (copied if Vite skipped)
├── credits.html               (Vite-processed if <~80KB)
├── disclaimer.html            (Vite-processed if <~80KB)
├── timeline.html              (Vite-processed if <~80KB)
├── assets/
│   ├── css/modal-{hash}.css   (bundled CSS)
│   ├── js/
│   │   ├── home-{hash}.js
│   │   ├── veterans-{hash}.js
│   │   ├── battles-{hash}.js
│   │   ├── technology-{hash}.js
│   │   ├── articles-{hash}.js
│   │   ├── letters-{hash}.js
│   │   ├── political-{hash}.js
│   │   ├── modal-{hash}.js
│   │   ├── dom-{hash}.js
│   │   └── format-{hash}.js
│   └── images/logo-web-site-{hash}.png
├── data/                      (all datasets)
│   ├── veterans.json          (JSON format)
│   ├── battles.json
│   ├── weapons.json
│   ├── topics.json
│   ├── letters.json
│   ├── modal.json
│   ├── veterans.js            (legacy JS format)
│   └── ... (other legacy JS files)
├── images/                    (all archive images)
├── ads.txt
├── robots.txt
└── sitemap.xml
```

---

## 6. Vite Integration Details

### Configuration (`vite.config.js`)

```javascript
// Key settings:
root: "."                          // Project root
base: "/"                          // Root-relative paths
publicDir: "public"                // Static assets
build.outDir: "dist"               // Output directory
build.emptyOutDir: true            // Clean before build

// Entry points (auto-discovered HTML + explicit JS pages):
rollupOptions.input: {
  ...htmlFiles,                    // All .html files in root
  home: "src/js/pages/home.js",
  veterans: "src/js/pages/veterans.js",
  battles: "src/js/pages/battles.js",
  technology: "src/js/pages/technology.js",
  articles: "src/js/pages/articles.js",
  letters: "src/js/pages/letters.js",
  political: "src/js/pages/political.js",
}

// Path aliases:
resolve.alias: {
  "@": "src/",
  "@css": "src/css/",
  "@js": "src/js/",
  "@components": "src/js/components/",
  "@utils": "src/js/utils/",
  "@core": "src/js/core/",
  "@pages": "src/js/pages/",
  "@data": "data/",
  "@public": "public/",
}
```

### Known Vite Behaviors

1. **HTML Processing**: Vite only processes HTML files that:
   - Are <~80KB in size (empirical observation)
   - Don't contain syntax errors in inline scripts
   - Have valid `<script>` tags it can transform
   
2. **Large HTML Files**: `veterans.html` (481KB), `battles.html` (410KB), etc. are **copied as-is** to dist by `copy-static-files.mjs`

3. **CSS Imports**: `@import` statements in CSS are inlined by Vite during build. The CSS entry file `main.css` uses 14 `@import` statements that are all resolved into a single CSS output file.

4. **Module Scripts**: The JS page modules in `src/js/pages/` are compiled as separate entry chunks. They are **not injected into HTML pages** — they exist as standalone `.js` files that can be loaded with `<script type="module" src="...">`.

---

## 7. Compatibility Layers

### Legacy ↔ Modern

| Concern | Legacy (Current) | Modern (Available) |
|---------|-----------------|-------------------|
| **CSS** | Inline `<style>` in each HTML | Modular CSS via `main.css` |
| **Data loading** | Inline JS in each HTML | `data-loader.js` (3-strategy) |
| **Data format** | `.js` files in `data/` | `.json` files in `public/data/` |
| **Data loader utils** | `templates.js` (standalone) | `src/js/core/data-loader.js` |
| **Navigation** | Inline HTML in each page | `navigation.js` component |
| **Theme toggle** | Inline JS per page | `theme-manager.js` with localStorage |
| **Modals** | Inline overlay per page | `modal.js` (keyboard-accessible) |
| **Build** | None (static HTML) | Vite multi-page build |

### Backward Compatibility Guarantees

1. **All 10 original HTML pages remain untouched** — no structural changes
2. **All legacy data files remain in `data/`** — not moved or modified
3. **`templates.js` remains available** — though unused by current pages
4. **Backup directory contains original state** — `backup/images/`, `backup/data/`
5. **No runtime dependencies removed** — Tailwind CDN, Google Fonts CDN still load
6. **All Google integrations preserved** — AdSense, Analytics, conversion tracking
7. **No image files moved or deleted** — all original paths preserved
8. **Inline styles and scripts continue to work** — modular code is additive only

---

*This document serves as the definitive reference for the project architecture. Update whenever the module structure, data flow, or build pipeline changes.*
