import express, { Application } from "express";
import helmet from "helmet";
import cors from "cors";
import compression from "compression";
import cookieParser from "cookie-parser";
import rateLimit from "express-rate-limit";
import session from "express-session";
import RedisStore from "connect-redis";
import Redis from "ioredis";
import path from "path";

import { config } from "./config/app";
import { securityConfig } from "./config/security";
import { requestLogger } from "./middleware/logger.middleware";
import { errorHandler, notFoundHandler } from "./middleware/error.middleware";
import { logger } from "./middleware/logger.middleware";

// Module routes
import { authRoutes } from "./modules/auth/auth.routes";
import { dashboardRoutes } from "./modules/dashboard/dashboard.routes";
import { recordsRoutes } from "./modules/records/records.routes";
import { personnelRoutes } from "./modules/personnel/personnel.routes";
import { campaignsRoutes } from "./modules/campaigns/campaigns.routes";
import { armamentsRoutes } from "./modules/armaments/armaments.routes";
import { lettersRoutes } from "./modules/letters/letters.routes";
import { articlesRoutes } from "./modules/articles/articles.routes";
import { timelineRoutes } from "./modules/timeline/timeline.routes";
import { mediaRoutes } from "./modules/media/media.routes";
import { searchRoutes } from "./modules/search/search.routes";
import { contactRoutes } from "./modules/contact/contact.routes";
import { publishRoutes } from "./modules/publish/publish.routes";

export function createApp(): Application {
  const app = express();

  // ── Security ────────────────────────────────────────────────────────────
  app.use(helmet(securityConfig.helmet));
  app.use(cors(securityConfig.cors));
  app.set("trust proxy", 1);

  // ── Rate limiting ────────────────────────────────────────────────────────
  app.use("/api", rateLimit(securityConfig.rateLimit));

  // ── Body parsing ─────────────────────────────────────────────────────────
  app.use(express.json({ limit: "10mb" }));
  app.use(express.urlencoded({ extended: true, limit: "10mb" }));
  app.use(cookieParser());
  app.use(compression());

  // ── Sessions (Redis-backed, falls back to in-memory if Redis unavailable) ──
  let sessionStore: session.Store | undefined;
  try {
    const redisClient = new Redis(config.redis.url, { lazyConnect: true, enableOfflineQueue: false });
    redisClient.on("error", (err: Error) => logger.warn("Redis session store error", { error: err.message }));
    // connect-redis v7 accepts any client that implements get/set/del; ioredis is compatible at runtime
    sessionStore = new RedisStore({ client: redisClient as unknown as ConstructorParameters<typeof RedisStore>[0]["client"] });
  } catch {
    logger.warn("Redis unavailable — sessions will use in-memory store (not suitable for production)");
  }
  app.use(session({ ...securityConfig.session, store: sessionStore }));

  // ── Logging ──────────────────────────────────────────────────────────────
  app.use(requestLogger);

  // ── Static files ─────────────────────────────────────────────────────────
  app.use("/public", express.static(config.paths.public));
  app.use("/styles", express.static(path.join(config.paths.frontend, "styles")));
  app.use("/components", express.static(path.join(config.paths.frontend, "components")));
  app.use("/layouts", express.static(path.join(config.paths.frontend, "layouts")));
  app.use("/pages", express.static(path.join(config.paths.frontend, "pages")));
  app.use(
    "/storage",
    express.static(config.paths.storage, { maxAge: "7d", etag: true })
  );

  // ── API Routes ───────────────────────────────────────────────────────────
  app.use("/api/auth", authRoutes);
  app.use("/api/dashboard", dashboardRoutes);
  app.use("/api/records", recordsRoutes);
  app.use("/api/personnel", personnelRoutes);
  app.use("/api/campaigns", campaignsRoutes);
  app.use("/api/armaments", armamentsRoutes);
  app.use("/api/letters", lettersRoutes);
  app.use("/api/articles", articlesRoutes);
  app.use("/api/timeline", timelineRoutes);
  app.use("/api/media", mediaRoutes);
  app.use("/api/search", searchRoutes);
  app.use("/api/contact", contactRoutes);
  app.use("/api/publish", publishRoutes);

  // ── Frontend page routes ──────────────────────────────────────────────────
  const pagesDir = path.join(config.paths.frontend, "pages");
  const servePage = (page: string, file = "index.html") => (_req: express.Request, res: express.Response) =>
    res.sendFile(path.join(pagesDir, page, file));

  app.get("/", servePage("Home"));
  app.get("/timeline", servePage("Timeline"));
  app.get("/campaigns", servePage("Campaigns"));
  app.get("/campaigns/:id", servePage("Campaigns", "record.html"));
  app.get("/personnel", servePage("Personnel"));
  app.get("/personnel/:id", servePage("Personnel", "record.html"));
  app.get("/armaments", servePage("Armaments"));
  app.get("/armaments/:id/gallery", servePage("Armaments", "gallery.html"));
  app.get("/armaments/:id", servePage("Armaments", "record.html"));
  app.get("/letters", servePage("Letters"));
  app.get("/letters/:id", servePage("Letters", "record.html"));
  app.get("/articles", servePage("Articles"));
  app.get("/articles/:id", servePage("Articles", "record.html"));
  app.get("/formations", servePage("Formations"));
  app.get("/formations/:id", servePage("Formations", "record.html"));
  app.get("/nsdap", servePage("Nsdap"));
  app.get("/about", servePage("About"));
  app.get("/search", servePage("Search"));
  app.get("/site-policies", servePage("SitePolicies"));
  app.get("/admin", servePage("Admin"));

  // ── 404 + Error handlers ─────────────────────────────────────────────────
  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}
