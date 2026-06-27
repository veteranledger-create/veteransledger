/**
 * Promotes staged armaments files from storage/publish-staging/armaments/
 * into public/data/armaments/. Requires PROMOTION_ENABLED=true in
 * promotion.service.ts.
 */
import prisma from "../src/database/prisma";
import { PromotionService } from "../src/modules/publish/promotion.service";

async function main() {
  const service = new PromotionService();
  const result = await service.promote("armaments", "cmqehwj6500006ggaik2e4tak", true);
  console.log(JSON.stringify(result, null, 2));
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
