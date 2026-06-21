/**
 * Safe to run. No database writes, no public/data/ writes — only reads
 * the real articles/*.json files (plus other content types, read-only,
 * for related_records existence checks) and writes a report to
 * storage/import-reports/articles/.
 */
import { runArticlesImportDryRun } from "../src/modules/publish/import-validation/articles-import-check";

async function main() {
  const summary = await runArticlesImportDryRun();
  console.log(JSON.stringify(summary, null, 2));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
