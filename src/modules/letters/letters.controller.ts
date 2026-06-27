import { Request, Response, NextFunction } from "express";
import { LettersService } from "./letters.service";

const service = new LettersService();

export class LettersController {
  async list(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { page = "1", limit = "20", language, search } = req.query;
      res.json(await service.list({ page: +page, limit: +limit, language: language as string, search: search as string }));
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

  async preview(req: Request, res: Response, next: NextFunction): Promise<void> {
    try { res.json(await service.preview(req.params.id)); } catch (err) { next(err); }
  }
}
