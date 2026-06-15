import { Router } from "express";
import { CampaignsController } from "./campaigns.controller";
import { authenticate } from "../../middleware/auth.middleware";
import { requireAdmin } from "../../middleware/admin.middleware";
import { createCampaignValidator, updateCampaignValidator, listCampaignsValidator } from "../../validators/campaign.validator";
import { handleValidation } from "../../utilities/validation";

export const campaignsRoutes = Router();
const ctrl = new CampaignsController();

campaignsRoutes.get("/",    listCampaignsValidator,  handleValidation, ctrl.list.bind(ctrl));
campaignsRoutes.get("/:id", ctrl.get.bind(ctrl));
campaignsRoutes.post("/",   authenticate, requireAdmin, createCampaignValidator, handleValidation, ctrl.create.bind(ctrl));
campaignsRoutes.put("/:id", authenticate, requireAdmin, updateCampaignValidator, handleValidation, ctrl.update.bind(ctrl));
campaignsRoutes.delete("/:id", authenticate, requireAdmin, ctrl.remove.bind(ctrl));
