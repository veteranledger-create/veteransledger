import { Router } from "express";
import rateLimit from "express-rate-limit";
import { SearchController } from "./search.controller";
import { searchValidator } from "../../validators/record.validator";
import { handleValidation } from "../../utilities/validation";
import { optionalAuth } from "../../middleware/auth.middleware";

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

// optionalAuth: public search stays public (the site's own Search page needs
// it unauthenticated) but only ever returns published content unless the
// caller is an authenticated admin — see search.service.ts.
searchRoutes.get("/", searchRateLimit, optionalAuth, searchValidator, handleValidation, ctrl.search.bind(ctrl));
