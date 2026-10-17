import { Request, Response, NextFunction } from "express";
import { PublishService } from "./publish.service";
import { PromotionService, PromotionAbortedError } from "./promotion.service";

const service = new PublishService();
const promotionService = new PromotionService();

/**
 * The client-facing form of an aborted promotion.
 *
 * PromotionAbortedError is not an AppError, so the generic error handler
 * would reduce it to "Internal server error" — and in production drop the
 * explanation entirely, throwing away the one thing the operator needs:
 * whether the files were put back. Messages only; never a stack or a raw
 * error object.
 */
export function abortedBody(action: "promote" | "rollback", type: string, err: PromotionAbortedError) {
  return {
    status: "failed" as const,
    action,
    type,
    stage: err.stage,
    error: err.originalError.message,
    detail: err.message,
    restoration: err.restoration,
    requiresManualVerification: err.requiresManualVerification,
    unverifiedPaths: err.unverifiedPaths,
    reversalFailures: err.reversalFailures,
  };
}

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

  // The service's literal-typed `true` parameter exists to make
  // confirmation unmissable in code that calls it directly — over HTTP,
  // the real safety check is the runtime `!== true` comparison inside
  // PromotionService itself, which works correctly regardless of how the
  // value arrives. This cast just satisfies the type system; it grants no
  // actual permission the service doesn't independently re-verify.
  async promote(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const confirmPromotion = req.body?.confirmPromotion as true;
      res.json(await promotionService.promote(req.params.type, req.user!.userId, confirmPromotion));
    } catch (err) {
      if (err instanceof PromotionAbortedError) {
        res.status(500).json(abortedBody("promote", req.params.type, err));
        return;
      }
      next(err);
    }
  }

  async rollback(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { runId } = req.body;
      const confirmRollback = req.body?.confirmRollback as true;
      res.json(await promotionService.rollback(req.params.type, runId, req.user!.userId, confirmRollback));
    } catch (err) {
      if (err instanceof PromotionAbortedError) {
        res.status(500).json(abortedBody("rollback", req.params.type, err));
        return;
      }
      next(err);
    }
  }

  async history(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      res.json(await promotionService.listHistory(req.params.type));
    } catch (err) {
      next(err);
    }
  }
}
