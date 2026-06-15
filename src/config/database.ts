import { config } from "./app";

export const databaseConfig = {
  url: config.database.url,
  pool: {
    min: 2,
    max: 10,
  },
  log: config.isDevelopment ? ["query", "warn", "error"] as const : ["warn", "error"] as const,
};
