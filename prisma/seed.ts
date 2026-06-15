import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";

const prisma = new PrismaClient();

async function main() {
  console.log("Seeding database...");

  const adminHash = await bcrypt.hash(
    process.env.ADMIN_PASSWORD ?? "changeme123",
    12,
  );
  await prisma.user.upsert({
    where: { email: process.env.ADMIN_EMAIL ?? "admin@VeteransLedger.com" },
    update: {},
    create: {
      email: process.env.ADMIN_EMAIL ?? "admin@VeteransLedger.com",
      passwordHash: adminHash,
      role: "SUPER_ADMIN",
    },
  });

  console.log("Admin user created.");
  console.log("Seed complete.");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
