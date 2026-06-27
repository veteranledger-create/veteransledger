/**
 * Runs PublishService.run("armaments") — reads all published ARMAMENT
 * records from DB, validates them, generates staged JSON files in
 * storage/publish-staging/armaments/. Never touches public/data/.
 */
import prisma from "../src/database/prisma";
import { PublishService } from "../src/modules/publish/publish.service";

async function main() {
  const service = new PublishService();
  const report = await service.run("armaments", "cmqehwj6500006ggaik2e4tak");
  console.log(JSON.stringify(report, null, 2));
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
