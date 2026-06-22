import { Router } from "express";
import { ArmamentsController } from "./armaments.controller";
import { authenticate } from "../../middleware/auth.middleware";
import { requireAdmin } from "../../middleware/admin.middleware";
import { createArmamentValidator, updateArmamentValidator, listArmamentsValidator } from "../../validators/armament.validator";
import { handleValidation } from "../../utilities/validation";

export const armamentsRoutes = Router();
const ctrl = new ArmamentsController();

armamentsRoutes.get("/",    listArmamentsValidator,  handleValidation, ctrl.list.bind(ctrl));
armamentsRoutes.get("/check-duplicates", authenticate, requireAdmin, ctrl.checkDuplicates.bind(ctrl));
armamentsRoutes.get("/resolve-url", authenticate, requireAdmin, ctrl.resolveUrl.bind(ctrl));
armamentsRoutes.get("/:id", ctrl.get.bind(ctrl));
armamentsRoutes.get("/:id/preview", authenticate, requireAdmin, ctrl.preview.bind(ctrl));
armamentsRoutes.post("/",   authenticate, requireAdmin, createArmamentValidator, handleValidation, ctrl.create.bind(ctrl));
armamentsRoutes.put("/:id", authenticate, requireAdmin, updateArmamentValidator, handleValidation, ctrl.update.bind(ctrl));
armamentsRoutes.put("/:id/media", authenticate, requireAdmin, ctrl.updateMedia.bind(ctrl));
armamentsRoutes.delete("/:id", authenticate, requireAdmin, ctrl.remove.bind(ctrl));
