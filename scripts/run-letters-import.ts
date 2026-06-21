/**
 * Phase 1C entry point. Safe to run as-is: runLettersImport() is
 * self-gated on EXECUTION_ENABLED (currently false in letters-importer.ts)
 * and immediately returns status:"execution_disabled" without any Prisma
 * access at all if that gate is closed — main() being called here doesn't
 * change that. Flipping EXECUTION_ENABLED to true is a separate, explicit
 * step for whoever authorizes the real import later.
 */
import prisma from "../src/database/prisma";
import { runLettersImport } from "../src/modules/publish/import-validation/letters-importer";

async function main() {
  const result = await runLettersImport({ mode: "insert-only", confirmExecution: true });
  console.log(JSON.stringify(result, null, 2));
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
