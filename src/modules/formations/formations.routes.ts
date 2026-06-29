import { Router } from "express";
import { FormationsController } from "./formations.controller";
import { authenticate } from "../../middleware/auth.middleware";
import { requireAdmin } from "../../middleware/admin.middleware";
import { createFormationValidator, updateFormationValidator, listFormationsValidator } from "../../validators/formation.validator";
import { handleValidation } from "../../utilities/validation";

export const formationsRoutes = Router();
const ctrl = new FormationsController();

formationsRoutes.get("/",            authenticate, requireAdmin, listFormationsValidator, handleValidation, ctrl.list.bind(ctrl));
formationsRoutes.get("/:id/preview", authenticate, requireAdmin, ctrl.preview.bind(ctrl));
formationsRoutes.get("/:id",         authenticate, requireAdmin, ctrl.get.bind(ctrl));
formationsRoutes.post("/",    authenticate, requireAdmin, createFormationValidator, handleValidation, ctrl.create.bind(ctrl));
formationsRoutes.put("/:id",  authenticate, requireAdmin, updateFormationValidator, handleValidation, ctrl.update.bind(ctrl));
formationsRoutes.delete("/:id", authenticate, requireAdmin, ctrl.remove.bind(ctrl));
