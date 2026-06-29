import { Request, Response, NextFunction } from "express";
import { ContactService } from "./contact.service";

const service = new ContactService();

export class ContactController {
  async send(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      // Use the express-validator-normalised `email` field, not the raw `to` field.
      const { name, email, subject, message } = req.body;
      await service.sendMessage({ to: email, subject, message, ip: req.ip ?? "", senderName: name });
      res.json({ success: true, message: "Message sent successfully." });
    } catch (err) { next(err); }
  }
}
