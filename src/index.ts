import { createApp } from "./app";
import { config } from "./config/app";
import { logger } from "./middleware/logger.middleware";
import prisma from "./database/prisma";
import fs from "fs";
import path from "path";

async function bootstrap(): Promise<void> {
  // Ensure log directories exist
  const logDirs = ["application", "access", "errors"].map((d) =>
    path.join(config.paths.logs, d),
  );
  const storageDirs = Object.values({
    images: path.join(config.paths.storage, "images"),
    documents: path.join(config.paths.storage, "documents"),
    audio: path.join(config.paths.storage, "audio"),
    video: path.join(config.paths.storage, "video"),
    thumbnails: path.join(config.paths.storage, "thumbnails"),
    temporary: path.join(config.paths.storage, "temporary"),
  });
  [...logDirs, ...storageDirs].forEach((dir) => {
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  });

  // Test database connection
  try {
    await prisma.$connect();
    logger.info("Database connection established");
  } catch (err) {
    logger.warn("Database connection failed — running without DB", {
      error: String(err),
    });
  }

  const app = createApp();
  const { port, host } = config.server;

  app.listen(port, host, () => {
    logger.info(`VeteransLedger server running at http://${host}:${port}`);
    logger.info(`Environment: ${config.env}`);
  });

  const shutdown = async (signal: string) => {
    logger.info(`${signal} received — shutting down gracefully`);
    await prisma.$disconnect();
    process.exit(0);
  };
  process.on("SIGTERM", () => shutdown("SIGTERM"));
  process.on("SIGINT", () => shutdown("SIGINT"));
}

bootstrap().catch((err) => {
  console.error("Fatal startup error:", err);
  process.exit(1);
});
