import { Router } from "express";
import { postsRoutes } from "./posts.routes";
import { commentsRoutes } from "./comments.routes";
import { reactionsRoutes } from "./reactions.routes";
import { reportsRoutes } from "./reports.routes";
import { notificationsRoutes } from "./notifications.routes";
import { moderationRoutes } from "./moderation.routes";
import { profilesRoutes } from "./profiles.routes";

/**
 * Community System — reserved foundation, mounted at /api/community.
 * Every route currently responds 501 (see ./not-implemented.ts) until
 * Posts/Comments/Reactions/Reports/Notifications/Moderation/Profiles are
 * built on top of this scaffold. Full contract documented in
 * docs/community-architecture.md. Deliberately independent from every
 * archive module (armaments, personnel, letters, ...) — nothing here
 * imports from or is imported by them.
 */
export const communityRoutes = Router();

communityRoutes.use("/posts", postsRoutes);
communityRoutes.use("/comments", commentsRoutes);
communityRoutes.use("/reactions", reactionsRoutes);
communityRoutes.use("/reports", reportsRoutes);
communityRoutes.use("/notifications", notificationsRoutes);
communityRoutes.use("/moderation", moderationRoutes);
communityRoutes.use("/profiles", profilesRoutes);
