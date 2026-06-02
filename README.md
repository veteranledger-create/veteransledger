# VeteranLedger – Axis History Archive 1933–1945

A static archival website documenting historical military commanders, battles, technology, correspondence, and political history from the Axis powers of World War II (1933–1945).

## Architecture

```
veteranledger/
├── data/                    # Legacy data files (.js)
├── public/
│   ├── data/                # Modern JSON datasets
│   ├── images/              # Site images
│   ├── licenses/            # Licensing files
│   └── static/              # Static assets
├── images/                  # Historical archive images
│   ├── background-hero/     # Page hero backgrounds (needs content)
│   ├── battels/             # Battle images (needs content)
│   ├── technology/          # Technology images
│   ├── ui/                  # UI images (logo, icons)
│   └── veterans/            # Veteran portraits
├── scripts/                 # Build and validation scripts
│   ├── audit.mjs            # Project integrity audit
│   ├── convert-data-files.mjs  # JS → JSON converter
│   ├── copy-static-files.mjs   # Post-build static copier
│   ├── validate-images.mjs     # Image asset validation
│   └── validate-json.mjs       # JSON validation
├── src/
│   ├── config/
│   │   └── site.js          # Central site configuration
│   ├── css/
│   │   ├── main.css         # CSS entry point (imports all modules)
│   │   ├── base/            # Variables, reset
│   │   ├── components/      # Buttons, cards, modal, attribution, watermark
│   │   ├── layout/          # Navbar, hero, footer, section-container
│   │   ├── pages/           # Page-specific styles
│   │   └── utilities/       # Animations, typography, responsive
│   └── js/
│       ├── components/       # Navigation, footer, modal, return-to-top
│       ├── core/             # Config, data-loader, theme-manager, image-attribution
│       ├── pages/            # Page entry modules (1 per HTML page)
│       └── utils/            # DOM helpers, formatting, validation
├── *.html                   # HTML pages (10 total)
├── vite.config.js           # Vite build configuration
├── package.json
└── README.md
```

## Setup

```bash
# Install dependencies
npm install

# Start development server
npm run dev

# Production build
npm run build

# Preview production build
npm run preview
```

## Build Output

The `dist/` directory contains a fully self-hosted static site:

```
dist/
├── *.html                   # All 10 HTML pages
├── assets/
│   ├── css/                 # Bundled CSS (hash-named)
│   ├── js/                  # Bundled JS modules (hash-named)
│   └── images/              # Optimized images
├── data/                    # All datasets (JSON + legacy JS)
├── images/                  # Archive images
├── ads.txt, robots.txt, sitemap.xml
└── licenses/, static/
```

## Validation

```bash
# Validate all JSON datasets
npm run validate:json

# Validate image references
npm run validate:images

# Full validation
npm run validate:all
```

## Data Pipeline

Legacy `.js` data files → JSON conversion → validated → served from `dist/data/`

Data source mapping is configured in `src/config/site.js` (`DATA_SOURCES`).

## Deployment

See [DEPLOYMENT_GUIDE.md](./docs/deployment/DEPLOYMENT_GUIDE.md) for platform-specific instructions (Netlify, Vercel, Cloudflare Pages, GitHub Pages).

```bash
# Full production build
npm run build

# Preview locally
npx serve dist
```

## Key Design Decisions

- **Incremental migration**: Original HTML pages remain untouched. New modular architecture runs in parallel.
- **No framework**: Vanilla JS, CSS custom properties, Vite for bundling only.
- **Archival identity**: Dark museum aesthetic, aged paper textures, typewriter typography.
- **Self-contained**: No external dependencies at runtime. All fonts, images, and data are local.
- **Accessibility**: Keyboard navigation, focus management, reduced motion support, ARIA labels.
- **Multi-strategy data loading**: JSON files preferred, fallback to legacy JS files, then inline script tags.

## Documentation

| File                                                                      | Purpose                                                                                                        |
| ------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| [ARCHITECTURE.md](./docs/architecture/ARCHITECTURE.md)                   | Full architecture reference — folder structure, CSS/JS modules, data flow, build pipeline                      |
| [PROJECT_STATE.md](./docs/project/PROJECT_STATE.md)                     | Current architecture status, completed phases, production readiness                                            |
| [MIGRATION_PROGRESS.md](./docs/restoration/MIGRATION_PROGRESS.md)       | Migration tracking, task lists, risk assessment for each phase                                                 |
| [KNOWN_ISSUES.md](./docs/project/KNOWN_ISSUES.md)                       | Project-wide issues — critical, major, minor, deployment warnings                                              |
| [MISSING_ASSETS.md](./docs/restoration/MISSING_ASSETS.md)               | **Missing image inventory** — 29 references across 12 source files, with line numbers and restoration priority |

## Asset Restoration

Before sourcing images, review [MISSING_ASSETS.md](./docs/restoration/MISSING_ASSETS.md) for the complete inventory. Restoration guidelines:

1. **Never auto-remove references** — missing asset references are intentional and should be preserved
2. **Never replace with fake/placeholder content** — only restore with authentic historical materials
3. **Verify licensing** — all new images must be public domain or CC-licensed
4. **Preserve attribution** — when images are added, ensure credit/license blocks are present
5. **Test after each restoration** — verify no layout shifts, broken states, or missing alts

### Quick Command Reference

```bash
npm run dev              # Start dev server (port 3000)
npm run build            # Full production build
npm run preview          # Preview production build
npm run validate:json    # Validate all JSON data files
npm run validate:images  # Check all image references
npm run validate:all     # Full validation suite
node scripts/find-missing-assets.mjs  # Generate updated MISSING_ASSETS.md
node scripts/audit.mjs                # Full project integrity audit
```

## Known Issues

- Hero background images (`images/background-hero/*.png`) need content sourcing
- Some battle and technology images referenced in data files are not yet sourced
- Original HTML pages use inline styles (no Tailwind removal yet)
- See [KNOWN_ISSUES.md](./docs/project/KNOWN_ISSUES.md) and [MISSING_ASSETS.md](./docs/restoration/MISSING_ASSETS.md) for complete listings
