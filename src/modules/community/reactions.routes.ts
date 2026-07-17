import { Router } from "express";
import { reserved } from "./not-implemented";

/**
 * Reserved route surface for future Community Reactions — see
 * docs/community-architecture.md. Reaction types (Helpful, Informative,
 * Well Researched, Needs Verification) live in community.types.ts.
 */
export const reactionsRoutes = Router();

reactionsRoutes.get("/", reserved("Listing reactions for a post or comment"));  // ?targetType=&targetId=
reactionsRoutes.post("/", reserved("Adding a reaction"));
reactionsRoutes.delete("/:id", reserved("Removing a reaction"));
