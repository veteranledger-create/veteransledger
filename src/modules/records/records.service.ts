import { Prisma } from "@prisma/client";
import prisma from "../../database/prisma";
import { AppError } from "../../middleware/error.middleware";
import { toRecordLike } from "../publish/publish.service";
import { toAwardJson } from "../publish/generators/awards.generator";
import { toMapJson } from "../publish/generators/maps.generator";
import { toPoliticalDocJson } from "../publish/generators/political-docs.generator";
import { checkAwardRecord } from "../publish/validators/awards.conformance";
import { checkMapRecord } from "../publish/validators/maps.conformance";
import { checkPoliticalDocRecord } from "../publish/validators/political-docs.conformance";

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

  async preview(id: string) {
    const record = await this.getById(id);
    const candidate = toRecordLike(record);
    switch (record.type) {
      case "AWARD":
        return { rendered: toAwardJson(candidate), issues: checkAwardRecord(candidate) };
      case "MAP":
        return { rendered: toMapJson(candidate), issues: checkMapRecord(candidate) };
      case "POLITICAL_DOCUMENT":
        return { rendered: toPoliticalDocJson(candidate), issues: checkPoliticalDocRecord(candidate) };
      default:
        throw new AppError(400, `No preview available for record type ${record.type}`);
    }
  }
}
