import { Request, Response, NextFunction } from "express";
import { SiteContentService } from "./site-content.service";
import { editorialExporter } from "../editorial-history/export";

const service = new SiteContentService();

/** Who made the change, for the revision log. */
function actorOf(req: Request): string | null {
  return req.user?.email ?? req.user?.userId ?? null;
}

function noteOf(req: Request): string | null {
  const note = req.query.note;
  return typeof note === "string" && note.trim() !== "" ? note.trim().slice(0, 200) : null;
}

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
      const revision = await service.write(key, req.body, { actor: actorOf(req), note: noteOf(req) });
      // `ok: true` is kept so existing Admin callers keep working unchanged.
      res.json({ ok: true, revision });
    } catch (err) { next(err); }
  }

  async history(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const key = req.query.key as string;
      res.json({ key, revisions: await service.history(key) });
    } catch (err) { next(err); }
  }

  async restore(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const key = req.query.key as string;
      const revisionId = (req.body?.revision ?? req.query.revision) as string;
      const revision = await service.restore(key, revisionId, { actor: actorOf(req), note: noteOf(req) });
      res.json({ ok: true, revision });
    } catch (err) { next(err); }
  }

  async reconcile(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const key = req.query.key as string;
      res.json(await service.reconcile(key));
    } catch (err) { next(err); }
  }

  /**
   * Read-only. Reports whether an export exists and whether it still matches
   * the live files — and states plainly that the archive is not off-volume.
   */
  async exportStatus(_req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      res.json(await editorialExporter.status());
    } catch (err) { next(err); }
  }
}
