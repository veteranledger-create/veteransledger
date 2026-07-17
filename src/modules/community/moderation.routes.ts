import { Router } from "express";
import { reserved } from "./not-implemented";
import { authenticate } from "../../middleware/auth.middleware";
import { requireAdmin } from "../../middleware/admin.middleware";

/**
 * Reserved route surface for future Community Moderation — see
 * docs/community-architecture.md. Every route here is admin-only, reusing
 * the existing admin JWT auth (same pattern as translations/publish).
 */
export const moderationRoutes = Router();

moderationRoutes.get("/actions", authenticate, requireAdmin, reserved("Listing moderation actions"));
moderationRoutes.post("/actions", authenticate, requireAdmin, reserved("Recording a moderation action"));
