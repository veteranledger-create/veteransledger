import { Router } from "express";
import { DashboardController } from "./dashboard.controller";
import { authenticate } from "../../middleware/auth.middleware";
import { requireAdmin } from "../../middleware/admin.middleware";

export const dashboardRoutes = Router();
const ctrl = new DashboardController();

dashboardRoutes.use(authenticate, requireAdmin);
dashboardRoutes.get("/stats", ctrl.getStats.bind(ctrl));
dashboardRoutes.get("/recent", ctrl.getRecentActivity.bind(ctrl));
