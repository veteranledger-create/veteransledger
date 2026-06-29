import { Router } from "express";
import { LettersController } from "./letters.controller";
import { authenticate } from "../../middleware/auth.middleware";
import { requireAdmin } from "../../middleware/admin.middleware";
import { createLetterValidator, updateLetterValidator, listLettersValidator } from "../../validators/letter.validator";
import { handleValidation } from "../../utilities/validation";

export const lettersRoutes = Router();
const ctrl = new LettersController();

lettersRoutes.get("/",           authenticate, requireAdmin, listLettersValidator, handleValidation, ctrl.list.bind(ctrl));
lettersRoutes.get("/:id/preview", authenticate, requireAdmin, ctrl.preview.bind(ctrl));
lettersRoutes.get("/:id",         authenticate, requireAdmin, ctrl.get.bind(ctrl));
lettersRoutes.post("/",   authenticate, requireAdmin, createLetterValidator, handleValidation, ctrl.create.bind(ctrl));
lettersRoutes.put("/:id", authenticate, requireAdmin, updateLetterValidator, handleValidation, ctrl.update.bind(ctrl));
lettersRoutes.delete("/:id", authenticate, requireAdmin, ctrl.remove.bind(ctrl));
