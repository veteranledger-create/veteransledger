import prisma from "../../database/prisma";
import { AppError } from "../../middleware/error.middleware";

interface ListOptions { page: number; limit: number; theater?: string; search?: string; }

export class CampaignsService {
  async list({ page, limit, theater, search }: ListOptions) {
    const skip = (page - 1) * limit;
    const where: object = {
      type: "CAMPAIGN",
      ...(theater && { metadata: { path: ["theater"], equals: theater } }),
      ...(search && { OR: [{ title: { contains: search, mode: "insensitive" } }] }),
    };
    const [data, total] = await Promise.all([
      prisma.record.findMany({ where, skip, take: limit, orderBy: { startDate: "asc" } }),
      prisma.record.count({ where }),
    ]);
    return { data, total, page, limit, pages: Math.ceil(total / limit) };
  }

  async getById(id: string) {
    const record = await prisma.record.findUnique({
      where: { id },
      include: { citations: true, media: true },
    });
    if (!record) throw new AppError(404, "Campaign not found");
    return record;
  }

  async create(data: object) {
    return prisma.record.create({ data: { ...(data as object), type: "CAMPAIGN" } as Parameters<typeof prisma.record.create>[0]["data"] });
  }

  async update(id: string, data: object) {
    return prisma.record.update({ where: { id }, data: data as Parameters<typeof prisma.record.update>[0]["data"] });
  }

  async delete(id: string) {
    await prisma.record.delete({ where: { id } });
  }
}
