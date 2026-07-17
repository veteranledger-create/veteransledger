import { Request, Response, NextFunction } from "express";
import { AppError } from "../../middleware/error.middleware";

/**
 * Every Community route resolves here for now. The route surface these
 * handlers sit behind IS the reserved future API contract (see
 * docs/community-architecture.md) — intentionally inert per "Production
 * Architecture — Community System Foundation" (architecture-only phase).
 */
export function reserved(feature: string) {
  return (_req: Request, _res: Response, next: NextFunction): void => {
    next(new AppError(501, `${feature} is reserved for the future Community system and is not implemented yet.`));
  };
}
