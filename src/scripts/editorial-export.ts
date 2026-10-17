/**
 * Manual export of the editorial set, and its status.
 *
 * Run with:
 *   npx ts-node src/scripts/editorial-export.ts status
 *   npx ts-node src/scripts/editorial-export.ts run
 *
 * There is no schedule and no remote. The archive is written to local storage
 * and moving it somewhere safe is an operator step outside this application —
 * no credentials are stored, and nothing here opens a network connection.
 */
import { editorialExporter } from "../modules/editorial-history/export";

async function main(): Promise<void> {
  const command = process.argv[2] ?? "status";

  if (command === "status") {
    const status = await editorialExporter.status();
    console.log(`state             : ${status.state}`);
    console.log(`last export       : ${status.lastExportAt ?? "(never)"}`);
    console.log(`archive           : ${status.archive ?? "(none)"}`);
    console.log(`newest revision   : ${status.newestRevisionAt ?? "(none recorded)"}`);
    console.log(`changed since     : ${status.staleFileCount} file(s)`);
    if (status.staleFiles.length > 0) {
      console.log(`  changed/new     : ${status.staleFiles.join(", ")}`);
    }
    if (status.removedFiles.length > 0) {
      console.log(`  removed         : ${status.removedFiles.join(", ")}`);
    }
    console.log(`off-volume        : ${status.offVolume}  (archive lives in ${status.archiveDirectory})`);
    console.log(`\n${status.message}`);
    // A stale or missing export is a real finding, so it is reported as a
    // non-zero exit rather than quietly printed.
    process.exitCode = status.state === "current" ? 0 : 1;
    return;
  }

  if (command === "run") {
    const manifest = await editorialExporter.run();
    console.log(`exported ${manifest.fileCount} file(s), ${manifest.totalBytes} bytes`);
    console.log(`archive           : ${manifest.archive} (${manifest.archiveBytes} bytes)`);
    console.log(`archive sha256    : ${manifest.archiveSha256}`);
    console.log(`verified          : extracted and checked every file`);
    console.log(`\n${manifest.note}`);
    return;
  }

  throw new Error(`Unknown command "${command}". Use "status" or "run".`);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
