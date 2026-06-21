import { Request, Response, NextFunction } from "express";
import { PublishService } from "./publish.service";

const service = new PublishService();

export class PublishController {
  async validate(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      res.json(await service.validate(req.params.type, req.user!.userId));
    } catch (err) {
      next(err);
    }
  }

  async run(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      res.json(await service.run(req.params.type, req.user!.userId));
    } catch (err) {
      next(err);
    }
  }
}
