import { Router } from "express";
import { reserved } from "./not-implemented";

/**
 * Reserved route surface for future Community Comments — see
 * docs/community-architecture.md. Comments and replies share one model
 * (CommunityComment.parentId), so there is no separate replies router.
 */
export const commentsRoutes = Router();

commentsRoutes.get("/", reserved("Listing comments for a post"));       // ?postId=
commentsRoutes.get("/:id", reserved("Fetching a comment or reply"));
commentsRoutes.post("/", reserved("Creating a comment or reply"));     // body.parentId set => reply
commentsRoutes.patch("/:id", reserved("Editing a comment or reply"));
commentsRoutes.delete("/:id", reserved("Deleting a comment or reply"));
