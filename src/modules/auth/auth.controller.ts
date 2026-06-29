import { Request, Response, NextFunction } from "express";
import { AuthService } from "./auth.service";
import { AppError } from "../../middleware/error.middleware";
import { logger } from "../../middleware/logger.middleware";

const service = new AuthService();

export class AuthController {
  async login(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { email, password } = req.body;
      const result = await service.login(email, password);
      logger.info("Auth: login success", { email: req.body?.email, ip: req.ip });
      res.json(result);
    } catch (err) {
      logger.warn("Auth: login failure", { email: req.body?.email, ip: req.ip });
      next(err);
    }
  }

  async logout(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      await new Promise<void>((resolve, reject) =>
        req.session.destroy((err) => (err ? reject(err) : resolve()))
      );
      res.clearCookie("vl_session");
      res.json({ message: "Logged out successfully" });
    } catch (err) {
      next(err);
    }
  }

  async me(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const user = await service.getProfile(req.user!.userId);
      res.json(user);
    } catch (err) {
      next(err);
    }
  }

  async refresh(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { token } = req.body;
      const result = await service.refreshToken(token);
      res.json(result);
    } catch (err) {
      next(err);
    }
  }
}
