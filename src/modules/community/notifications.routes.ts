import { Router } from "express";
import { reserved } from "./not-implemented";

/**
 * Reserved route surface for future Community Notifications — see
 * docs/community-architecture.md. Notifications belong to a
 * CommunityMember, not an admin User, so no admin auth is attached here;
 * a future community-member auth session will replace the :memberId param.
 */
export const notificationsRoutes = Router();

notificationsRoutes.get("/:memberId", reserved("Listing notifications for a community member"));
notificationsRoutes.patch("/:id/read", reserved("Marking a notification as read"));
