/** One-time pilot runner — naval category only, capped at 14 records. */
import prisma from "../src/database/prisma";
import { runArmamentsImport, takePreImportSnapshot } from "../src/modules/publish/import-validation/armaments-importer";

async function main() {
  console.log("── Pre-pilot snapshot ──");
  console.log(JSON.stringify(await takePreImportSnapshot(), null, 2));

  const result = await runArmamentsImport({
    mode: "insert-only",
    confirmExecution: true,
    categories: ["naval"],
    maxRecords: 14,
  });

  console.log("\n── Pilot import result ──");
  console.log(JSON.stringify(result, null, 2));
}

main()
  .catch((e) => {
    console.error("PILOT FAILED:", e.message);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
