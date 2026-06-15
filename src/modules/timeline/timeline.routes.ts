import { Router } from "express";
import { TimelineController } from "./timeline.controller";
import { authenticate } from "../../middleware/auth.middleware";
import { requireAdmin } from "../../middleware/admin.middleware";

export const timelineRoutes = Router();
const ctrl = new TimelineController();

timelineRoutes.get("/", ctrl.list.bind(ctrl));
timelineRoutes.get("/:id", ctrl.get.bind(ctrl));
timelineRoutes.post("/", authenticate, requireAdmin, ctrl.create.bind(ctrl));
timelineRoutes.put("/:id", authenticate, requireAdmin, ctrl.update.bind(ctrl));
timelineRoutes.delete("/:id", authenticate, requireAdmin, ctrl.remove.bind(ctrl));
