import { Router } from "express";
import { TranslationsController } from "./translations.controller";
import { authenticate, optionalAuth } from "../../middleware/auth.middleware";
import { requireAdmin } from "../../middleware/admin.middleware";

export const translationsRoutes = Router();
const ctrl = new TranslationsController();

// Public reads (no auth required) — the frontend language switcher needs
// these without admin auth. optionalAuth populates req.user when a valid
// admin token IS present, without requiring one: the service uses that to
// show translations of unpublished (draft) sources to admins only — an
// unauthenticated caller only ever sees translations of published sources,
// matching how the source content itself is already gated everywhere else.
translationsRoutes.get("/:entityType/:entityId",        optionalAuth, ctrl.list.bind(ctrl));
translationsRoutes.get("/:entityType/:entityId/:locale", optionalAuth, ctrl.get.bind(ctrl));

// Everything else (status/generate/edit/delete/dashboard) is admin-only.
translationsRoutes.get("/status", authenticate, requireAdmin, ctrl.status.bind(ctrl));
translationsRoutes.post("/dashboard/items", authenticate, requireAdmin, ctrl.dashboardItems.bind(ctrl));
translationsRoutes.get("/dashboard", authenticate, requireAdmin, ctrl.dashboardSummary.bind(ctrl));
translationsRoutes.post("/:entityType/:entityId/:locale/generate", authenticate, requireAdmin, ctrl.generate.bind(ctrl));
translationsRoutes.put("/:entityType/:entityId/:locale", authenticate, requireAdmin, ctrl.update.bind(ctrl));
translationsRoutes.delete("/:entityType/:entityId/:locale", authenticate, requireAdmin, ctrl.remove.bind(ctrl));
