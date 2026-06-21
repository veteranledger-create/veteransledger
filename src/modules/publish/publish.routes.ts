import { Router } from "express";
import { PublishController } from "./publish.controller";
import { authenticate } from "../../middleware/auth.middleware";
import { requireAdmin } from "../../middleware/admin.middleware";
import { publishTypeValidator } from "../../validators/publish.validator";
import { handleValidation } from "../../utilities/validation";

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
  publishTypeValidator,
  handleValidation,
  ctrl.run.bind(ctrl),
);
