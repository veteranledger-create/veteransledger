import { Router } from "express";
import rateLimit from "express-rate-limit";
import { AuthController } from "./auth.controller";
import { authenticate } from "../../middleware/auth.middleware";
import { loginValidator } from "../../validators/auth.validator";
import { handleValidation } from "../../utilities/validation";

// Strict per-IP limiter for login — 10 attempts per 15 minutes to block brute force
const loginRateLimit = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many login attempts. Please wait 15 minutes before trying again." },
  skipSuccessfulRequests: false,
});

// Moderate limiter for token refresh — prevents token-farming
const refreshRateLimit = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many token refresh requests." },
});

export const authRoutes = Router();
const ctrl = new AuthController();

authRoutes.post("/login", loginRateLimit, loginValidator, handleValidation, ctrl.login.bind(ctrl));
authRoutes.post("/logout", authenticate, ctrl.logout.bind(ctrl));
authRoutes.get("/me", authenticate, ctrl.me.bind(ctrl));
authRoutes.post("/refresh", refreshRateLimit, ctrl.refresh.bind(ctrl));
