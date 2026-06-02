# ASSET RESTORATION MAP — VeteranLedger

> **Generated**: 2026-05-23  
> **Last updated**: 2026-05-23 (CSS resilience layer appended)  
> **Total missing assets**: 15 unique files, 29 cross-references  
> **Purpose**: Restoration-ready manifest for staged asset acquisition and placement  
> **Prerequisite**: Security classification and licensing verification before any restoration

---

## How to Use This Map

This document is the authoritative guide for restoring missing images. Each asset is categorized
by priority, with exact file paths, source references, and archival specifications.

### Restoration Process

```
1. Source image from archival repository (Wikimedia Commons, Bundesarchiv, public domain)
2. Verify licensing (CC-BY-SA, public domain, or similarly permissive)
3. Save to the exact path specified in "Expected Directory"
4. Match the filename EXACTLY (case-sensitive)
5. Update attribution in data files if needed
6. Test on dev server: npm run dev
7. Verify layout stability, no broken states
8. Mark as restored in this document
9. Re-run: node scripts/find-missing-assets.mjs
```

---

## Priority P0 — Hero Backgrounds (8)

### Restoration Notes

- All 8 have CSS `background-color` fallback on the hero container
- No JS onerror needed — `<img>` inside hero has parent with background
- Safe to restore at any time without additional fallback work
- Recommended aspect ratio: 16∶9 landscape, 1920×1080px or larger
- Recommend consistent PNG format across all 8

| #   | Filename                         | Expected Path                                           | Referenced By          | Dimensions  | Format |
| --- | -------------------------------- | ------------------------------------------------------- | ---------------------- | ----------- | ------ |
| 1   | `articles-hero-background.png`   | `images/background-hero/articles-hero-background.png`   | `articles.html:1229`   | ≥1920×800px | PNG    |
| 2   | `battles-hero-background.png`    | `images/background-hero/battles-hero-background.png`    | `battles.html:1391`    | ≥1920×800px | PNG    |
| 3   | `home-hero-background.png`       | `images/background-hero/home-hero-background.png`       | `index.html:1371`      | ≥1920×800px | PNG    |
| 4   | `letters-hero-background.png`    | `images/background-hero/letters-hero-background.png`    | `letters.html:1415`    | ≥1920×800px | PNG    |
| 5   | `nsdap-hero-background.png`      | `images/background-hero/nsdap-hero-background.png`      | `political.html:1219`  | ≥1920×800px | PNG    |
| 6   | `Technology-hero-background.png` | `images/background-hero/Technology-hero-background.png` | `technology.html:1412` | ≥1920×800px | PNG    |
| 7   | `timeline-hero-background.png`   | `images/background-hero/timeline-hero-background.png`   | `timeline.html:1192`   | ≥1920×800px | PNG    |
| 8   | `veterans-hero-background.png`   | `images/background-hero/veterans-hero-background.png`   | `veterans.html:1367`   | ≥1920×800px | PNG    |

### Hero Image Technical Specifications

| Property          | Value                                                          |
| ----------------- | -------------------------------------------------------------- |
| Aspect ratio      | ~2.4∶1 (landscape, 1920×800)                                   |
| CSS rendering     | `object-fit: cover`, `mix-blend-mode: multiply`                |
| Overlay           | Linear gradient 145°, 45% opacity darkens image                |
| Dark mode         | Overlay switches to darker variant (65% opacity)               |
| Text              | Title/subtitle overlaid with `backdrop-filter: blur(1px)`      |
| Fallback          | Hero container has `background-color: var(--doc-bg-secondary)` |
| Naming convention | `{page-name}-hero-background.png` (lowercase, hyphens)         |

---

## Priority P1 — Battle Images (2)

### Restoration Notes

- 1 has no fallback in data files — will show broken `alt` text in JSON/JS access
- HTML pages have `onerror` SVG title fallback (green/brown archival tones)
- After restoration, verify both the HTML card rendering and modal overlay
- Recommended aspect ratio: 16∶9 landscape for battle photographs

| #   | Filename                           | Expected Path                                          | Referenced By                  | Fallback Status                 |
| --- | ---------------------------------- | ------------------------------------------------------ | ------------------------------ | ------------------------------- |
| 1   | `Battle-of-France-(Fall Gelb).jpg` | `images/battels/1940/Battle-of-France-(Fall Gelb).jpg` | `battles.html:1615`            | ✅ CSS bg fallback on container |
|     |                                    |                                                        | `data\battles.js:56`           | ⚠️ No fallback                  |
|     |                                    |                                                        | `public\data\battles.json:69`  | ⚠️ No fallback                  |
| 2   | `operation-steiner.png`            | `images/battels/1945/operation-steiner.png`            | `battles.html:1830`            | ✅ CSS bg fallback on container |
|     |                                    |                                                        | `data\battles.js:271`          | ⚠️ No fallback                  |
|     |                                    |                                                        | `public\data\battles.json:330` | ⚠️ No fallback                  |

### Battle Image Technical Specifications

| Property           | Value                                                                           |
| ------------------ | ------------------------------------------------------------------------------- |
| Aspect ratio       | 16∶9 (recommended)                                                              |
| HTML rendering     | `object-fit: cover` in card, `object-fit: contain` in modal                     |
| HTML fallback      | SVG placeholder with title text, archival colors (`#5F5345` bg, `#F2E8DA` text) |
| Data file fallback | None — `onerror` not applied in JS/JSON data access layer                       |

### Naming Convention for Battle Images

```
images/battels/{year}/{Battle-Name}.{ext}
  - Year directory: 1939, 1940, 1941, 1942, 1943, 1944, 1945
  - Filename: Capitalized, hyphens for spaces, parentheses for alternate names
  - Extension: .jpg for photographs, .png for illustrations/maps
```

---

## Priority P1 — Technology Images (5)

### Restoration Notes

- All 5 referenced in both `data/weapons.js` and `public/data/weapons.json` (no fallback)
- Also referenced in `technology.html` (has inline CSS bg fallback on container)
- 9 other technology images exist in the directory — match their format conventions
- Recommended aspect ratio: 4∶3 for equipment, 16∶9 for large vehicles

| #   | Filename                       | Expected Path                                    | Referenced By                  | Fallback Status                 |
| --- | ------------------------------ | ------------------------------------------------ | ------------------------------ | ------------------------------- |
| 1   | `Die-Glocke-(The Bell).png`    | `images/technology/Die-Glocke-(The Bell).png`    | `data\weapons.js:263`          | ⚠️ No fallback                  |
|     |                                |                                                  | `public\data\weapons.json:262` | ⚠️ No fallback                  |
|     |                                |                                                  | `technology.html:1844`         | ✅ CSS bg fallback on container |
| 2   | `Amerika-Rakete.png`           | `images/technology/Amerika-Rakete.png`           | `data\weapons.js:355`          | ⚠️ No fallback                  |
|     |                                |                                                  | `public\data\weapons.json:354` | ⚠️ No fallback                  |
|     |                                |                                                  | `technology.html:1936`         | ✅ CSS bg fallback on container |
| 3   | `Landkreuzer-P-1000-Ratte.png` | `images/technology/Landkreuzer-P-1000-Ratte.png` | `data\weapons.js:424`          | ⚠️ No fallback                  |
|     |                                |                                                  | `public\data\weapons.json:423` | ⚠️ No fallback                  |
|     |                                |                                                  | `technology.html:2005`         | ✅ CSS bg fallback on container |
| 4   | `MP-40.png`                    | `images/technology/MP-40.png`                    | `data\weapons.js:447`          | ⚠️ No fallback                  |
|     |                                |                                                  | `public\data\weapons.json:446` | ⚠️ No fallback                  |
|     |                                |                                                  | `technology.html:2028`         | ✅ CSS bg fallback on container |
| 5   | `Heinkel-He-111.jpg`           | `images/technology/Heinkel-He-111.jpg`           | `data\weapons.js:587`          | ⚠️ No fallback                  |
|     |                                |                                                  | `public\data\weapons.json:586` | ⚠️ No fallback                  |
|     |                                |                                                  | `technology.html:2168`         | ✅ CSS bg fallback on container |

### Technology Image Technical Specifications

| Property           | Value                                                                      |
| ------------------ | -------------------------------------------------------------------------- |
| Aspect ratio       | 4∶3 equipment, 16∶9 vehicles (recommended)                                 |
| HTML rendering     | `object-fit: cover` in card grid                                           |
| HTML fallback      | `placeholder.com` URL (external) — should be replaced with archival inline |
| Data file fallback | None — `onerror` not applied in JS/JSON data access layer                  |

### Naming Convention for Technology Images

```
images/technology/{Item-Name}.{ext}
  - Filename: Capitalized, hyphens for spaces, parentheses for alternate names
  - Extension: .png preferred for consistency (most existing are PNG)
```

---

## Existing Image Inventory (17 images — do not modify)

For reference, these images already exist and should not be moved or renamed:

### `images/ui/` (3)

| File                    | Format | Role                        |
| ----------------------- | ------ | --------------------------- |
| `logo-web-site.png`     | PNG    | Site logo, primary branding |
| `placeholder-cards.png` | PNG    | Card placeholder graphic    |
| `telegram-icon.png`     | PNG    | Telegram social link icon   |

### `images/technology/` (9 existing)

| File                         | Status     |
| ---------------------------- | ---------- |
| `Nebelwerfer.png`            | ✅ Present |
| `Panzerfaust.png`            | ✅ Present |
| `Panzerschreck.png`          | ✅ Present |
| `Schwerer-Gustav.png`        | ✅ Present |
| `SdKfz-251-Wurfrahmen.png`   | ✅ Present |
| `SdKfz-4-1-Panzerwerfer.png` | ✅ Present |
| `Sonnengewehr-(Sun-Gun).png` | ✅ Present |
| `UFOs-Haunebu-V.png`         | ✅ Present |
| `V-3-Supergun.png`           | ✅ Present |

### `images/veterans/` (5)

| File                               | Branch       | Size  | Status                    |
| ---------------------------------- | ------------ | ----- | ------------------------- |
| `kriegsmarine/Erich_Topp.jpg`      | Kriegsmarine | 26KB  | ✅                        |
| `kriegsmarine/Friedrich-Ruge.jpg`  | Kriegsmarine | 69KB  | ✅                        |
| `kriegsmarine/Hubert-Schmundt.jpg` | Kriegsmarine | 44KB  | ✅                        |
| `luftwaffe/Helmut_Lent.jpg`        | Luftwaffe    | 103KB | ✅                        |
| `luftwaffe/Hermann_Göring.jpg`     | Luftwaffe    | 1.4MB | ✅ (consider compressing) |

---

## Directory Structure Requirement

Before restoration, verify these directory paths exist. Create if missing:

```
images/
├── background-hero/     ← EXISTS (empty)
├── battels/
│   ├── 1940/           ← EXISTS (empty)
│   └── 1945/           ← EXISTS (empty)
├── technology/          ← EXISTS (9 files present)
├── ui/                  ← EXISTS (3 files)
└── veterans/
    ├── kriegsmarine/    ← EXISTS (3 files)
    └── luftwaffe/       ← EXISTS (2 files)
```

---

## Fallback Safety Assessment

| Fallback Type                                                 | Count         | Status                                                                                                  |
| ------------------------------------------------------------- | ------------- | ------------------------------------------------------------------------------------------------------- |
| CSS `background-color` on hero container                      | 8 references  | ✅ Safe — contained within hero element, no layout shift                                                |
| CSS `background` on card container                            | 16 references | ✅ Safe — containment via `aspect-ratio` + `overflow: hidden`                                           |
| SVG `onerror` placeholder (HTML inline)                       | 8 references  | ✅ Safe — archival colors, text-based fallback                                                          |
| External URL onerror (placeholder.com)                        | 5 references  | ⚠️ Replace with local SVG — external dependency                                                         |
| No fallback (JS/JSON data layer)                              | 14 references | ⚠️ Image will show broken state if accessed programmatically                                            |
| Modular CSS resilience layer (`src/css/components/cards.css`) | All images    | ✅ `archival-image-container` with `aspect-ratio`, broken-icon hiding, monogram initials, hatch pattern |

### Image Resilience Layer (Added 2026-05-23)

A comprehensive CSS fallback layer was appended to `src/css/components/cards.css` covering:

| CSS Class / Selector                        | Coverage                              | Behavior                                                                           |
| ------------------------------------------- | ------------------------------------- | ---------------------------------------------------------------------------------- |
| `.archival-image-container`                 | All modular card images               | `aspect-ratio: 4/3`, `overflow: hidden`, `background: var(--doc-bg-secondary)`     |
| `.archival-image-container img:-moz-broken` | All browsers with broken image states | `opacity: 0` — hides broken icon, shows container background                       |
| `.archival-image-container img:not([src])`  | Images with empty/missing src         | `opacity: 0` — graceful degradation                                                |
| `.image-fallback-initials`                  | JS onerror monogram placeholders      | `font-family: var(--font-typewriter)`, `color: var(--doc-text-muted)`, 50% opacity |
| `.image-fallback-pattern`                   | Decorative archival hatch             | 45° repeating gradient, `rgba(127,110,90,0.04)`                                    |
| `.archival-image-container.portrait`        | Portrait images (veterans)            | `aspect-ratio: 3/4`                                                                |
| `.archival-image-container.overlay`         | Modal/overlay images                  | `aspect-ratio: 16/9`, `max-height: 60vh`                                           |
| `.veteran-image`                            | Inline HTML veteran cards             | `aspect-ratio: 3/4`, hide broken, `min-height: 200px`                              |
| `.weapon-image`                             | Inline HTML weapon cards              | `aspect-ratio: 4/3`, hide broken, `min-height: 150px`                              |
| `.battle-image`                             | Inline HTML battle cards              | `aspect-ratio: 16/9`, hide broken, `min-height: 150px`                             |
| `.panel-image`, `.overlay-image`            | Modal/panel images                    | `object-fit: contain`, `max-height: 60vh`, hide broken                             |
| `img[loading="lazy"]`                       | Lazy-loaded images                    | `opacity: 0` → `opacity: 1` with 0.3s fade-in                                      |
| `@media (max-width: 768px)`                 | Mobile responsive                     | Container flips to `16/9`, portraits to `4/5`                                      |
| `@media print`                              | Print output                          | Fallback decorations hidden, images in static flow                                 |

### Recommendations for Unguarded References

For the 14 JS/JSON data file references with no fallback:

1. **Do NOT modify data files** — they are the authoritative source and should be preserved
2. **The HTML rendering layer** (`battles.html`, `technology.html`, `veterans.html` inline scripts)
   already wraps images with `onerror` — this is the correct level for fallback handling
3. **The modular JS** (`src/js/pages/*.js`) should apply `onerror` when creating `<img>` elements
4. **Priority**: Address when Phase 2 (HTML Integration) links modular JS to pages

---

## Restoration Verification Checklist

After adding each asset:

- [ ] File exists at exact path (case-sensitive)
- [ ] `node scripts/find-missing-assets.mjs` shows reduced count
- [ ] `npm run dev` — image loads in browser on all affected pages
- [ ] Card layout does not shift (dimensions preserved)
- [ ] Modal/overlay shows image correctly
- [ ] Dark mode: image visible with correct overlay
- [ ] Mobile: image responsive (check smallest viewport)
- [ ] Attribution: credit line present if required by license
- [ ] Alt text: informative description (not just filename)
- [ ] Licensing: document source URL in project notes

### Verification Command

```bash
# After each restoration:
node scripts/find-missing-assets.mjs    # Re-generate report
npm run build                           # Re-build with new asset
npm run preview                         # Manual visual check
```

---

## Licensing Notes

All external Wikimedia Commons URLs used throughout the project are CC-BY-SA or public domain.
When sourcing replacement images, ensure they meet the same standard:

| Source               | Typical License         | Acceptable?  |
| -------------------- | ----------------------- | ------------ |
| Wikimedia Commons    | CC-BY-SA, Public Domain | ✅           |
| Bundesarchiv         | CC-BY-SA 3.0 DE         | ✅           |
| US National Archives | Public Domain           | ✅           |
| Flickr Commons       | No known copyright      | ✅ (verify)  |
| Getty Images         | All rights reserved     | ❌           |
| Wikipedia fair use   | Varies                  | ⚠️ (consult) |

### Attribution Format

```
<div class="image-credit">
  Source: <a href="{url}" target="_blank" rel="noopener">{source name}</a>
  — {license}
</div>
```

---

## Restoration Log

| Date | Asset | Restored By | Notes |
| ---- | ----- | ----------- | ----- |
| —    | —     | —           | —     |

_Use this table to track restoration progress. Add a row for each restored asset._

---

_This document is the authoritative restoration manifest. Update it whenever assets are added or when new missing assets are discovered. Re-run `node scripts/find-missing-assets.mjs` after any changes to keep the audit current._
