import prisma from "../../database/prisma";
import { AppError } from "../../middleware/error.middleware";
import { toRecordLike } from "../publish/publish.service";
import { toFormationJson } from "../publish/generators/formations.generator";
import { checkFormationRecord } from "../publish/validators/formations.conformance";

interface ListOptions {
  page: number;
  limit: number;
  section?: string;
  search?: string;
}

export class FormationsService {
  async list({ page, limit, section, search }: ListOptions) {
    const skip = (page - 1) * limit;
    const where: object = {
      type: "FORMATION",
      ...(section && { metadata: { path: ["section"], equals: section } }),
      ...(search && { OR: [{ title: { contains: search, mode: "insensitive" } }] }),
    };
    const [data, total] = await Promise.all([
      prisma.record.findMany({ where, skip, take: limit, orderBy: { title: "asc" } }),
      prisma.record.count({ where }),
    ]);
    return { data, total, page, limit, pages: Math.ceil(total / limit) };
  }

  async getById(id: string) {
    const record = await prisma.record.findUnique({ where: { id } });
    if (!record) throw new AppError(404, "Formation not found");
    return record;
  }

  async create(data: object, userId: string) {
    const record = await prisma.record.create({
      data: { ...(data as object), type: "FORMATION" } as Parameters<typeof prisma.record.create>[0]["data"],
    });
    await prisma.auditLog.create({ data: { userId, action: "CREATE", entity: "Record", entityId: record.id } });
    return record;
  }

  async update(id: string, data: object, userId: string) {
    const record = await prisma.record.update({
      where: { id },
      data: data as Parameters<typeof prisma.record.update>[0]["data"],
    });
    await prisma.auditLog.create({ data: { userId, action: "UPDATE", entity: "Record", entityId: id } });
    return record;
  }

  async delete(id: string, userId: string) {
    await prisma.record.delete({ where: { id } });
    await prisma.auditLog.create({ data: { userId, action: "DELETE", entity: "Record", entityId: id } });
  }

  async preview(id: string) {
    const record = await this.getById(id);
    const candidate = toRecordLike(record);
    return { rendered: toFormationJson(candidate), issues: checkFormationRecord(candidate) };
  }
}
