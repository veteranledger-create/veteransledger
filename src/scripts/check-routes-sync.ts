/**
 * Validates that frontend/pages/shared/related-url-resolver.js is byte-for-byte
 * identical to what generate-client-resolver.ts would produce right now.
 *
 * Exits 0 if in sync, exits 1 if stale or missing.
 * Does NOT write anything — use npm run generate:routes to fix.
 *
 * Called by: npm run check:routes  (and as npm pretest)
 */

import { readFileSync, existsSync } from "fs";
import { buildContent, GENERATED_PATH } from "./generate-client-resolver";

const expected = buildContent();

if (!existsSync(GENERATED_PATH)) {
  console.error(`[check:routes] MISSING  ${GENERATED_PATH}`);
  console.error(`[check:routes] Fix:     npm run generate:routes`);
  process.exit(1);
}

const actual = readFileSync(GENERATED_PATH, "utf-8");

if (actual !== expected) {
  console.error(`[check:routes] OUT OF SYNC  ${GENERATED_PATH}`);
  console.error(`[check:routes] The committed JS file does not match the current route-definitions.ts.`);
  console.error(`[check:routes] Fix:          npm run generate:routes`);
  process.exit(1);
}

console.log(`[check:routes] OK  ${GENERATED_PATH} is up to date.`);
