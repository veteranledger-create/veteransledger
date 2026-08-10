import { Prisma } from "@prisma/client";
import { AppError } from "../middleware/error.middleware";

/**
 * Runs a Prisma write and converts a "record to update/delete does not
 * exist" error (P2025) into a clean AppError(404) instead of letting it
 * propagate as a raw PrismaClientKnownRequestError — which error.middleware
 * only special-cases for AppError, so it would otherwise surface as a
 * generic 500 with the Prisma error's internal message/stack leaked into
 * the response body. Used by every content-type service's update()/delete()
 * so a concurrent-edit ("someone already deleted this") failure reads the
 * same way everywhere.
 */
export async function notFoundAs404<T>(fn: () => Promise<T>, message: string): Promise<T> {
  try {
    return await fn();
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2025") {
      throw new AppError(404, message);
    }
    throw err;
  }
}
