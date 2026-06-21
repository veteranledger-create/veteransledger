/**
 * Entry point. Safe to run as-is: runArticlesImport() is self-gated on
 * EXECUTION_ENABLED (currently false in articles-importer.ts) and
 * immediately returns status:"execution_disabled" without any Prisma
 * access at all if that gate is closed.
 */
import prisma from "../src/database/prisma";
import { runArticlesImport } from "../src/modules/publish/import-validation/articles-importer";

async function main() {
  const result = await runArticlesImport({ mode: "insert-only", confirmExecution: true });
  console.log(JSON.stringify(result, null, 2));
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
