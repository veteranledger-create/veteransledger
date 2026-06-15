import { Router } from "express";
import { ArmamentsController } from "./armaments.controller";
import { authenticate } from "../../middleware/auth.middleware";
import { requireAdmin } from "../../middleware/admin.middleware";
import { createArmamentValidator, updateArmamentValidator, listArmamentsValidator } from "../../validators/armament.validator";
import { handleValidation } from "../../utilities/validation";

export const armamentsRoutes = Router();
const ctrl = new ArmamentsController();

armamentsRoutes.get("/",    listArmamentsValidator,  handleValidation, ctrl.list.bind(ctrl));
armamentsRoutes.get("/:id", ctrl.get.bind(ctrl));
armamentsRoutes.post("/",   authenticate, requireAdmin, createArmamentValidator, handleValidation, ctrl.create.bind(ctrl));
armamentsRoutes.put("/:id", authenticate, requireAdmin, updateArmamentValidator, handleValidation, ctrl.update.bind(ctrl));
armamentsRoutes.delete("/:id", authenticate, requireAdmin, ctrl.remove.bind(ctrl));
