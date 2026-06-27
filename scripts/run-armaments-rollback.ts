/**
 * Rolls back to a specific promotion runId. Pass --runId=<uuid>.
 * Requires PROMOTION_ENABLED=true in promotion.service.ts.
 */
import prisma from "../src/database/prisma";
import { PromotionService } from "../src/modules/publish/promotion.service";

async function main() {
  const runIdArg = process.argv.find((a) => a.startsWith("--runId="));
  if (!runIdArg) throw new Error("Pass --runId=<uuid>");
  const targetRunId = runIdArg.replace("--runId=", "");

  const service = new PromotionService();
  const result = await service.rollback("armaments", targetRunId, "cmqehwj6500006ggaik2e4tak", true);
  console.log(JSON.stringify(result, null, 2));
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
