import { Router } from "express";
import { MediaController } from "./media.controller";
import { authenticate } from "../../middleware/auth.middleware";
import { requireAdmin } from "../../middleware/admin.middleware";
import { AppError } from "../../middleware/error.middleware";
import multer from "multer";
import path from "path";
import { config } from "../../config/app";

const ALLOWED_MIME_TYPES = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/gif",
  "image/svg+xml",
  "application/pdf",
  "application/msword",
  "text/plain",
  "audio/mpeg",
  "audio/wav",
  "audio/ogg",
  "video/mp4",
  "video/webm",
]);

const storage = multer.diskStorage({
  destination: path.join(config.storage.path, "temporary"),
  filename: (_req, file, cb) =>
    cb(null, `${Date.now()}-${Math.random().toString(36).slice(2)}${path.extname(file.originalname)}`),
});

const upload = multer({
  storage,
  limits: { fileSize: config.storage.maxFileSize },
  fileFilter: (_req, file, cb) => {
    if (ALLOWED_MIME_TYPES.has(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new AppError(415, `Unsupported file type: ${file.mimetype}`));
    }
  },
});

export const mediaRoutes = Router();
const ctrl = new MediaController();

mediaRoutes.get("/", ctrl.list.bind(ctrl));
mediaRoutes.get("/:id", ctrl.get.bind(ctrl));
mediaRoutes.post("/upload", authenticate, requireAdmin, upload.single("file"), ctrl.upload.bind(ctrl));
mediaRoutes.delete("/:id", authenticate, requireAdmin, ctrl.remove.bind(ctrl));
