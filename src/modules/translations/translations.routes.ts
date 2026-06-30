import { Router } from "express";
import { TranslationsController } from "./translations.controller";
import { authenticate } from "../../middleware/auth.middleware";
import { requireAdmin } from "../../middleware/admin.middleware";

export const translationsRoutes = Router();
const ctrl = new TranslationsController();

// Public reads — the frontend language switcher needs these without admin auth.
// English is never stored here, so there is no sensitive content to protect;
// only the source tables (already public) and machine/human-reviewed copies.
translationsRoutes.get("/:entityType/:entityId",        ctrl.list.bind(ctrl));
translationsRoutes.get("/:entityType/:entityId/:locale", ctrl.get.bind(ctrl));

// Everything else (generate/edit/delete/dashboard) is admin-only.
translationsRoutes.post("/dashboard/items", authenticate, requireAdmin, ctrl.dashboardItems.bind(ctrl));
translationsRoutes.get("/dashboard", authenticate, requireAdmin, ctrl.dashboardSummary.bind(ctrl));
translationsRoutes.post("/:entityType/:entityId/:locale/generate", authenticate, requireAdmin, ctrl.generate.bind(ctrl));
translationsRoutes.put("/:entityType/:entityId/:locale", authenticate, requireAdmin, ctrl.update.bind(ctrl));
translationsRoutes.delete("/:entityType/:entityId/:locale", authenticate, requireAdmin, ctrl.remove.bind(ctrl));
