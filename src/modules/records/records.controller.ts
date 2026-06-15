import { Request, Response, NextFunction } from "express";
import { RecordsService } from "./records.service";

const service = new RecordsService();

export class RecordsController {
  async list(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { page = "1", limit = "20", type, search } = req.query;
      res.json(await service.list({ page: +page, limit: +limit, type: type as string, search: search as string }));
    } catch (err) { next(err); }
  }

  async get(req: Request, res: Response, next: NextFunction): Promise<void> {
    try { res.json(await service.getById(req.params.id)); } catch (err) { next(err); }
  }

  async create(req: Request, res: Response, next: NextFunction): Promise<void> {
    try { res.status(201).json(await service.create(req.body, req.user!.userId)); } catch (err) { next(err); }
  }

  async update(req: Request, res: Response, next: NextFunction): Promise<void> {
    try { res.json(await service.update(req.params.id, req.body, req.user!.userId)); } catch (err) { next(err); }
  }

  async remove(req: Request, res: Response, next: NextFunction): Promise<void> {
    try { await service.delete(req.params.id, req.user!.userId); res.status(204).send(); } catch (err) { next(err); }
  }
}
