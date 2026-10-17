import { Router } from "express";
import { DashboardController } from "./dashboard.controller";
import { authenticate } from "../../middleware/auth.middleware";
import { requireAdmin } from "../../middleware/admin.middleware";

export const dashboardRoutes = Router();
const ctrl = new DashboardController();

// Router-level guard: every dashboard route is admin-only and read-only.
dashboardRoutes.use(authenticate, requireAdmin);
dashboardRoutes.get("/stats", ctrl.getStats.bind(ctrl));
// Aggregates over the file-backed content under public/data. Returns counts
// plus at most ten example paths — never a full dataset. Memoised for 60s.
dashboardRoutes.get("/content-health", ctrl.getContentHealth.bind(ctrl));
dashboardRoutes.get("/recent", ctrl.getRecentActivity.bind(ctrl));
