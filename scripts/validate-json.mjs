/**
 * JSON VALIDATION SCRIPT
 * Validates all JSON data files in data/ and public/data/
 *
 * Usage: node scripts/validate-json.mjs
 */

import { readFileSync, readdirSync, existsSync } from "fs";
import { resolve, join } from "path";
import { fileURLToPath } from "url";

const __dirname = resolve(fileURLToPath(import.meta.url), "..", "..");

const dataDirs = ["data", "public/data"];

const results = { valid: 0, invalid: 0, errors: [] };

dataDirs.forEach((dir) => {
  const dirPath = resolve(__dirname, dir);
  if (!existsSync(dirPath)) return;

  const files = readdirSync(dirPath).filter((f) => f.endsWith(".json"));

  files.forEach((file) => {
    const filePath = join(dirPath, file);
    try {
      const content = readFileSync(filePath, "utf-8");
      const parsed = JSON.parse(content);
      const size = (content.length / 1024).toFixed(1);
      const type = Array.isArray(parsed) ? `Array[${parsed.length}]` : typeof parsed;
      console.log(`  ✓ ${dir}/${file} (${size}KB, ${type})`);
      results.valid++;
    } catch (e) {
      console.error(`  ✗ ${dir}/${file}: ${e.message}`);
      results.invalid++;
      results.errors.push(`${dir}/${file}: ${e.message}`);
    }
  });
});

console.log("\n─── Validation Results ───");
console.log(`Valid:   ${results.valid}`);
console.log(`Invalid: ${results.invalid}`);

if (results.errors.length > 0) {
  console.log("\nErrors:");
  results.errors.forEach((e) => console.log(`  • ${e}`));
  process.exit(1);
} else {
  console.log("\nAll JSON files are valid.");
}
