import { Request, Response, NextFunction } from "express";
import { ContactService } from "./contact.service";

const service = new ContactService();

export class ContactController {
  async send(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { to, subject, message } = req.body;
      await service.sendMessage({ to, subject, message, ip: req.ip ?? "" });
      res.json({ success: true, message: "Message sent successfully." });
    } catch (err) { next(err); }
  }
}
