import { Router } from "express";
import { RecordsController } from "./records.controller";
import { authenticate } from "../../middleware/auth.middleware";
import { requireAdmin } from "../../middleware/admin.middleware";
import { createRecordValidator, updateRecordValidator, listRecordsValidator } from "../../validators/record.validator";
import { handleValidation } from "../../utilities/validation";

export const recordsRoutes = Router();
const ctrl = new RecordsController();

recordsRoutes.get("/",           authenticate, requireAdmin, listRecordsValidator, handleValidation, ctrl.list.bind(ctrl));
recordsRoutes.get("/:id/preview", authenticate, requireAdmin, ctrl.preview.bind(ctrl));
recordsRoutes.get("/:id",         authenticate, requireAdmin, ctrl.get.bind(ctrl));
recordsRoutes.post("/",           authenticate, requireAdmin, createRecordValidator, handleValidation, ctrl.create.bind(ctrl));
recordsRoutes.put("/:id",         authenticate, requireAdmin, updateRecordValidator, handleValidation, ctrl.update.bind(ctrl));
recordsRoutes.delete("/:id",      authenticate, requireAdmin, ctrl.remove.bind(ctrl));
