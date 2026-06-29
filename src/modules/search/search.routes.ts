import { Router } from "express";
import rateLimit from "express-rate-limit";
import { SearchController } from "./search.controller";
import { searchValidator } from "../../validators/record.validator";
import { handleValidation } from "../../utilities/validation";

// Full-text DB search is expensive — cap at 60 requests per minute per IP
const searchRateLimit = rateLimit({
  windowMs: 60 * 1000,
  max: 60,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many search requests. Please slow down." },
});

export const searchRoutes = Router();
const ctrl = new SearchController();

searchRoutes.get("/", searchRateLimit, searchValidator, handleValidation, ctrl.search.bind(ctrl));
