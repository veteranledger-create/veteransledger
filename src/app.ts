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
import { siteContentRoutes } from "./modules/site-content/site-content.routes";
import { formationsRoutes } from "./modules/formations/formations.routes";
import { translationsRoutes } from "./modules/translations/translations.routes";
import { iconsRoutes } from "./modules/icons/icons.routes";
import { communityRoutes } from "./modules/community/community.routes";

export function createApp(): Application {
  const app = express();

  // ── Security ────────────────────────────────────────────────────────────
  app.use(helmet(securityConfig.helmet));
  app.use(cors(securityConfig.cors));
  app.set("trust proxy", 1);

  // ── Rate limiting ────────────────────────────────────────────────────────
  app.use("/api", rateLimit(securityConfig.rateLimit));

  // ── Body parsing ─────────────────────────────────────────────────────────
  // 1 MB covers any JSON admin payload. File uploads use multer (multipart)
  // and bypass this entirely — reducing this does not affect upload functionality.
  app.use(express.json({ limit: "1mb" }));
  app.use(express.urlencoded({ extended: true, limit: "1mb" }));
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
  // SVG and HTML files served from /storage must not execute in-browser.
  // Content-Disposition: attachment forces download; nosniff is also set
  // globally by Helmet, but this middleware makes intent explicit.
  const EXECUTABLE_EXTS = new Set([".svg", ".html", ".htm", ".xhtml"]);
  app.use("/storage", (req: express.Request, res: express.Response, next: express.NextFunction) => {
    const ext = path.extname(req.path).toLowerCase();
    if (EXECUTABLE_EXTS.has(ext)) {
      res.setHeader("Content-Disposition", "attachment");
      res.setHeader("Content-Type", "application/octet-stream");
    }
    next();
  }, express.static(config.paths.storage, { maxAge: "7d", etag: true }));

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
  app.use("/api/site-content", siteContentRoutes);
  app.use("/api/formations", formationsRoutes);
  app.use("/api/translations", translationsRoutes);
  app.use("/api/icons", iconsRoutes);
  // Reserved foundation for the future Community system (posts, comments,
  // reactions, reports, notifications, moderation) — every route currently
  // responds 501. See src/modules/community and docs/community-architecture.md.
  app.use("/api/community", communityRoutes);

  // ── Frontend page routes ──────────────────────────────────────────────────
  const pagesDir = path.join(config.paths.frontend, "pages");
  const maintenanceFile = path.join(pagesDir, "Maintenance", "index.html");

  // Every public page route uses this helper — when config.maintenanceMode
  // is on, it swaps in the "Under Development" page instead of real content.
  // /admin is registered separately below and never passes through here, so
  // the Admin panel (and /api/*, static assets) stay fully accessible
  // regardless of this flag. Toggle via the single MAINTENANCE_MODE env var
  // — no routes are added, removed, or restructured to enable/disable it.
  const servePage = (page: string, file = "index.html") => (_req: express.Request, res: express.Response) => {
    if (config.maintenanceMode) {
      // 503 + Retry-After signals search engines/crawlers this is temporary
      // and the real content should not be de-indexed, without the page
      // itself looking or reading like an error to human visitors.
      res.status(503).set("Retry-After", "3600").sendFile(maintenanceFile);
      return;
    }
    res.sendFile(path.join(pagesDir, page, file));
  };

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
  app.get("/awards", servePage("Awards"));
  app.get("/awards/:id", servePage("Awards", "record.html"));
  app.get("/maps", servePage("Maps"));
  app.get("/maps/:id", servePage("Maps", "record.html"));
  app.get("/political-documents", servePage("PoliticalDocs"));
  app.get("/political-documents/:id", servePage("PoliticalDocs", "record.html"));
  app.get("/nsdap", servePage("Nsdap"));
  app.get("/about", servePage("About"));
  app.get("/search", servePage("Search"));
  app.get("/site-policies", servePage("SitePolicies"));

  // Admin bypasses servePage() entirely — it must stay reachable even when
  // maintenanceMode is on, so it never touches the maintenance-mode check above.
  app.get("/admin", (_req, res) => res.sendFile(path.join(pagesDir, "Admin", "index.html")));

  // ── 404 + Error handlers ─────────────────────────────────────────────────
  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}
