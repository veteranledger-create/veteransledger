import { Request, Response, NextFunction } from "express";
import { AppError } from "./error.middleware";
import { logger } from "./logger.middleware";

export function requireAdmin(req: Request, _res: Response, next: NextFunction): void {
  if (!req.user) {
    next(new AppError(401, "Authentication required"));
    return;
  }
  if (req.user.role !== "ADMIN" && req.user.role !== "SUPER_ADMIN") {
    logger.warn("Privilege violation: admin required", {
      userId: req.user.userId,
      role: req.user.role,
      ip: req.ip,
      url: req.originalUrl,
      method: req.method,
    });
    next(new AppError(403, "Administrator access required"));
    return;
  }
  next();
}

export function requireSuperAdmin(req: Request, _res: Response, next: NextFunction): void {
  if (!req.user) {
    next(new AppError(401, "Authentication required"));
    return;
  }
  if (req.user.role !== "SUPER_ADMIN") {
    logger.warn("Privilege violation: super-admin required", {
      userId: req.user.userId,
      role: req.user.role,
      ip: req.ip,
      url: req.originalUrl,
      method: req.method,
    });
    next(new AppError(403, "Super-administrator access required"));
    return;
  }
  next();
}
