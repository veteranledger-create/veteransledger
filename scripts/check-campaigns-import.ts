/**
 * Safe to run. No database writes, no public/data/ writes — only reads
 * the real campaigns/**\/*.json files (plus other content types,
 * read-only, for related_records existence checks and image-file
 * existence checks) and writes a report to storage/import-reports/campaigns/.
 */
import { runCampaignsImportDryRun } from "../src/modules/publish/import-validation/campaigns-import-check";

async function main() {
  const summary = await runCampaignsImportDryRun();
  console.log(JSON.stringify(summary, null, 2));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
