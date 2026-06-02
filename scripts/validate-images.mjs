/**
 * IMAGE VALIDATION SCRIPT
 * Checks that all locally-referenced images exist.
 *
 * Usage: node scripts/validate-images.mjs
 */

import { existsSync, readFileSync, readdirSync, statSync } from "fs";
import { resolve } from "path";
import { fileURLToPath } from "url";

const __dirname = resolve(fileURLToPath(import.meta.url), "..", "..");
const ROOT = __dirname;

const imageDir = resolve(ROOT, "images");

// Collect all existing images
const existingImages = new Set();

function collectImages(dir) {
  if (!existsSync(dir)) return;
  const entries = readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const full = resolve(dir, entry.name);
    if (entry.isDirectory()) {
      collectImages(full);
    } else if (/\.(png|jpg|jpeg|gif|svg|webp)$/i.test(entry.name)) {
      existingImages.add(full.toLowerCase());
    }
  }
}
collectImages(imageDir);

// Scan all HTML and data files for image references
const filesToScan = [];

function collectFiles(dir) {
  if (!existsSync(dir)) return;
  const entries = readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const full = resolve(dir, entry.name);
    if (
      entry.isDirectory() &&
      !entry.name.startsWith(".") &&
      entry.name !== "node_modules" &&
      entry.name !== "dist" &&
      entry.name !== "backup"
    ) {
      collectFiles(full);
    } else if (
      entry.isFile() &&
      /\.(html|js|json)$/i.test(entry.name)
    ) {
      filesToScan.push(full);
    }
  }
}
collectFiles(ROOT);

const missing = [];
const external = [];

for (const file of filesToScan) {
  const content = readFileSync(file, "utf-8");
  const relPath = file.replace(ROOT + "\\", "").replace(ROOT + "/", "");

  // Find all image references
  const refs = [
    ...content.matchAll(/["']([^"']+\.(?:png|jpg|jpeg|gif|svg|webp)(?:\?[^"']*)?)["']/gi),
    ...content.matchAll(/src=["']([^"']+\.(?:png|jpg|jpeg|gif|svg|webp))["']/gi),
  ];

  for (const match of refs) {
    let imgSrc = match[1].split("?")[0]; // Remove query params

    if (imgSrc.startsWith("http") || imgSrc.startsWith("//") || imgSrc.startsWith("data:")) {
      external.push(imgSrc);
      continue;
    }

    // Resolve relative to root
    const cleanPath = imgSrc.startsWith("/") ? imgSrc.substring(1) : imgSrc;
    const fullPath = resolve(ROOT, cleanPath).toLowerCase();

    if (!existingImages.has(fullPath)) {
      missing.push({ file: relPath, image: imgSrc });
    }
  }
}

console.log("╔══════════════════════════════════════════════════╗");
console.log("║   Image Validation                              ║");
console.log("╠══════════════════════════════════════════════════╣");

console.log(`\nExisting images: ${existingImages.size}`);
console.log(`Files scanned:   ${filesToScan.length}`);
console.log(`External URLs:   ${external.length}`);

if (missing.length > 0) {
  console.log(`\n✗ MISSING IMAGES (${missing.length}):`);
  missing.forEach(({ file, image }) => {
    console.log(`  • ${image}`);
    console.log(`    referenced from: ${file}`);
  });
} else {
  console.log("\n✓ All local images exist.");
}

console.log("\n═══════════════════════════════════════════════════");

process.exit(missing.length > 0 ? 1 : 0);
