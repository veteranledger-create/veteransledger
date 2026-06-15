import { Router } from "express";
import { SearchController } from "./search.controller";
import { searchValidator } from "../../validators/record.validator";
import { handleValidation } from "../../utilities/validation";

export const searchRoutes = Router();
const ctrl = new SearchController();

searchRoutes.get("/", searchValidator, handleValidation, ctrl.search.bind(ctrl));
