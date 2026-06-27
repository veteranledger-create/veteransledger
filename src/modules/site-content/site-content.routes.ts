import { Router } from "express";
import { SiteContentController } from "./site-content.controller";
import { authenticate } from "../../middleware/auth.middleware";
import { requireAdmin } from "../../middleware/admin.middleware";

export const siteContentRoutes = Router();
const ctrl = new SiteContentController();

siteContentRoutes.get("/", ctrl.read.bind(ctrl));
siteContentRoutes.put("/", authenticate, requireAdmin, ctrl.write.bind(ctrl));
