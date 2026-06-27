import { Request, Response, NextFunction } from "express";
import { SiteContentService } from "./site-content.service";

const service = new SiteContentService();

export class SiteContentController {
  async read(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const key = req.query.key as string;
      res.json(await service.read(key));
    } catch (err) { next(err); }
  }

  async write(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const key = req.query.key as string;
      await service.write(key, req.body);
      res.json({ ok: true });
    } catch (err) { next(err); }
  }
}
