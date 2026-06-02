# Legal Compliance Framework — VeteranLedger

> **Date**: 2026-05-23  
> **Status**: Complete  
> **Scope**: Privacy, terms, transparency, cookie notice, removal process

---

## Overview

The VeteranLedger Legal Compliance Layer provides minimal, non-intrusive legal documentation consistent with the project's archival documentary atmosphere. The design philosophy avoids corporate legal-tech UI, aggressive consent walls, and full-screen blockers while maintaining full legal clarity and user trust.

---

## Pages Created

| Page | Purpose | Status |
|------|---------|--------|
| `privacy-policy.html` | No-data-collection privacy policy | ✅ |
| `terms.html` | Educational use terms & conditions | ✅ |
| `archive-disclaimer.html` | Content warning, ethical framing | ✅ |
| `transparency-policy.html` | AI imagery disclosure, sourcing methodology | ✅ |
| `removal-requests.html` | Copyright/privacy removal process | ✅ |

All pages share:
- Consistent archival styling (typewriter typography, muted palette)
- `navbar-placeholder` + `footer-placeholder` integration
- Standard `<main class="legal-page">` layout container
- Static HTML — no JavaScript required for display

---

## Cookie Notice

| Feature | Status | Details |
|---------|--------|---------|
| Bottom banner | ✅ | Fixed position, non-blocking |
| Dismissible | ✅ | Button click or Escape key |
| localStorage persistence | ✅ | 1-year expiry |
| Keyboard accessible | ✅ | `role="dialog"`, `aria-label`, focus management |
| Reduced motion | ✅ | `prefers-reduced-motion` respected |
| Print hidden | ✅ | `@media print { display: none }` |
| Archival aesthetic | ✅ | Typewriter font, muted colors, no glossy UI |

### Implementation

**File**: `src/js/components/cookie-notice.js`
- Created dynamically so it works across all pages
- Dismissed state stored in localStorage with timestamp
- Automatically focuses dismiss button on mount
- Cleanly removes itself from DOM after transition

### Usage
```javascript
import { initCookieNotice } from '/src/js/components/cookie-notice.js';
initCookieNotice();
```

---

## Footer Legal Navigation

Added to all 8 content pages (`index.html`, `battles.html`, `veterans.html`, etc.):

| Link | Target |
|------|--------|
| Privacy Policy | `privacy-policy.html` |
| Terms of Use | `terms.html` |
| Archive Disclaimer | `archive-disclaimer.html` |
| Transparency | `transparency-policy.html` |
| Image Attribution | `credits.html` |
| Sources & Licensing | `credits.html` |
| Removal Requests | `removal-requests.html` |

**CSS**: `src/css/layout/footer.css` — `.footer-legal-nav`
- Responsive flex layout with wrapping
- Typewriter typography, dashes separators
- Hover/focus underlines
- Muted archival colors

---

## AI-Generated Imagery Disclosure

### Policy (in `transparency-policy.html`)

The transparency policy includes the required disclosure explaining:
- Some visuals may be AI-assisted reconstructions
- Authentic archival imagery is always preferred
- AI imagery is used only when:
  1. Public-domain material is unavailable
  2. Licensing restrictions prevent lawful reuse
  3. Redistribution rights were not granted
  4. Historical material is incomplete or missing
  5. Diagrammatic/technical clarity is needed

### Visual Identification

All AI-generated images are labeled with:
```html
<span class="attr-badge">AI Reconstruction</span>
```

This badge is styled as a compact archival footnote marker — uppercase typewriter, muted accent color, non-intrusive.

---

## Design Constraints Met

| Requirement | Implementation |
|-------------|---------------|
| No aggressive consent walls | Cookie notice is bottom banner, 3 lines, dismissible |
| No corporate legal-tech UI | Typewriter fonts, documentary styling throughout |
| No fullscreen blockers | All notices are inline or fixed-bottom only |
| No glossy startup styling | Muted sepia/parchment palette |
| Keyboard accessibility | Cookie notice: `role="dialog"`, focus management, Escape |
| Archival atmosphere | Consistent with existing `--font-typewriter` and `--doc-*` variables |

---

## Legal Text Principles

All legal pages follow these guidelines:
1. **Clear, plain language** — no legalese where plain English suffices
2. **Specific to this project** — not generic template text
3. **Honest about limitations** — acknowledges the project's scope
4. **Educational framing** — consistently reminds users of the documentary purpose
5. **Minimal but complete** — covers required disclosures without unnecessary bulk

---

## Maintenance

To add a new legal page:
1. Create `.html` in project root
2. Use `legal-page` class for main container
3. Include `navbar-placeholder` and `footer-placeholder`
4. Add link from `footer-legal-nav` in all pages
5. Rebuild: `npm run build`
