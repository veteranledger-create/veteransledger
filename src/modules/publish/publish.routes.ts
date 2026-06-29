import { Router } from "express";
import rateLimit from "express-rate-limit";
import { PublishController } from "./publish.controller";
import { authenticate } from "../../middleware/auth.middleware";
import { requireAdmin } from "../../middleware/admin.middleware";
import { publishTypeValidator } from "../../validators/publish.validator";
import { handleValidation } from "../../utilities/validation";

// Publish/promote/rollback operations are expensive and write to the archive
// filesystem — tightly rate-limit to prevent accidental or abusive bursts.
const publishRateLimit = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many publish operations. Please wait before retrying." },
});

export const publishRoutes = Router();
const ctrl = new PublishController();

publishRoutes.get(
  "/:type/validate",
  authenticate,
  requireAdmin,
  publishTypeValidator,
  handleValidation,
  ctrl.validate.bind(ctrl),
);

publishRoutes.post(
  "/:type/run",
  authenticate,
  requireAdmin,
  publishRateLimit,
  publishTypeValidator,
  handleValidation,
  ctrl.run.bind(ctrl),
);

publishRoutes.get(
  "/:type/history",
  authenticate,
  requireAdmin,
  publishTypeValidator,
  handleValidation,
  ctrl.history.bind(ctrl),
);

publishRoutes.post(
  "/:type/promote",
  authenticate,
  requireAdmin,
  publishRateLimit,
  publishTypeValidator,
  handleValidation,
  ctrl.promote.bind(ctrl),
);

publishRoutes.post(
  "/:type/rollback",
  authenticate,
  requireAdmin,
  publishRateLimit,
  publishTypeValidator,
  handleValidation,
  ctrl.rollback.bind(ctrl),
);
