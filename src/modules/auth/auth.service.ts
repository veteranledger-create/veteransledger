import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import prisma from "../../database/prisma";
import { config } from "../../config/app";
import { AppError } from "../../middleware/error.middleware";
import { AuthPayload } from "../../middleware/auth.middleware";

export class AuthService {
  // Dummy hash used when the user doesn't exist — ensures bcrypt always runs
  // so response timing doesn't reveal whether an email is registered.
  private static readonly DUMMY_HASH = "$2a$12$KIXyAi2gxnipWG4DkzOTuOlWmqKNFoGDVoiXzG4VBg/s8bCDfMnW6";

  async login(email: string, password: string): Promise<{ token: string; user: object }> {
    if (!email || !password) throw new AppError(400, "Email and password are required");

    const user = await prisma.user.findUnique({ where: { email } });
    const hashToCompare = user?.passwordHash ?? AuthService.DUMMY_HASH;
    let valid = false;
    try { valid = await bcrypt.compare(password, hashToCompare); } catch { valid = false; }
    if (!user || !valid) throw new AppError(401, "Invalid credentials");

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

      // Verify the user still exists in the database — prevents indefinite
      // token renewal for deleted or deactivated accounts.
      const user = await prisma.user.findUnique({
        where: { id: payload.userId },
        select: { id: true, email: true, role: true },
      });
      if (!user) throw new AppError(401, "User account no longer exists");

      const newPayload: AuthPayload = {
        userId: user.id,
        email: user.email,
        role: user.role,
      };
      const token = jwt.sign(newPayload, config.jwt.secret, {
        expiresIn: config.jwt.expiresIn as jwt.SignOptions["expiresIn"],
      });
      return { token };
    } catch (err) {
      if (err instanceof AppError) throw err;
      throw new AppError(401, "Invalid or expired token");
    }
  }
}
