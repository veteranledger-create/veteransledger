import { Router } from "express";
import { AuthController } from "./auth.controller";
import { authenticate } from "../../middleware/auth.middleware";
import { loginValidator } from "../../validators/auth.validator";
import { handleValidation } from "../../utilities/validation";

export const authRoutes = Router();
const ctrl = new AuthController();

authRoutes.post("/login", loginValidator, handleValidation, ctrl.login.bind(ctrl));
authRoutes.post("/logout", authenticate, ctrl.logout.bind(ctrl));
authRoutes.get("/me", authenticate, ctrl.me.bind(ctrl));
authRoutes.post("/refresh", ctrl.refresh.bind(ctrl));
