import { Router } from "express";
import { reserved } from "./not-implemented";

/**
 * Reserved route surface for future Community Posts — see
 * docs/community-architecture.md for the full contract.
 *
 * No auth middleware yet: public community-member authentication doesn't
 * exist yet and is a separate future concern from the existing admin JWT
 * auth (authenticate/requireAdmin), which only guards moderation and
 * report-review endpoints elsewhere in this module.
 */
export const postsRoutes = Router();

postsRoutes.get("/", reserved("Listing community posts"));
postsRoutes.get("/by-record/:entityType/:entityId", reserved("Listing discussion posts for an archive record"));
postsRoutes.get("/:id", reserved("Fetching a community post"));
postsRoutes.post("/", reserved("Creating a community post"));
postsRoutes.patch("/:id", reserved("Editing a community post"));
postsRoutes.delete("/:id", reserved("Deleting a community post"));
