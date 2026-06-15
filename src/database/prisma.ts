import { PrismaClient, Prisma } from "@prisma/client";
import { databaseConfig } from "../config/database";

const globalForPrisma = globalThis as unknown as { prisma: PrismaClient };

export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({
    log: databaseConfig.log as unknown as Prisma.LogLevel[],
    datasources: {
      db: { url: databaseConfig.url },
    },
  });

if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = prisma;

export default prisma;
