/**
 * Safe to run. No database writes, no public/data/ writes — only reads
 * the real armaments source JSON files and writes a dry-run report.
 * Pass --scope=missiles,wunderwaffen (or any comma-separated category
 * list) to limit the gate checks to those categories; omit for a full
 * unscoped run (all 6 categories).
 */
import { runArmamentsImportDryRun } from "../src/modules/publish/import-validation/armaments-import-check";

async function main() {
  const scopeArg = process.argv.find((a) => a.startsWith("--scope="));
  const categories = scopeArg ? scopeArg.replace("--scope=", "").split(",") : undefined;
  const summary = await runArmamentsImportDryRun(categories ? { categories } : undefined);
  console.log(JSON.stringify(summary, null, 2));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
