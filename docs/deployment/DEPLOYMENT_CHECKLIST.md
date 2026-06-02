# Deployment Checklist — VeteranLedger

> **Date**: 2026-05-23  
> **Target**: Static site deployment (GitHub Pages, Netlify, Vercel, or any static host)  
> **Prerequisites**: Node.js 18+, npm, Vite 8

---

## Pre-Deployment Verification

### 1. Build Verification
- [x] `npm run build` completes with 0 errors
- [x] All 16 post-build assets copied successfully
- [x] All 10 HTML pages present in `dist/`
- [x] CSS bundle compiles (27 KB, includes all modules + fallback layer)
- [x] JS modules code-split correctly (11 chunks)
- [x] JSON data files (6) copied to `dist/data/`

### 2. Structural Integrity
- [x] All internal navigation links point to existing pages
- [x] All HTML files have valid DOCTYPE (`<!DOCTYPE html>`)
- [x] All HTML files have matching `<html>` and `</html>` tags
- [x] All HTML files have matching `<body>` and `</body>` tags
- [x] All `<img>` elements have `alt` attributes (0 missing)
- [x] No broken CSS imports
- [x] No broken JS imports

### 3. Image Audit
- [x] 17 local images present in source
- [ ] **Optimize large images** (see PERFORMANCE_AUDIT.md §3)
- [ ] **Convert large PNGs to JPEG** (optional but recommended)
- [x] Missing image fallback layer verified in bundle
- [x] All external URLs use HTTPS

### 4. Runtime Validation
- [x] All JSON datasets valid (6/6)
- [x] CSS variable consistency check: passed
- [x] CSS selector audit: no unused fragment identifiers
- [x] Scroll locking implemented on all interactive pages
- [x] Modal opening/closing functional
- [x] Lazy loading applied to external content images
- [x] Theme toggle present on 9/10 pages

---

## Deployment Configuration

### Environment Variables
| Variable | Value | Purpose |
|----------|-------|---------|
| `NODE_VERSION` | 18+ | Build environment |
| `BASE` | `/` (or custom domain path) | Vite base path |

### Build Command
```bash
npm run build
```

If deploying to a **subdirectory** (e.g., `https://example.com/project/`):
```bash
npx vite build --base=/project/
```

### Output Directory
```
dist/              ← Root deployment directory
├── assets/
│   ├── css/modal-*.css
│   ├── js/*.js
│   └── images/logo-*.png
├── data/           ← JSON datasets
├── images/         ← Copied from public/images/
├── *.html          ← 10 pages
├── ads.txt
├── robots.txt
├── sitemap.xml
└── (other assets from public/)
```

### Preview Command
```bash
npm run preview    # Serves dist/ locally for final verification
```

---

## Platform-Specific Instructions

### GitHub Pages
```yaml
# .github/workflows/deploy.yml (if using GitHub Actions)
name: Deploy to GitHub Pages
on:
  push:
    branches: [main]
jobs:
  deploy:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 18
      - run: npm ci
      - run: npm run build
      - uses: peaceiris/actions-gh-pages@v3
        with:
          github_token: ${{ secrets.GITHUB_TOKEN }}
          publish_dir: ./dist
```
**Note**: If using GitHub Pages with a custom domain, add a `CNAME` file to `public/`.

### Netlify
```toml
# netlify.toml
[build]
  command = "npm run build"
  publish = "dist"

[[redirects]]
  from = "/*"
  to = "/index.html"
  status = 200
```

### Vercel
```json
// vercel.json
{
  "buildCommand": "npm run build",
  "outputDirectory": "dist",
  "framework": null,
  "rewrites": [
    { "source": "/(.*)", "destination": "/index.html" }
  ]
}
```

---

## Post-Deployment Validation

### 1. Functional Checks
- [ ] Open each page in browser
  - [ ] `index.html` — hero, featured cards, modals
  - [ ] `battles.html` — search, filter, grid
  - [ ] `veterans.html` — search, filter, cards
  - [ ] `technology.html` — weapon cards
  - [ ] `articles.html` — lazy-loading articles
  - [ ] `letters.html` — letter content
  - [ ] `political.html` — lightbox, image fallback
  - [ ] `timeline.html` — timeline content
  - [ ] `credits.html` — static credits
  - [ ] `disclaimer.html` — legal text
- [ ] Test navigation between all pages
- [ ] Test responsive behavior at 480px, 768px, 1024px
- [ ] Test theme toggle (light/dark mode)
- [ ] Test modal opening and closing
- [ ] Test scroll locking (open filter, scroll — body should not scroll)
- [ ] Test search/filter functionality on data pages
- [ ] Test lazy loading (scroll, images should fade in)
- [ ] Test missing image fallback (images with no src should show archival placeholder)

### 2. Browser Compatibility
| Browser | Status | Notes |
|---------|--------|-------|
| Chrome 120+ | ✅ | Full support |
| Firefox 120+ | ✅ | Full support; `:-moz-broken` pseudo-class used |
| Safari 17+ | ✅ | Full support |
| Edge 120+ | ✅ | Full support |
| IE11 | ❌ Not supported | No polyfills implemented |
| Mobile Safari | ✅ | Touch events supported |
| Mobile Chrome | ✅ | Touch events supported |

### 3. Performance Verification
- [ ] Run Lighthouse audit (targets):
  - [ ] Performance: ≥ 70
  - [ ] Accessibility: ≥ 80
  - [ ] Best Practices: ≥ 90
  - [ ] SEO: ≥ 90
- [ ] Verify gzip compression is enabled on host
- [ ] Verify cache headers set on static assets
- [ ] Verify no mixed content (all HTTPS)

### 4. SEO Verification
- [ ] `sitemap.xml` present and valid
- [ ] `robots.txt` present with correct rules
- [ ] Each page has a unique `<title>` tag
- [ ] Meta description tags present on key pages
- [ ] Open Graph tags present (if sharing to social media)
- [ ] `ads.txt` present and correctly configured

### 5. Legal & Compliance
- [ ] `disclaimer.html` visible and linked from all pages
- [ ] `credits.html` visible and linked from all pages
- [ ] All third-party images attributed with correct license
- [ ] External links open in new tab (`target="_blank"` with `rel="noopener"`)

---

## Fallback & Error Handling

### Missing Images
All 15 locally missing images have CSS fallback via `src/css/components/cards.css`:
- `aspect-ratio` preserved (no layout shift)
- Broken icon hidden (`opacity: 0`)
- Archival background + hatch pattern visible

### 404 Handling
For GitHub Pages, **add a `.nojekyll` file** to disable Jekyll processing:
```bash
touch public/.nojekyll
```

For SPA-style routing fallback, add a `404.html` file at the root of `public/`:
```html
<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <title>Page Not Found | VeteranLedger</title>
  <meta http-equiv="refresh" content="0; url=/" />
  <link rel="canonical" href="/" />
</head>
<body>
  <p>Page not found. <a href="/">Return home</a>.</p>
</body>
</html>
```

### JavaScript Disabled
All pages render content without JavaScript. Search/filter and modals are graceful enhancements.

---

## Release Checklist (Final)

### Before Deployment
- [ ] Run `npm run validate:json` — all 6 JSON files valid
- [ ] Run `node scripts/audit.mjs` — no code errors (15 content-image issues only)
- [ ] Run `node scripts/find-missing-assets.mjs` — 29 references; all have fallbacks
- [ ] Run `npm run build` — 0 errors
- [ ] Run `npm run preview` — manual visual check

### Deployment
- [ ] Choose deployment platform (GitHub Pages / Netlify / Vercel)
- [ ] Configure build command: `npm run build`
- [ ] Set output directory: `dist`
- [ ] Set Node version: 18+
- [ ] Deploy

### Post-Deployment
- [ ] Verify all pages load at production URL
- [ ] Test on mobile device
- [ ] Test dark mode on production
- [ ] Verify sitemap and robots.txt accessible
- [ ] Run production Lighthouse audit
- [ ] Verify analytics (if configured)
- [ ] Verify no console errors in production

---

## Known Issues Before Deployment

| Issue | Impact | Workaround |
|-------|--------|-----------|
| 15 missing local images | Low — all have CSS fallbacks | None needed; create placeholder images if desired |
| 283 external image URLs | Medium — dependency on Wikimedia CDN | Assets still work with fallbacks if CDN is down |
| No 404.html | Low — GitHub Pages default 404 used | Add `public/404.html` for consistent experience |
| Image sizes > 1 MB | Medium — slower page load | Compress before deployment (recommended) |

---

*This checklist should be reviewed on each deployment. Update paths and URLs for the target environment.*
