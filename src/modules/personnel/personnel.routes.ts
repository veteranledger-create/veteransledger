import { Router } from "express";
import { PersonnelController } from "./personnel.controller";
import { authenticate } from "../../middleware/auth.middleware";
import { requireAdmin } from "../../middleware/admin.middleware";
import { createPersonnelValidator, updatePersonnelValidator, listPersonnelValidator } from "../../validators/personnel.validator";
import { handleValidation } from "../../utilities/validation";

export const personnelRoutes = Router();
const ctrl = new PersonnelController();

personnelRoutes.get("/",    listPersonnelValidator,  handleValidation, ctrl.list.bind(ctrl));
personnelRoutes.get("/:id", ctrl.get.bind(ctrl));
personnelRoutes.post("/",   authenticate, requireAdmin, createPersonnelValidator, handleValidation, ctrl.create.bind(ctrl));
personnelRoutes.put("/:id", authenticate, requireAdmin, updatePersonnelValidator, handleValidation, ctrl.update.bind(ctrl));
personnelRoutes.delete("/:id", authenticate, requireAdmin, ctrl.remove.bind(ctrl));
