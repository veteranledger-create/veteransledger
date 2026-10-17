import { Router } from "express";
import { SiteContentController } from "./site-content.controller";
import { authenticate } from "../../middleware/auth.middleware";
import { requireAdmin } from "../../middleware/admin.middleware";

export const siteContentRoutes = Router();
const ctrl = new SiteContentController();

siteContentRoutes.get("/", ctrl.read.bind(ctrl));
siteContentRoutes.put("/", authenticate, requireAdmin, ctrl.write.bind(ctrl));

// History and recovery. All admin-only: a revision log names who changed
// what, and a restore is a write.
siteContentRoutes.get("/history", authenticate, requireAdmin, ctrl.history.bind(ctrl));
siteContentRoutes.post("/restore", authenticate, requireAdmin, ctrl.restore.bind(ctrl));
siteContentRoutes.post("/reconcile", authenticate, requireAdmin, ctrl.reconcile.bind(ctrl));
siteContentRoutes.get("/export-status", authenticate, requireAdmin, ctrl.exportStatus.bind(ctrl));
