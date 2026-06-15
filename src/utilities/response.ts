import { Response } from "express";
import { ApiSuccess, ApiError } from "../types/index";

export function sendSuccess<T>(res: Response, data: T, statusCode = 200, meta?: Record<string, unknown>): void {
  const body: ApiSuccess<T> = { success: true, data, ...(meta ? { meta } : {}) };
  res.status(statusCode).json(body);
}

export function sendError(res: Response, message: string, statusCode = 400, code?: string): void {
  const body: ApiError = { success: false, error: message, ...(code ? { code } : {}) };
  res.status(statusCode).json(body);
}

export function sendNotFound(res: Response, entity = "Resource"): void {
  sendError(res, `${entity} not found.`, 404, "NOT_FOUND");
}

export function sendUnauthorized(res: Response, message = "Authentication required."): void {
  sendError(res, message, 401, "UNAUTHORIZED");
}

export function sendForbidden(res: Response, message = "Access denied."): void {
  sendError(res, message, 403, "FORBIDDEN");
}
