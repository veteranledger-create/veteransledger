import { Router } from "express";
import { reserved } from "./not-implemented";

/**
 * Reserved route surface for future Community Member Profiles — see
 * docs/community-architecture.md. CommunityMember is a distinct identity
 * from the admin User model (see prisma/schema.prisma); its auth is a
 * future concern, so no auth middleware is attached yet.
 */
export const profilesRoutes = Router();

profilesRoutes.get("/:id", reserved("Fetching a community member profile"));
profilesRoutes.patch("/:id", reserved("Editing a community member profile"));
