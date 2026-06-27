import prisma from "../../database/prisma";
import { AppError } from "../../middleware/error.middleware";
import { toRecordLike } from "../publish/publish.service";
import { toLetterJson } from "../publish/generators/letters.generator";
import { checkLetterRecord } from "../publish/validators/letters.conformance";

interface ListOptions { page: number; limit: number; language?: string; search?: string; }

export class LettersService {
  async list({ page, limit, language, search }: ListOptions) {
    const skip = (page - 1) * limit;
    const where: object = {
      type: "LETTER",
      ...(language && { metadata: { path: ["language"], equals: language } }),
      ...(search && { OR: [{ title: { contains: search, mode: "insensitive" } }] }),
    };
    const [data, total] = await Promise.all([
      prisma.record.findMany({ where, skip, take: limit, orderBy: { date: "asc" } }),
      prisma.record.count({ where }),
    ]);
    return { data, total, page, limit, pages: Math.ceil(total / limit) };
  }

  async getById(id: string) {
    const record = await prisma.record.findUnique({ where: { id }, include: { citations: true, media: true } });
    if (!record) throw new AppError(404, "Letter not found");
    return record;
  }

  async create(data: object) {
    return prisma.record.create({ data: { ...(data as object), type: "LETTER" } as Parameters<typeof prisma.record.create>[0]["data"] });
  }

  async update(id: string, data: object) {
    return prisma.record.update({ where: { id }, data: data as Parameters<typeof prisma.record.update>[0]["data"] });
  }

  async delete(id: string) {
    await prisma.record.delete({ where: { id } });
  }

  async preview(id: string) {
    const record = await this.getById(id);
    const candidate = toRecordLike(record);
    return { rendered: toLetterJson(candidate), issues: checkLetterRecord(candidate) };
  }
}
