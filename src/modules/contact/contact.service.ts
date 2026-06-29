import nodemailer from "nodemailer";
import { config } from "../../config/app";
import { AppError } from "../../middleware/error.middleware";
import { logger } from "../../middleware/logger.middleware";

function escHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

interface MessageOptions {
  to: string;
  subject: string;
  message: string;
  ip: string;
  senderName?: string;
}

export class ContactService {
  private transporter = nodemailer.createTransport({
    host: config.smtp.host,
    port: config.smtp.port,
    secure: config.smtp.secure,
    auth: config.smtp.user
      ? { user: config.smtp.user, pass: config.smtp.pass }
      : undefined,
  });

  async sendMessage({
    to,
    subject,
    message,
    ip,
    senderName,
  }: MessageOptions): Promise<void> {
    if (!subject?.trim() || !message?.trim()) {
      throw new AppError(400, "Subject and message are required");
    }
    if (message.trim().length < 20) {
      throw new AppError(400, "Message must be at least 20 characters");
    }

    try {
      await this.transporter.sendMail({
        from: config.smtp.from,
        to: config.admin.email,
        replyTo: to || undefined,
        subject: `[VeteransLedger Contact] ${subject}`,
        text: `From: ${senderName ?? "Unknown"} <${to}>\nIP: ${ip}\n\n${message}`,
        html: `<p><strong>From:</strong> ${escHtml(senderName ?? "Unknown")} &lt;${escHtml(to)}&gt;<br><strong>IP:</strong> ${escHtml(String(ip))}</p><p>${escHtml(message).replace(/\n/g, "<br>")}</p>`,
      });
    } catch (err) {
      logger.error("Failed to send contact email", { error: String(err) });
      throw new AppError(
        500,
        "Failed to send message. Please try again later.",
      );
    }
  }
}
