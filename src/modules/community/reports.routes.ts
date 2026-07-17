import { Router } from "express";
import { reserved } from "./not-implemented";
import { authenticate } from "../../middleware/auth.middleware";
import { requireAdmin } from "../../middleware/admin.middleware";

/**
 * Reserved route surface for future Community Reports — see
 * docs/community-architecture.md. Submitting a report is a public action
 * (any visitor can flag abuse); reviewing the report queue is admin-only,
 * reusing the existing admin JWT auth (same as every other admin-guarded
 * module in this app).
 */
export const reportsRoutes = Router();

reportsRoutes.post("/", reserved("Submitting an abuse report"));
reportsRoutes.get("/", authenticate, requireAdmin, reserved("Listing abuse reports"));
reportsRoutes.patch("/:id", authenticate, requireAdmin, reserved("Resolving an abuse report"));
