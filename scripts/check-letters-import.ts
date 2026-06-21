/**
 * Phase 1B — safe to run. This script performs no database writes and
 * never touches public/data/: it only reads the real letters/*.json files
 * (plus other content types, read-only, for related_records existence
 * checks) and writes a report to storage/import-reports/letters/.
 */
import { runLettersImportDryRun, writeImportSummary } from "../src/modules/publish/import-validation/letters-import-check";

async function main() {
  const summary = await runLettersImportDryRun();
  const reportPath = await writeImportSummary(summary);
  console.log(`Import summary written to: ${reportPath}\n`);
  console.log(JSON.stringify(summary, null, 2));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
