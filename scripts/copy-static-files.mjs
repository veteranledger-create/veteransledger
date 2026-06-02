/**
 * COPY STATIC FILES TO DIST
 *
 * Vite's HTML plugin may skip very large HTML files.
 * This script copies those files plus other static assets
 * that Vite doesn't process directly.
 *
 * Usage: node scripts/copy-static-files.mjs
 * Called as part of the build process.
 */

import { copyFileSync, existsSync, mkdirSync, readdirSync, statSync } from "fs";
import { resolve, join, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = resolve(fileURLToPath(import.meta.url), "..", "..");
const ROOT = __dirname;
const DIST = resolve(ROOT, "dist");

// Files to copy from root to dist
const ROOT_FILES = [
  "ads.txt",
  "robots.txt",
  "sitemap.xml",
  "_headers",
  "_redirects",
];

// HTML pages that Vite might not process (large files)
const HTML_PAGES = [
  "veterans.html",
  "battles.html",
  "technology.html",
  "articles.html",
  "letters.html",
  "political.html",
];

// Directories to copy
const DIR_COPIES = [
  { src: "data", dest: "data" },
  { src: "public/data", dest: "data" },
  { src: "public/images", dest: "images" },
  { src: "public/licenses", dest: "licenses" },
  { src: "public/static", dest: "static" },
  { src: "images", dest: "images" },
];

console.log("╔══════════════════════════════════════════════════╗");
console.log("║   Post-Build Static File Copier                  ║");
console.log("╠══════════════════════════════════════════════════╣");
console.log("║   Copying large HTML files and static assets     ║");
console.log("╚══════════════════════════════════════════════════╝\n");

let copied = 0;
let skipped = 0;
let errors = 0;

// Copy root files
ROOT_FILES.forEach((file) => {
  const src = resolve(ROOT, file);
  const dest = resolve(DIST, file);
  if (existsSync(src)) {
    try {
      copyFileSync(src, dest);
      console.log(`  ✓ ${file}`);
      copied++;
    } catch (e) {
      console.log(`  ✗ ${file}: ${e.message}`);
      errors++;
    }
  } else {
    console.log(`  - ${file}: not found, skipping`);
    skipped++;
  }
});

// Copy HTML pages
HTML_PAGES.forEach((file) => {
  const src = resolve(ROOT, file);
  const dest = resolve(DIST, file);

  if (!existsSync(src)) {
    console.log(`  - ${file}: not found, skipping`);
    skipped++;
    return;
  }

  // Always prefer the file system copy over Vite's truncated version
  // Vite may produce incomplete HTML for large files
  if (existsSync(dest)) {
    const srcSize = statSync(src).size;
    const destSize = statSync(dest).size;
    if (destSize >= srcSize) {
      console.log(
        `  · ${file}: Vite version is same size or larger, keeping it`,
      );
      skipped++;
      return;
    }
    console.log(
      `  · ${file}: Vite version (${(destSize / 1024).toFixed(1)}KB) is smaller than source (${(srcSize / 1024).toFixed(1)}KB), overwriting with full version`,
    );
  }

  try {
    copyFileSync(src, dest);
    const size = (statSync(src).size / 1024).toFixed(1);
    console.log(`  ✓ ${file} (${size}KB)`);
    copied++;
  } catch (e) {
    console.log(`  ✗ ${file}: ${e.message}`);
    errors++;
  }
});

// Copy directories
DIR_COPIES.forEach(({ src, dest: destDir }) => {
  const srcPath = resolve(ROOT, src);
  const destPath = resolve(DIST, destDir);

  if (!existsSync(srcPath)) {
    console.log(`  - ${src}: not found, skipping`);
    skipped++;
    return;
  }

  try {
    copyDirSync(srcPath, destPath);
    console.log(`  ✓ ${src}/ → ${destDir}/`);
    copied++;
  } catch (e) {
    console.log(`  ✗ ${src}: ${e.message}`);
    errors++;
  }
});

console.log("\n═══════════════════════════════════════════════════");
console.log(`   Copied: ${copied} · Skipped: ${skipped} · Errors: ${errors}`);
console.log("═══════════════════════════════════════════════════\n");

/**
 * Recursively copy a directory.
 */
function copyDirSync(src, dest) {
  if (!existsSync(dest)) {
    mkdirSync(dest, { recursive: true });
  }

  const entries = readdirSync(src, { withFileTypes: true });
  for (const entry of entries) {
    const srcPath = join(src, entry.name);
    const destPath = join(dest, entry.name);

    if (entry.isDirectory()) {
      copyDirSync(srcPath, destPath);
    } else {
      // Skip if destination exists (prefer Vite outputs)
      if (existsSync(destPath)) continue;
      copyFileSync(srcPath, destPath);
    }
  }
}
