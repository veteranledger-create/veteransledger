import { Request, Response, NextFunction } from "express";
import { TranslationsService } from "./translations.service";

const service = new TranslationsService();

export class TranslationsController {
  /** GET /api/translations/:entityType/:entityId — all locales for one record */
  async list(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { entityType, entityId } = req.params;
      res.json(await service.list(entityType, entityId));
    } catch (err) { next(err); }
  }

  /** GET /api/translations/:entityType/:entityId/:locale — single locale */
  async get(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { entityType, entityId, locale } = req.params;
      const t = await service.get(entityType, entityId, locale);
      if (!t) { res.status(404).json({ error: "Translation not found" }); return; }
      res.json(t);
    } catch (err) { next(err); }
  }

  /** POST /api/translations/:entityType/:entityId/:locale/generate */
  async generate(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { entityType, entityId, locale } = req.params;
      const { force, rawContent } = req.body ?? {};
      res.status(201).json(
        await service.generate(entityType, entityId, locale, { force: !!force, rawContent }),
      );
    } catch (err) { next(err); }
  }

  /** PUT /api/translations/:entityType/:entityId/:locale */
  async update(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { entityType, entityId, locale } = req.params;
      const { fields, status } = req.body ?? {};
      if (!fields || typeof fields !== "object") {
        res.status(400).json({ error: "fields object is required" });
        return;
      }
      const validStatus =
        status === "human" ? "human" : status === "published" ? "published" : "machine";
      res.json(await service.update(entityType, entityId, locale, fields, validStatus));
    } catch (err) { next(err); }
  }

  /** DELETE /api/translations/:entityType/:entityId/:locale */
  async remove(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { entityType, entityId, locale } = req.params;
      await service.delete(entityType, entityId, locale);
      res.status(204).send();
    } catch (err) { next(err); }
  }

  /** GET /api/translations/status — is automatic machine translation available? */
  async status(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      res.json(service.availability());
    } catch (err) { next(err); }
  }

  /** GET /api/translations/dashboard — coverage summary across entity types */
  async dashboardSummary(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      res.json(await service.dashboardSummary());
    } catch (err) { next(err); }
  }

  /** POST /api/translations/dashboard/items — per-locale status for a batch of entityIds */
  async dashboardItems(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { entityType, entityIds } = req.body ?? {};
      if (!entityType || !Array.isArray(entityIds)) {
        res.status(400).json({ error: "entityType and entityIds[] are required" });
        return;
      }
      res.json(await service.getItemStatuses(entityType, entityIds.slice(0, 500)));
    } catch (err) { next(err); }
  }
}
