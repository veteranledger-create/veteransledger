import { Request, Response, NextFunction } from "express";
import { ArmamentsService } from "./armaments.service";
import { resolveRelatedUrl } from "../publish/related-url-resolver";

const service = new ArmamentsService();

export class ArmamentsController {
  async list(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { page = "1", limit = "20", category, nation, search } = req.query;
      res.json(await service.list({ page: +page, limit: +limit, category: category as string, nation: nation as string, search: search as string }));
    } catch (err) { next(err); }
  }

  async get(req: Request, res: Response, next: NextFunction): Promise<void> {
    try { res.json(await service.getById(req.params.id)); } catch (err) { next(err); }
  }

  async create(req: Request, res: Response, next: NextFunction): Promise<void> {
    try { res.status(201).json(await service.create(req.body)); } catch (err) { next(err); }
  }

  async update(req: Request, res: Response, next: NextFunction): Promise<void> {
    try { res.json(await service.update(req.params.id, req.body)); } catch (err) { next(err); }
  }

  async remove(req: Request, res: Response, next: NextFunction): Promise<void> {
    try { await service.delete(req.params.id); res.status(204).send(); } catch (err) { next(err); }
  }

  async updateMedia(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { attach = [], detach = [] } = req.body;
      res.json(await service.updateMedia(req.params.id, attach, detach));
    } catch (err) { next(err); }
  }

  async checkDuplicates(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { category, name, excludeId } = req.query;
      res.json(await service.checkDuplicates(category as string, name as string, excludeId as string | undefined));
    } catch (err) { next(err); }
  }

  async preview(req: Request, res: Response, next: NextFunction): Promise<void> {
    try { res.json(await service.preview(req.params.id)); } catch (err) { next(err); }
  }

  // Always resolves server-side via the same resolveRelatedUrl() every
  // generator uses — the admin UI never constructs a related-record URL
  // itself, which is what structurally prevents the stale/theater-prefixed
  // URL bug class found throughout the migration from ever being
  // reintroduced through Admin.
  resolveUrl(req: Request, res: Response): void {
    const { type, id } = req.query;
    res.json({ url: resolveRelatedUrl(type as string | undefined, id as string) });
  }
}
