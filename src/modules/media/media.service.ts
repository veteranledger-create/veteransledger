import prisma from "../../database/prisma";
import { AppError } from "../../middleware/error.middleware";
import { logger } from "../../middleware/logger.middleware";
import fs from "fs";
import path from "path";
import sharp from "sharp";
import { config } from "../../config/app";

interface ListOptions { page: number; limit: number; type?: string; }

export class MediaService {
  private readonly imagesDir = path.join(config.storage.path, "images");
  private readonly thumbsDir = path.join(config.storage.path, "thumbnails");

  async list({ page, limit, type }: ListOptions) {
    const skip = (page - 1) * limit;
    const where = type ? { mimeType: { startsWith: type } } : {};
    const [data, total] = await Promise.all([
      prisma.mediaAsset.findMany({ where, skip, take: limit, orderBy: { createdAt: "desc" } }),
      prisma.mediaAsset.count({ where }),
    ]);
    return { data, total, page, limit, pages: Math.ceil(total / limit) };
  }

  async getById(id: string) {
    const asset = await prisma.mediaAsset.findUnique({ where: { id } });
    if (!asset) throw new AppError(404, "Media asset not found");
    return asset;
  }

  async processUpload(file: Express.Multer.File, userId: string) {
    fs.mkdirSync(this.imagesDir, { recursive: true });
    fs.mkdirSync(this.thumbsDir, { recursive: true });

    const dest = path.join(this.imagesDir, file.filename);
    fs.renameSync(file.path, dest);

    let thumbnailUrl: string | null = null;

    // Generate thumbnail for images
    if (file.mimetype.startsWith("image/") && file.mimetype !== "image/svg+xml") {
      try {
        const thumbName = `thumb_${file.filename.replace(/\.[^.]+$/, ".webp")}`;
        const thumbPath = path.join(this.thumbsDir, thumbName);

        await sharp(dest)
          .resize(400, 300, { fit: "cover", position: "attention" })
          .webp({ quality: 80 })
          .toFile(thumbPath);

        thumbnailUrl = `/storage/thumbnails/${thumbName}`;
      } catch (err) {
        logger.warn("Thumbnail generation failed", { file: file.filename, error: String(err) });
      }
    }

    const asset = await prisma.mediaAsset.create({
      data: {
        filename: file.filename,
        originalName: file.originalname,
        mimeType: file.mimetype,
        size: file.size,
        path: dest,
        url: `/storage/images/${file.filename}`,
        thumbnailUrl,
        uploadedById: userId,
      },
    });

    await prisma.auditLog.create({
      data: { userId, action: "UPLOAD", entity: "MediaAsset", entityId: asset.id },
    });

    return asset;
  }

  async delete(id: string) {
    const asset = await prisma.mediaAsset.findUnique({ where: { id } });
    if (!asset) throw new AppError(404, "Media asset not found");

    if (fs.existsSync(asset.path)) fs.unlinkSync(asset.path);

    if (asset.thumbnailUrl) {
      const thumbPath = path.join(config.storage.path, asset.thumbnailUrl.replace("/storage/", ""));
      if (fs.existsSync(thumbPath)) fs.unlinkSync(thumbPath);
    }

    await prisma.mediaAsset.delete({ where: { id } });
  }
}
