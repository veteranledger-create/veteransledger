import { Router } from "express";
import { ArticlesController } from "./articles.controller";
import { authenticate } from "../../middleware/auth.middleware";
import { requireAdmin } from "../../middleware/admin.middleware";
import { createArticleValidator, updateArticleValidator, listArticlesValidator } from "../../validators/article.validator";
import { handleValidation } from "../../utilities/validation";

export const articlesRoutes = Router();
const ctrl = new ArticlesController();

articlesRoutes.get("/",           listArticlesValidator, handleValidation, ctrl.list.bind(ctrl));
articlesRoutes.get("/:id/preview", authenticate, requireAdmin, ctrl.preview.bind(ctrl));
articlesRoutes.get("/:id",         ctrl.get.bind(ctrl));
articlesRoutes.post("/",   authenticate, requireAdmin, createArticleValidator, handleValidation, ctrl.create.bind(ctrl));
articlesRoutes.put("/:id", authenticate, requireAdmin, updateArticleValidator, handleValidation, ctrl.update.bind(ctrl));
articlesRoutes.delete("/:id", authenticate, requireAdmin, ctrl.remove.bind(ctrl));
