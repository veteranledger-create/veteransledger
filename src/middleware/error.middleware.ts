import { Request, Response, NextFunction } from "express";
import { logger } from "./logger.middleware";
import { config } from "../config/app";

export class AppError extends Error {
  constructor(
    public statusCode: number,
    message: string,
    public isOperational = true
  ) {
    super(message);
    this.name = "AppError";
    Error.captureStackTrace(this, this.constructor);
  }
}

export function errorHandler(
  err: Error,
  req: Request,
  res: Response,
  _next: NextFunction
): void {
  if (err instanceof AppError) {
    res.status(err.statusCode).json({
      error: err.message,
      ...(config.isDevelopment && { stack: err.stack }),
    });
    return;
  }

  logger.error({ message: err.message, stack: err.stack, url: req.originalUrl });

  res.status(500).json({
    error: "Internal server error",
    ...(config.isDevelopment && { details: err.message, stack: err.stack }),
  });
}

export function notFoundHandler(_req: Request, res: Response): void {
  res.status(404).json({ error: "Not found" });
}
