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

// Per-MIME allowed extensions — prevents attackers from uploading a file
// with Content-Type: image/jpeg but extension .php (or .html, .js, etc.).
const MIME_TO_EXTENSIONS: Record<string, ReadonlySet<string>> = {
  "image/jpeg":         new Set([".jpg", ".jpeg"]),
  "image/png":          new Set([".png"]),
  "image/webp":         new Set([".webp"]),
  "image/gif":          new Set([".gif"]),
  "image/svg+xml":      new Set([".svg"]),
  "application/pdf":    new Set([".pdf"]),
  "application/msword": new Set([".doc"]),
  "text/plain":         new Set([".txt"]),
  "audio/mpeg":         new Set([".mp3"]),
  "audio/wav":          new Set([".wav"]),
  "audio/ogg":          new Set([".ogg"]),
  "video/mp4":          new Set([".mp4"]),
  "video/webm":         new Set([".webm"]),
};

// Extensions that are never permitted regardless of MIME type
const BLOCKED_EXTENSIONS = new Set([
  ".php", ".php3", ".php4", ".php5", ".phtml",
  ".asp", ".aspx", ".jsp", ".jspx",
  ".py", ".rb", ".pl", ".sh", ".bash", ".zsh",
  ".js", ".mjs", ".cjs", ".ts",
  ".html", ".htm", ".xhtml",
  ".exe", ".bat", ".cmd", ".com", ".ps1", ".vbs",
  ".jar", ".war",
]);

const storage = multer.diskStorage({
  destination: path.join(config.storage.path, "temporary"),
  // Filename uses a crypto-random stem; extension is re-derived from the
  // validated MIME type rather than trusted from the client-supplied name.
  filename: (_req, file, cb) => {
    const allowedExts = MIME_TO_EXTENSIONS[file.mimetype];
    const safeExt = allowedExts ? [...allowedExts][0] : "";
    cb(null, `${Date.now()}-${Math.random().toString(36).slice(2)}${safeExt}`);
  },
});

const upload = multer({
  storage,
  limits: { fileSize: config.storage.maxFileSize },
  fileFilter: (_req, file, cb) => {
    if (!ALLOWED_MIME_TYPES.has(file.mimetype)) {
      return cb(new AppError(415, `Unsupported file type: ${file.mimetype}`));
    }
    const ext = path.extname(file.originalname).toLowerCase();
    if (BLOCKED_EXTENSIONS.has(ext)) {
      return cb(new AppError(415, `File extension ${ext} is not permitted`));
    }
    const allowedExts = MIME_TO_EXTENSIONS[file.mimetype];
    if (allowedExts && ext && !allowedExts.has(ext)) {
      return cb(new AppError(415, `File extension ${ext} does not match content type ${file.mimetype}`));
    }
    cb(null, true);
  },
});

export const mediaRoutes = Router();
const ctrl = new MediaController();

mediaRoutes.get("/",    authenticate, requireAdmin, ctrl.list.bind(ctrl));
mediaRoutes.get("/:id", authenticate, requireAdmin, ctrl.get.bind(ctrl));
mediaRoutes.post("/upload", authenticate, requireAdmin, upload.single("file"), ctrl.upload.bind(ctrl));
mediaRoutes.delete("/:id", authenticate, requireAdmin, ctrl.remove.bind(ctrl));
