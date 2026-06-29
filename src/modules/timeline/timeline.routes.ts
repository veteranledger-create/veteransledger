import { Router } from "express";
import { TimelineController } from "./timeline.controller";
import { authenticate } from "../../middleware/auth.middleware";
import { requireAdmin } from "../../middleware/admin.middleware";
import { createTimelineEventValidator, updateTimelineEventValidator, listTimelineValidator } from "../../validators/timeline.validator";
import { handleValidation } from "../../utilities/validation";

export const timelineRoutes = Router();
const ctrl = new TimelineController();

timelineRoutes.get("/", authenticate, requireAdmin, listTimelineValidator, handleValidation, ctrl.list.bind(ctrl));
timelineRoutes.get("/:id", authenticate, requireAdmin, ctrl.get.bind(ctrl));
timelineRoutes.post("/", authenticate, requireAdmin, createTimelineEventValidator, handleValidation, ctrl.create.bind(ctrl));
timelineRoutes.put("/:id", authenticate, requireAdmin, updateTimelineEventValidator, handleValidation, ctrl.update.bind(ctrl));
timelineRoutes.delete("/:id", authenticate, requireAdmin, ctrl.remove.bind(ctrl));
