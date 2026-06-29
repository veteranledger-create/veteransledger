import dotenv from "dotenv";
import path from "path";

dotenv.config();

function required(key: string): string {
  const value = process.env[key];
  if (!value) throw new Error(`Missing required environment variable: ${key}`);
  return value;
}

function optional(key: string, fallback: string): string {
  return process.env[key] ?? fallback;
}

export const config = {
  env: optional("NODE_ENV", "development"),
  isProduction: process.env.NODE_ENV === "production",
  isDevelopment: process.env.NODE_ENV !== "production",

  server: {
    port: parseInt(optional("PORT", "3000"), 10),
    host: optional("HOST", "0.0.0.0"),
  },

  database: {
    url: optional("DATABASE_URL", "postgresql://localhost:5432/VeteransLedger"),
  },

  redis: {
    url: optional("REDIS_URL", "redis://localhost:6379"),
  },

  session: {
    secret: optional("SESSION_SECRET", "dev-secret-change-in-production"),
    maxAge: parseInt(optional("SESSION_MAX_AGE", "86400000"), 10),
  },

  jwt: {
    secret: optional("JWT_SECRET", "dev-jwt-secret-change-in-production"),
    expiresIn: optional("JWT_EXPIRES_IN", "7d"),
  },

  admin: {
    email: optional("ADMIN_EMAIL", "admin@VeteransLedger.com"),
    password: optional("ADMIN_PASSWORD", "change-me"),
  },

  smtp: {
    host: optional("SMTP_HOST", "smtp.gmail.com"),
    port: parseInt(optional("SMTP_PORT", "587"), 10),
    secure: optional("SMTP_SECURE", "false") === "true",
    user: optional("SMTP_USER", ""),
    pass: optional("SMTP_PASS", ""),
    from: optional(
      "SMTP_FROM",
      "VeteransLedger Archive <support@VeteransLedger.com>",
    ),
  },

  storage: {
    path: path.resolve(optional("STORAGE_PATH", "./storage")),
    maxFileSize: parseInt(optional("MAX_FILE_SIZE", "52428800"), 10),
  },

  cors: {
    origin: optional("CORS_ORIGIN", "http://localhost:3000"),
  },

  rateLimit: {
    windowMs: parseInt(optional("RATE_LIMIT_WINDOW_MS", "900000"), 10),
    max: parseInt(optional("RATE_LIMIT_MAX", "100"), 10),
  },

  paths: {
    root: path.resolve(__dirname, "../.."),
    frontend: path.resolve(__dirname, "../../frontend"),
    public: path.resolve(__dirname, "../../public"),
    storage: path.resolve(__dirname, "../../storage"),
    logs: path.resolve(__dirname, "../../logs"),
  },
};

export type Config = typeof config;

if (process.env.NODE_ENV === "production") {
  const WEAK = ["dev-secret-change-in-production", "dev-jwt-secret-change-in-production", "change-me"];
  if (WEAK.includes(config.session.secret)) throw new Error("SESSION_SECRET must be set in production");
  if (WEAK.includes(config.jwt.secret))     throw new Error("JWT_SECRET must be set in production");
  if (WEAK.includes(config.admin.password)) throw new Error("ADMIN_PASSWORD must be set in production");
}
