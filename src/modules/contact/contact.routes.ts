import { Router } from "express";
import { ContactController } from "./contact.controller";
import { contactValidator } from "../../validators/contact.validator";
import { handleValidation } from "../../utilities/validation";
import rateLimit from "express-rate-limit";

export const contactRoutes = Router();
const ctrl = new ContactController();

const contactLimit = rateLimit({ windowMs: 3600000, max: 5, message: { error: "Too many contact requests. Please wait before sending again." } });

contactRoutes.post("/", contactLimit, contactValidator, handleValidation, ctrl.send.bind(ctrl));
