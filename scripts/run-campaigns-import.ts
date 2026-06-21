/**
 * Entry point. Safe to run as-is: runCampaignsImport() is self-gated on
 * EXECUTION_ENABLED (currently false in campaigns-importer.ts) and
 * immediately returns status:"execution_disabled" without any Prisma
 * access at all if that gate is closed.
 */
import prisma from "../src/database/prisma";
import { runCampaignsImport } from "../src/modules/publish/import-validation/campaigns-importer";

async function main() {
  const result = await runCampaignsImport({ mode: "insert-only", confirmExecution: true });
  console.log(JSON.stringify(result, null, 2));
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
