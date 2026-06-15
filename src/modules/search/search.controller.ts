import { Request, Response, NextFunction } from "express";
import { SearchService } from "./search.service";

const service = new SearchService();

export class SearchController {
  async search(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { q = "", type, page = "1", limit = "20" } = req.query;
      res.json(await service.search({ query: q as string, type: type as string, page: +page, limit: +limit }));
    } catch (err) { next(err); }
  }
}
