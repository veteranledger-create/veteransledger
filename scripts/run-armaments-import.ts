/**
 * Entry point. Safe to run as-is: runArmamentsImport() is self-gated on
 * EXECUTION_ENABLED (currently false in armaments-importer.ts) and
 * immediately returns status:"execution_disabled" without any Prisma
 * access at all if that gate is closed.
 *
 * Pass --scope=missiles,wunderwaffen to restrict to those categories.
 * Pass --mode=sync to use sync mode (default: insert-only).
 */
import prisma from "../src/database/prisma";
import { runArmamentsImport } from "../src/modules/publish/import-validation/armaments-importer";

async function main() {
  const scopeArg = process.argv.find((a) => a.startsWith("--scope="));
  const categories = scopeArg ? scopeArg.replace("--scope=", "").split(",") : undefined;
  const modeArg = process.argv.find((a) => a.startsWith("--mode="));
  const mode = modeArg?.replace("--mode=", "") === "sync" ? "sync" : "insert-only";

  const result = await runArmamentsImport({
    mode,
    confirmExecution: true,
    ...(categories ? { categories } : {}),
  });
  console.log(JSON.stringify(result, null, 2));
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
