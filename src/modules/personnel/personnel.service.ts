import prisma from "../../database/prisma";
import { AppError } from "../../middleware/error.middleware";

interface ListOptions { page: number; limit: number; branch?: string; nation?: string; search?: string; }

export class PersonnelService {
  async list({ page, limit, branch, nation, search }: ListOptions) {
    const skip = (page - 1) * limit;
    const where: object = {
      type: "PERSON",
      ...(branch && { metadata: { path: ["branch"], equals: branch } }),
      ...(nation && { nationality: nation }),
      ...(search && { OR: [{ name: { contains: search, mode: "insensitive" } }] }),
    };
    const [data, total] = await Promise.all([
      prisma.entity.findMany({ where, skip, take: limit, orderBy: { name: "asc" }, include: { aliases: true } }),
      prisma.entity.count({ where }),
    ]);
    return { data, total, page, limit, pages: Math.ceil(total / limit) };
  }

  async getById(id: string) {
    const entity = await prisma.entity.findUnique({
      where: { id },
      include: { aliases: true, relationsFrom: true, relationsTo: true, citations: true, media: true },
    });
    if (!entity) throw new AppError(404, "Personnel record not found");
    return entity;
  }

  async create(data: object) {
    return prisma.entity.create({ data: { ...(data as object), type: "PERSON" } as Parameters<typeof prisma.entity.create>[0]["data"] });
  }

  async update(id: string, data: object) {
    return prisma.entity.update({ where: { id }, data: data as Parameters<typeof prisma.entity.update>[0]["data"] });
  }

  async delete(id: string) {
    await prisma.entity.delete({ where: { id } });
  }
}
