import { Prisma } from "@prisma/client";
import prisma from "../../database/prisma";
import { AppError } from "../../middleware/error.middleware";

interface ListOptions { page: number; limit: number; type?: string; search?: string; }

export class RecordsService {
  async list({ page, limit, type, search }: ListOptions) {
    const skip = (page - 1) * limit;
    const where: object = {
      ...(type && { type }),
      ...(search && { OR: [{ title: { contains: search, mode: "insensitive" } }] }),
    };
    const [data, total] = await Promise.all([
      prisma.record.findMany({ where, skip, take: limit, orderBy: { createdAt: "desc" } }),
      prisma.record.count({ where }),
    ]);
    return { data, total, page, limit, pages: Math.ceil(total / limit) };
  }

  async getById(id: string) {
    const record = await prisma.record.findUnique({
      where: { id },
      include: { citations: true, media: true },
    });
    if (!record) throw new AppError(404, "Record not found");
    return record;
  }

  async create(data: object, userId: string) {
    const record = await prisma.record.create({ data: data as Parameters<typeof prisma.record.create>[0]["data"] });
    await prisma.auditLog.create({ data: { userId, action: "CREATE", entity: "Record", entityId: record.id } });
    return record;
  }

  async update(id: string, data: object, userId: string) {
    const record = await prisma.record.update({ where: { id }, data: data as Parameters<typeof prisma.record.update>[0]["data"] });
    await prisma.auditLog.create({ data: { userId, action: "UPDATE", entity: "Record", entityId: id } });
    return record;
  }

  async delete(id: string, userId: string) {
    try {
      await prisma.record.delete({ where: { id } });
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2025") {
        throw new AppError(404, "Record not found");
      }
      throw err;
    }
    await prisma.auditLog.create({ data: { userId, action: "DELETE", entity: "Record", entityId: id } });
  }
}
