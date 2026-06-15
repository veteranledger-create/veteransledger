import { Request, Response, NextFunction } from "express";
import { DashboardService } from "./dashboard.service";

const service = new DashboardService();

export class DashboardController {
  async getStats(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      res.json(await service.getStats());
    } catch (err) {
      next(err);
    }
  }

  async getRecentActivity(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      res.json(await service.getRecentActivity());
    } catch (err) {
      next(err);
    }
  }
}
