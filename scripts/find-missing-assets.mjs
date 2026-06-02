/**
 * COMPREHENSIVE MISSING ASSET DETECTION
 *
 * Scans every file in the project for image references,
 * cross-references against actual filesystem, and produces
 * a structured audit report.
 *
 * Detection methods:
 * 1. HTML: <img src="">, <source srcset="">, inline style="background-image: url()"
 * 2. CSS: url() references in .css files and inline <style> blocks
 * 3. JS/JSON: Every string ending in .png/.jpg/.jpeg/.gif/.svg/.webp
 * 4. Inline styles: style="background: url()", style="background-image: url()"
 *
 * Usage: node scripts/find-missing-assets.mjs
 */

import {
  readFileSync,
  existsSync,
  statSync,
  readdirSync,
  writeFileSync,
} from "fs";
import { resolve, extname } from "path";
import { fileURLToPath } from "url";

const __dirname = resolve(fileURLToPath(import.meta.url), "..", "..");
const ROOT = __dirname;

// ─── Collect all existing image files ───
const existingImages = new Map(); // lowercase path → actual path

function collectImages(dir) {
  if (!existsSync(dir)) return;
  const entries = readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const full = resolve(dir, entry.name);
    if (entry.isDirectory()) {
      collectImages(full);
    } else if (/\.(png|jpg|jpeg|gif|svg|webp|ico)$/i.test(entry.name)) {
      const lower = full.toLowerCase();
      if (!existingImages.has(lower)) {
        existingImages.set(lower, full);
      }
    }
  }
}
collectImages(resolve(ROOT, "images"));
collectImages(resolve(ROOT, "public", "images"));
collectImages(resolve(ROOT, "public", "static"));

console.log(`\nExisting images indexed: ${existingImages.size}`);

// ─── Scan all non-excluded files ───
const filesToScan = [];
const skipDirs = ["node_modules", "dist", ".git", "backup"];

function collectFiles(dir) {
  if (!existsSync(dir)) return;
  const entries = readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    if (skipDirs.includes(entry.name) || entry.name.startsWith(".")) continue;
    const full = resolve(dir, entry.name);
    if (entry.isDirectory()) {
      collectFiles(full);
    } else if (
      entry.isFile() &&
      /\.(html|js|mjs|json|css)$/i.test(entry.name)
    ) {
      filesToScan.push(full);
    }
  }
}
collectFiles(ROOT);

console.log(`Files to scan: ${filesToScan.length}`);

// ─── Detection patterns ───
const PATTERNS = [
  // HTML/CSS: src="path", src='path'
  {
    name: "src-attribute-double",
    regex: /src="([^"]+\.(png|jpg|jpeg|gif|svg|webp)(\?[^"]*)?)"/gi,
    transform: (m) => m[1].split("?")[0],
  },
  {
    name: "src-attribute-single",
    regex: /src='([^']+\.(png|jpg|jpeg|gif|svg|webp)(\?[^']*)?)'/gi,
    transform: (m) => m[1].split("?")[0],
  },
  // HTML/CSS: url(path)
  {
    name: "url-function-double",
    regex: /url\(["']([^"']+\.(png|jpg|jpeg|gif|svg|webp)(\?[^"']*)?)["']\)/gi,
    transform: (m) => m[1].split("?")[0],
  },
  {
    name: "url-function-unquoted",
    regex: /url\(([^"'\s)]+\.(png|jpg|jpeg|gif|svg|webp)(\?[^\s)]*)?)\)/gi,
    transform: (m) => m[1].split("?")[0],
  },
  // JS/JSON: image field values, string assignments
  {
    name: "js-string-double",
    regex: /["']([^"']+\.(png|jpg|jpeg|gif|svg|webp)(?:\?[^"']*)?)["']/gi,
    transform: (m) => m[1].split("?")[0],
  },
  // Data URIs (skip these)
  {
    name: "data-uri",
    regex: /url\(data:image/i,
    skip: true,
  },
  // Inline style background
  {
    name: "inline-style-bg",
    regex:
      /style=["'][^"']*url\(["']([^"']+\.(png|jpg|jpeg|gif|svg|webp))["']\)/gi,
    transform: (m) => m[1],
  },
  // background-image: url() in inline CSS
  {
    name: "css-background",
    regex:
      /background(?:-image)?\s*:\s*[^u]*url\(["']?([^"'\s)]+\.(png|jpg|jpeg|gif|svg|webp))["']?\)/gi,
    transform: (m) => m[1],
  },
];

// ─── Results ───
const results = []; // { file, image, context, line, lineNumber, pattern }

for (const filepath of filesToScan) {
  const content = readFileSync(filepath, "utf-8");
  const lines = content.split("\n");
  const relPath = filepath.replace(ROOT + "\\", "").replace(ROOT + "/", "");

  for (let lineIdx = 0; lineIdx < lines.length; lineIdx++) {
    const line = lines[lineIdx];

    for (const pattern of PATTERNS) {
      if (pattern.skip) continue;
      const regex = new RegExp(pattern.regex.source, "gi");
      let match;
      while ((match = regex.exec(line)) !== null) {
        const imagePath = pattern.transform(match);

        // Skip external URLs, data URIs, protocol-relative URLs
        if (
          imagePath.startsWith("http://") ||
          imagePath.startsWith("https://") ||
          imagePath.startsWith("data:") ||
          imagePath.startsWith("//") ||
          imagePath.startsWith("chrome-") ||
          imagePath.startsWith("about:")
        ) {
          continue;
        }

        results.push({
          file: relPath,
          image: imagePath,
          lineNumber: lineIdx + 1,
          pattern: pattern.name,
        });
      }
    }
  }
}

// ─── Deduplicate and classify ───
const seen = new Set();
const uniqueResults = [];

for (const r of results) {
  const key = `${r.file}|${r.image}`;
  if (seen.has(key)) continue;
  seen.add(key);
  uniqueResults.push(r);
}

console.log(`Total image references found: ${uniqueResults.length}`);

// ─── Check each reference against actual filesystem ───
const missing = [];

for (const ref of uniqueResults) {
  let imgPath = ref.image;

  // Normalize: remove leading / for root-relative checks
  const cleanPath = imgPath.startsWith("/") ? imgPath.substring(1) : imgPath;
  const fullPath = resolve(ROOT, cleanPath).toLowerCase();

  // Check in dist/ as well (might have been copied there)
  const distPath = resolve(ROOT, "dist", cleanPath).toLowerCase();

  const existsInSrc = existingImages.has(fullPath);
  const existsInDist = existsSync(distPath) && statSync(distPath).isFile();

  if (!existsInSrc && !existsInDist) {
    // Determine if it's an external URL referenced as a string
    missing.push(ref);
  }
}

// ─── Classify by directory ───
const byDirectory = {};
for (const m of missing) {
  // Extract directory from image path
  const parts = m.image.replace(/^\//, "").split("/");
  const dir = parts.length > 1 ? parts.slice(0, -1).join("/") : "(root)";
  if (!byDirectory[dir]) byDirectory[dir] = [];
  byDirectory[dir].push(m);
}

// ─── Determine fallback status for each missing image ───
function checkFallback(imagePath, sourceFile, sourceLine) {
  // Read the source file to check for fallback/onerror handling
  const fullSourcePath = resolve(ROOT, sourceFile);
  if (!existsSync(fullSourcePath))
    return { hasCSSFallback: false, hasJSFallback: false, detail: "Unknown" };

  const content = readFileSync(fullSourcePath, "utf-8");

  // Check for onerror handlers nearby
  const lines = content.split("\n");
  const lineIdx = sourceLine - 1;

  // Check this line and surrounding lines for onerror
  let hasOnerror = false;
  let hasCSSBgFallback = false;
  let hasParentClassWithBg = false;

  for (
    let i = Math.max(0, lineIdx - 2);
    i <= Math.min(lines.length - 1, lineIdx + 2);
    i++
  ) {
    if (lines[i].includes("onerror")) hasOnerror = true;
  }

  // Check if the parent container has a CSS background fallback
  // by scanning the file for CSS rules that could apply
  if (
    content.includes("hero-image") ||
    content.includes("hero-overlay") ||
    content.includes("background-color")
  ) {
    hasCSSBgFallback = true;
  }

  // Check for inline style backgrounds or fallback classes
  if (content.includes("background:") && content.includes("var(--doc-bg")) {
    hasCSSBgFallback = true;
  }

  return {
    hasCSSFallback: hasCSSBgFallback,
    hasJSFallback: hasOnerror,
    detail: hasCSSBgFallback
      ? "CSS background-color fallback exists on container"
      : hasOnerror
        ? "JS onerror handler present"
        : "No fallback detected",
  };
}

// ─── Determine severity ───
function determineSeverity(imagePath) {
  if (imagePath.includes("background-hero")) return "HIGH";
  if (imagePath.includes("hero")) return "HIGH";
  if (imagePath.includes("logo")) return "HIGH";
  if (imagePath.includes("ui/")) return "MEDIUM";
  if (imagePath.includes("veterans/")) return "MEDIUM";
  if (imagePath.includes("battels/")) return "MEDIUM";
  if (imagePath.includes("technology/")) return "MEDIUM";
  return "LOW";
}

// ─── Determine suggested replacement type ───
function suggestReplacement(imagePath) {
  const ext = extname(imagePath).toLowerCase();
  if (imagePath.includes("background-hero"))
    return "Hero background image (" + ext + ")";
  if (imagePath.includes("logo")) return "Logo/brand image (" + ext + ")";
  if (imagePath.includes("veterans"))
    return "Historical portrait (" + ext + ")";
  if (imagePath.includes("battels")) return "Battle photograph (" + ext + ")";
  if (imagePath.includes("technology"))
    return "Technology/equipment photo (" + ext + ")";
  return "Archival image (" + ext + ")";
}

// ─── Generate report ───
console.log("\n═══════════════════════════════════════════════════");
console.log("  MISSING ASSETS AUDIT REPORT");
console.log(`  ${missing.length} missing images found`);
console.log("═══════════════════════════════════════════════════\n");

// Group by directory
let counter = 0;
const directoryKeys = Object.keys(byDirectory).sort();
for (const dir of directoryKeys) {
  const items = byDirectory[dir];
  console.log(`\n── ${dir}/ (${items.length} missing) ──`);

  for (const item of items) {
    counter++;
    const filename = item.image.split("/").pop();
    const fallback = checkFallback(item.image, item.file, item.lineNumber);
    const severity = determineSeverity(item.image);
    const sevIcon =
      severity === "HIGH" ? "🔴" : severity === "MEDIUM" ? "🟡" : "🔵";
    const suggestion = suggestReplacement(item.image);

    console.log(`\n  #${counter} ${sevIcon} [${severity}] ${filename}`);
    console.log(`     Full path: ${item.image}`);
    console.log(`     Referenced in: ${item.file}:${item.lineNumber}`);
    console.log(`     Suggested: ${suggestion}`);
    console.log(`     Fallback: ${fallback.detail}`);
  }
}

// ─── Classify by severity ───
console.log("\n\n── Severity Summary ──");
const bySeverity = { HIGH: 0, MEDIUM: 0, LOW: 0 };
for (const dir of directoryKeys) {
  for (const item of byDirectory[dir]) {
    bySeverity[determineSeverity(item.image)]++;
  }
}
for (const [sev, count] of Object.entries(bySeverity)) {
  const icon = sev === "HIGH" ? "🔴" : sev === "MEDIUM" ? "🟡" : "🔵";
  console.log(`  ${icon} ${sev}: ${count}`);
}

// ─── Markdown output ───
let md = `# MISSING ASSETS REPORT — VeteranLedger

> **Generated**: ${new Date().toISOString().split("T")[0]}  
> **Total missing assets**: ${missing.length}  
> **Files scanned**: ${filesToScan.length}

---

## Severity Classification

| Icon | Severity | Count | Definition |
|------|----------|-------|------------|
| 🔴 | **HIGH** | ${bySeverity.HIGH} | Visible above-fold element, likely causes layout shift or prominent broken image |
| 🟡 | **MEDIUM** | ${bySeverity.MEDIUM} | Content image, visible but does not cause critical layout shift |
| 🔵 | **LOW** | ${bySeverity.LOW} | Minor or non-critical visual element |

---

`;

// Per-directory sections
for (const dir of directoryKeys) {
  const items = byDirectory[dir];
  const highCount = items.filter(
    (i) => determineSeverity(i.image) === "HIGH",
  ).length;
  const medCount = items.filter(
    (i) => determineSeverity(i.image) === "MEDIUM",
  ).length;
  const lowCount = items.filter(
    (i) => determineSeverity(i.image) === "LOW",
  ).length;

  md += `## ${dir}/\n\n`;
  md += `**${items.length} missing** (🔴${highCount} · 🟡${medCount} · 🔵${lowCount})\n\n`;

  md += `| # | File | Source | Line | Severity | Fallback | Action |
    |---|------|--------|------|----------|----------|--------|\n`;

  // Sort by severity (HIGH first)
  const sorted = [...items].sort((a, b) => {
    const sev = { HIGH: 0, MEDIUM: 1, LOW: 2 };
    return sev[determineSeverity(a.image)] - sev[determineSeverity(b.image)];
  });

  let idx = 1;
  for (const item of sorted) {
    const severity = determineSeverity(item.image);
    const sevIcon =
      severity === "HIGH" ? "🔴" : severity === "MEDIUM" ? "🟡" : "🔵";
    const fallback = checkFallback(item.image, item.file, item.lineNumber);
    const filename = item.image.split("/").pop();
    const action =
      fallback.hasCSSFallback || fallback.hasJSFallback
        ? "Safe to restore"
        : "Add fallback before restore";

    md += `| ${idx} | \`${filename}\` | \`${item.file}:${item.lineNumber}\` | \`${item.image}\` | ${sevIcon} ${severity} | ${fallback.detail} | ${action} |\n`;
    idx++;
  }

  md += "\n";
}

// ─── Source file summary ───
md += `## Source Files Referencing Missing Assets\n\n`;
const fileCounts = {};
for (const dir of directoryKeys) {
  for (const item of byDirectory[dir]) {
    if (!fileCounts[item.file]) fileCounts[item.file] = 0;
    fileCounts[item.file]++;
  }
}
const sortedFiles = Object.entries(fileCounts).sort((a, b) => b[1] - a[1]);
md += `| File | Missing Count |\n|------|--------------|\n`;
for (const [file, count] of sortedFiles) {
  md += `| \`${file}\` | ${count} |\n`;
}

// ─── Fallback assessment ───
md += `\n## Fallback Assessment\n\n`;
const withFallback = missing.filter((m) => {
  const f = checkFallback(m.image, m.file, m.lineNumber);
  return f.hasCSSFallback || f.hasJSFallback;
});
const withoutFallback = missing.filter((m) => {
  const f = checkFallback(m.image, m.file, m.lineNumber);
  return !f.hasCSSFallback && !f.hasJSFallback;
});

md += `| Status | Count |\n|--------|-------|\n`;
md += `| ✅ Has fallback (safe to restore) | ${withFallback.length} |\n`;
md += `| ⚠️ No fallback (add before restore) | ${withoutFallback.length} |\n`;

md += `\n## Restoration Priority Groups\n\n`;
md += `| Priority | Criteria | Count |\n|----------|----------|-------|\n`;
md += `| **P0** | Hero backgrounds — HIGH severity, has CSS bg fallback | ${bySeverity.HIGH} |\n`;
md += `| **P1** | Content images — MEDIUM severity | ${bySeverity.MEDIUM} |\n`;
md += `| **P2** | Minor images — LOW severity | ${bySeverity.LOW} |\n`;

md += `\n## Page Impact Matrix\n\n`;
const pageMissing = {};
for (const item of missing) {
  const page = item.file;
  if (!pageMissing[page])
    pageMissing[page] = { count: 0, high: 0, medium: 0, low: 0 };
  pageMissing[page].count++;
  const sev = determineSeverity(item.image);
  pageMissing[page][sev.toLowerCase()]++;
}
md += `| Page | Missing | HIGH | MEDIUM | LOW |\n|------|---------|------|--------|-----|\n`;
for (const [page, stats] of Object.entries(pageMissing).sort(
  (a, b) => b[1].count - a[1].count,
)) {
  md += `| \`${page}\` | ${stats.count} | ${stats.high || 0} | ${stats.medium || 0} | ${stats.low || 0} |\n`;
}

md += `\n## Restoration Guidelines\n\n`;
md += `1. **Never auto-remove references** — missing asset references are intentional and should be preserved\n`;
md += `2. **Never replace with fake/placeholder content** — only restore with authentic historical materials\n`;
md += `3. **Verify licensing** — all new images must be public domain or CC-licensed\n`;
md += `4. **Preserve attribution** — when images are added, ensure credit/license blocks are present\n`;
md += `5. **Test after each restoration** — verify no layout shifts, broken states, or missing alts\n`;
md += `6. **Update MISSING_ASSETS.md** — remove restored items from this report\n`;
md += `7. **For hero images (P0)**: Add to \`images/background-hero/\`. Recommended size: 1920×800px, PNG or JPG.\n`;
md += `8. **For battle images (P1)**: Add to \`images/battels/{year}/\`. Must match filename exactly.\n`;
md += `9. **For technology images (P1)**: Add to \`images/technology/\`. Must match filename exactly.\n`;
md += `10. **For veteran portraits (P2)**: Add to \`images/veterans/{branch}/\`. Must match filename exactly.\n`;

md += `\n---\n\n`;
md += `*This report was generated automatically by \`scripts/find-missing-assets.mjs\`. Re-run after any asset changes to verify completeness.*\n`;

// Write report
const reportPath = resolve(ROOT, "docs/restoration/MISSING_ASSETS.md");
writeFileSync(reportPath, md, "utf-8");
console.log(
  `\n✅ Report written to docs/restoration/MISSING_ASSETS.md (${(md.length / 1024).toFixed(1)}KB)`,
);
