import path from "path";
import { config } from "./app";

export const storageConfig = {
  basePath: config.storage.path,
  maxFileSize: config.storage.maxFileSize,

  directories: {
    images: path.join(config.storage.path, "images"),
    documents: path.join(config.storage.path, "documents"),
    audio: path.join(config.storage.path, "audio"),
    video: path.join(config.storage.path, "video"),
    thumbnails: path.join(config.storage.path, "thumbnails"),
    temporary: path.join(config.storage.path, "temporary"),
    publishStaging: path.join(config.storage.path, "publish-staging"),
    publishReports: path.join(config.storage.path, "publish-reports"),
    importReports: path.join(config.storage.path, "import-reports"),
    publishSnapshots: path.join(config.storage.path, "publish-snapshots"),
    publishHistory: path.join(config.storage.path, "publish-history"),
  },

  allowedMimeTypes: {
    images: ["image/jpeg", "image/png", "image/webp", "image/gif", "image/svg+xml"],
    documents: ["application/pdf", "application/msword", "text/plain"],
    audio: ["audio/mpeg", "audio/wav", "audio/ogg"],
    video: ["video/mp4", "video/webm"],
  },

  thumbnailSizes: {
    small: { width: 150, height: 150 },
    medium: { width: 400, height: 300 },
    large: { width: 800, height: 600 },
  },
};
