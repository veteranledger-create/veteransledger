# License & Attribution Guide — VeteranLedger

> **Date**: 2026-05-23  
> **Purpose**: Document all license types used in the archive, how attribution is formatted, and reuser guidance

---

## License Types Used

### 1. Public Domain
**Markers used**: `Public Domain`, `PD`
**Source examples**: Wikimedia Commons, U.S. government works
**Usage rights**: Free for any purpose; attribution recommended but not required
**Attribution format**:
```
Source: [Repository] — Public Domain
```

### 2. Creative Commons Attribution-ShareAlike 3.0
**Markers used**: `CC BY-SA 3.0`, `CC-BY-SA 3.0 DE`
**Source examples**: Bundesarchiv, individual photographers
**Usage rights**: Share and adapt with attribution; share-alike if redistributed
**Attribution format**:
```
Source: [Repository], [Image ID] / CC-BY-SA 3.0 [jurisdiction]
License: https://creativecommons.org/licenses/by-sa/3.0/[jurisdiction]/
```

### 3. Creative Commons Attribution-ShareAlike 4.0
**Markers used**: `CC BY-SA 4.0`
**Source examples**: Wikimedia Commons contributors
**Usage rights**: Share and adapt with attribution; share-alike if redistributed
**Attribution format**:
```
Source: [Repository] / CC BY-SA 4.0
License: https://creativecommons.org/licenses/by-sa/4.0/
```

### 4. Fair Use (Educational)
**Markers used**: `Fair Use — Educational Purpose`
**Usage rights**: Limited use for criticism, comment, news reporting, teaching, scholarship, or research
**Context**: Used only when public domain or openly licensed alternatives are unavailable

---

## Attribution Component Structure

### Component: `archival-attribution`

```html
<div class="archival-attribution">
  <!-- 1. Caption (optional, historical context) -->
  <p class="attr-caption">
    Tiger I tank in Northern France, 1943-1944.
  </p>

  <!-- 2. Metadata (compact source summary) -->
  <div class="attr-metadata">
    <span class="attr-metadata-label">Source</span>
    <span class="attr-metadata-source">Bundesarchiv, Bild 101I-299-1805-16</span>
    <span class="attr-metadata-license">CC-BY-SA 3.0 DE</span>
  </div>

  <!-- 3. Expandable license details (collapsible <details>) -->
  <details class="attr-details">
    <summary>License Details</summary>
    <div class="attr-details-content">
      <strong>Source:</strong> Bundesarchiv, Bild 101I-299-1805-16<br/>
      <strong>License:</strong> Creative Commons Attribution-ShareAlike 3.0 Germany<br/>
      <strong>URL:</strong> <a href="https://creativecommons.org/licenses/by-sa/3.0/de/">https://creativecommons.org/licenses/by-sa/3.0/de/</a><br/>
      <strong>Credit:</strong> Bundesarchiv / CC-BY-SA 3.0 DE
    </div>
  </details>
</div>
```

### Variants

| Variant | Class | Use Case |
|---------|-------|----------|
| Default | `.archival-attribution` | Standard image blocks |
| Compact | `.archival-attribution.compact` | Card grids, tight spaces |
| Inline | `.archival-attribution.inline` | Single-line attribution |
| Overlay | `.archival-attribution.overlay` | Modal/lightbox attribution |

---

## Expected Attribution Formats By Source

### Bundesarchiv (most common)
```
Source: Bundesarchiv, [Image ID] / CC-BY-SA 3.0 DE
License: https://creativecommons.org/licenses/by-sa/3.0/de/
```

### Wikimedia Commons
```
Source: Wikimedia Commons — Public Domain
```
or
```
Source: Wikimedia Commons / CC BY-SA 4.0
```

### AI Reconstruction
```
Source: AI-assisted archival reconstruction
License: Original creation — no third-party licensing
Caption: Visual reconstruction — no authentic photograph known to exist
```

---

## Reuser Guidance

If you wish to reuse content from VeteranLedger:

1. **Original text content** (analysis, descriptions, biography): Free for non-commercial educational use with attribution to VeteranLedger
2. **Third-party images**: Must comply with the original license specified in the attribution for each image
3. **AI-generated images**: Free for use as original creations; no third-party license applies
4. **Archival photographs from Bundesarchiv**: Must include `Bundesarchiv / CC-BY-SA 3.0 DE` credit line
5. **Public Domain works**: No license restrictions; attribution appreciated

---

## License Violation Response

If you believe an attribution is incorrect or a license is violated:
1. Check the `removal-requests.html` process
2. Provide the specific image URL and the correct attribution/license
3. We will investigate and correct within 10 business days

---

## Aggregated Credit Data Sources

| Source | Count (approx.) | License |
|--------|----------------|---------|
| Bundesarchiv | ~80 images | CC BY-SA 3.0 DE |
| Wikimedia Commons | ~200 images | Mixed (PD, CC BY-SA) |
| AI reconstructions | ~15 images | Original creation |
| Other archives | ~10 images | Various |
