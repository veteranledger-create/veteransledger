# Deployment Guide — VeteranLedger

> **Version**: 1.0.0  
> **Build**: Static multi-page site via Vite  
> **Output**: `dist/` directory (fully self-contained)  

---

## Quick Deploy

```bash
npm install
npm run build
```

Then deploy the `dist/` directory to any static hosting provider.

---

## Platform-Specific Instructions

### Netlify

1. Connect your Git repository to [app.netlify.com](https://app.netlify.com)
2. Or deploy manually via CLI:

```bash
npm install -g netlify-cli
netlify deploy --prod --dir=dist
```

**Configuration**: `netlify.toml` (in project root)
- Build command: `npm run build`
- Publish directory: `dist`
- Node version: 20
- Cache headers for assets (1 year, immutable)
- No-SPA-revalidate for HTML pages
- Security headers (X-Content-Type-Options, X-Frame-Options, Referrer-Policy)

### Vercel

1. Connect your Git repository to [vercel.com](https://vercel.com)
2. Or deploy via CLI:

```bash
npm install -g vercel
vercel --prod
```

**Configuration**: `vercel.json` (in project root)
- Build command: `npm run build`
- Output directory: `dist`
- Framework: `null` (static site)
- Cache headers for `dist/assets/*` (1 year, immutable)
- No-SPA-revalidate for HTML pages

### Cloudflare Pages

1. Connect your Git repository to [pages.cloudflare.com](https://pages.cloudflare.com)
2. Configuration:
   - Build command: `npm run build`
   - Build output directory: `dist`
   - Node version: 20 (set in environment variables)

**Note**: Cloudflare reads `_headers` and `_redirects` files from the publish directory. These are included in the build output via `public/` directory.

### GitHub Pages

```bash
npm run build
# Deploy dist/ to gh-pages branch
npx gh-pages -d dist
```

Or configure in repo Settings → Pages → Source: GitHub Actions with:

```yaml
# .github/workflows/deploy.yml
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
          node-version: 20
      - run: npm ci && npm run build
      - uses: peaceiris/actions-gh-pages@v3
        with:
          github_token: ${{ secrets.GITHUB_TOKEN }}
          publish_dir: ./dist
```

### Any Static Server

```bash
npm run build
# Serve dist/ with any HTTP server
npx serve dist        # Local preview
```

---

## Build Output Structure

```
dist/
├── index.html                    # Home page
├── battles.html                  # Battles archive (421KB)
├── veterans.html                 # Veterans archive (494KB)
├── technology.html               # Technology archive (410KB)
├── articles.html                 # Articles archive (135KB)
├── political.html                # Political figures (103KB)
├── letters.html                  # Letters archive (85KB)
├── timeline.html                 # Timeline (62KB)
├── disclaimer.html               # Disclaimer (62KB)
├── credits.html                  # Image credits (14KB)
├── privacy-policy.html           # Privacy policy (10KB)
├── terms.html                    # Terms of use (10KB)
├── archive-disclaimer.html       # Archive disclaimer (11KB)
├── transparency-policy.html      # Transparency policy (13KB)
├── removal-requests.html         # Removal requests (11KB)
├── ads.txt                       # AdSense verification
├── robots.txt                    # Search engine rules
├── sitemap.xml                   # XML sitemap
├── assets/
│   ├── css/modal-[hash].css      # Bundled CSS (29KB)
│   ├── js/                       # Bundled JS modules (10 files)
│   └── images/                   # Optimized images
├── data/                         # All datasets (JSON + JS)
├── images/                       # Archive images
└── licenses/                     # License files
```

**Total**: ~21 MB deployed (2.1 MB after gzip for HTML/CSS/JS; images are the bulk)

---

## Post-Deploy Verification Checklist

### Page Rendering
- [ ] `index.html` — Hero, featured cards, footer load
- [ ] `battles.html` — Battle cards display, filter works
- [ ] `veterans.html` — Veteran cards display, search works
- [ ] `technology.html` — Weapon data loads, category filter works
- [ ] `articles.html` — Article topics load, tab navigation works
- [ ] `political.html` — Politician cards display, A-Z nav works
- [ ] `letters.html` — Letter entries render
- [ ] `timeline.html` — Timeline renders correctly

### Interactive Systems
- [ ] Overlay/lightbox opens on card click — all pages
- [ ] Previous/Next navigation within overlays
- [ ] Search filtering works (all pages with search)
- [ ] Category/tab filtering works
- [ ] Theme toggle (light/dark) persists across pages
- [ ] Mobile menu toggle opens/closes
- [ ] Back-to-top button appears on scroll
- [ ] Cookie notice appears on first visit, dismisses

### Legal Compliance
- [ ] Footer legal nav links work on all 8 content pages
- [ ] `privacy-policy.html` loads — no data collection disclosed
- [ ] `terms.html` loads — educational + CC licensing
- [ ] `archive-disclaimer.html` loads — content warnings
- [ ] `transparency-policy.html` loads — AI disclosure + sourcing
- [ ] `removal-requests.html` loads — removal process
- [ ] `credits.html` loads — image attribution + CC licenses

### Technical
- [ ] No 404 errors in browser console
- [ ] No JavaScript console errors
- [ ] All external resources load (Google Fonts, AdSense)
- [ ] HTTPS enforced by platform
- [ ] `robots.txt` accessible at `/robots.txt`
- [ ] `sitemap.xml` accessible at `/sitemap.xml`
- [ ] `ads.txt` accessible at `/ads.txt`

---

## Environment Variables

None required. The site is fully self-contained static HTML.

---

## Performance Notes

- **HTML files**: Large (60–500KB each) due to embedded historical content and inline data. Gzip reduces these to ~10-15% of original size on the wire.
- **CSS**: Single bundled file (~29KB, ~6KB gzipped)
- **JS**: 10 module files totaling ~28KB (~12KB gzipped)
- **Images**: Mission imagery varies from 30KB to 2.5MB. Consider lazy loading via `<img loading="lazy">` for below-the-fold images.
- All platforms (Netlify, Vercel, Cloudflare) provide automatic brotli/gzip compression and CDN distribution.

---

## Maintenance

```bash
npm run validate:all    # Validate all JSON data + image references
npm run build           # Full production rebuild
```

After content updates, rebuild and re-deploy the `dist/` directory.

---

## Rollback

All platforms support instant rollback:
- **Netlify**: Deploy log → click previous deploy
- **Vercel**: Instant rollback in dashboard
- **Cloudflare**: Version history in dashboard
