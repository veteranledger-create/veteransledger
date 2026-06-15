import { Request, Response, NextFunction } from "express";
import { MediaService } from "./media.service";

const service = new MediaService();

export class MediaController {
  async list(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { page = "1", limit = "20", type } = req.query;
      res.json(await service.list({ page: +page, limit: +limit, type: type as string }));
    } catch (err) { next(err); }
  }

  async get(req: Request, res: Response, next: NextFunction): Promise<void> {
    try { res.json(await service.getById(req.params.id)); } catch (err) { next(err); }
  }

  async upload(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      if (!req.file) throw new Error("No file uploaded");
      res.status(201).json(await service.processUpload(req.file, req.user!.userId));
    } catch (err) { next(err); }
  }

  async remove(req: Request, res: Response, next: NextFunction): Promise<void> {
    try { await service.delete(req.params.id); res.status(204).send(); } catch (err) { next(err); }
  }
}
