import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import prisma from "../../database/prisma";
import { config } from "../../config/app";
import { AppError } from "../../middleware/error.middleware";
import { AuthPayload } from "../../middleware/auth.middleware";

export class AuthService {
  async login(email: string, password: string): Promise<{ token: string; user: object }> {
    if (!email || !password) throw new AppError(400, "Email and password are required");

    const user = await prisma.user.findUnique({ where: { email } });
    if (!user) throw new AppError(401, "Invalid credentials");

    const valid = await bcrypt.compare(password, user.passwordHash);
    if (!valid) throw new AppError(401, "Invalid credentials");

    const payload: AuthPayload = { userId: user.id, email: user.email, role: user.role };
    const token = jwt.sign(payload, config.jwt.secret, {
      expiresIn: config.jwt.expiresIn as jwt.SignOptions["expiresIn"],
    });

    return {
      token,
      user: { id: user.id, email: user.email, role: user.role },
    };
  }

  async getProfile(userId: string): Promise<object> {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, email: true, role: true, createdAt: true },
    });
    if (!user) throw new AppError(404, "User not found");
    return user;
  }

  async refreshToken(oldToken: string): Promise<{ token: string }> {
    try {
      const payload = jwt.verify(oldToken, config.jwt.secret) as AuthPayload;
      const newPayload: AuthPayload = {
        userId: payload.userId,
        email: payload.email,
        role: payload.role,
      };
      const token = jwt.sign(newPayload, config.jwt.secret, {
        expiresIn: config.jwt.expiresIn as jwt.SignOptions["expiresIn"],
      });
      return { token };
    } catch {
      throw new AppError(401, "Invalid or expired token");
    }
  }
}
