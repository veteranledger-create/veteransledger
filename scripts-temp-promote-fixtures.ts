import prisma from "./src/database/prisma";
import { PublishService } from "./src/modules/publish/publish.service";
import { PromotionService } from "./src/modules/publish/promotion.service";

const TYPES = ["awards", "maps", "political-docs"];

async function main() {
  const admin = await prisma.user.findFirst({ where: { role: { in: ["ADMIN", "SUPER_ADMIN"] } } });
  if (!admin) { console.log("No admin user found"); return; }

  const publishSvc = new PublishService();
  const promoteSvc = new PromotionService();
  const results: Record<string, unknown> = {};

  for (const type of TYPES) {
    const report = await publishSvc.run(type, admin.id);
    const promo = await promoteSvc.promote(type, admin.id, true);
    results[type] = { staged: report.staged, promoStatus: promo.status, filesAffected: promo.filesAffected };
  }

  console.log(JSON.stringify(results, null, 2));
}

main().finally(() => prisma.$disconnect());
