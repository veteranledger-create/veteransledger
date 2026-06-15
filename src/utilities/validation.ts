import { Request, Response, NextFunction } from "express";
import { validationResult } from "express-validator";

/**
 * Express middleware that reads express-validator results and
 * short-circuits with a 422 JSON response if any errors are present.
 */
export function handleValidation(req: Request, res: Response, next: NextFunction): void {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    res.status(422).json({
      success: false,
      error:   "Validation failed.",
      code:    "VALIDATION_ERROR",
      details: errors.array().map(e => ({ field: (e as any).path ?? e.type, message: e.msg })),
    });
    return;
  }
  next();
}
