import prisma from "../../database/prisma";
import { AppError } from "../../middleware/error.middleware";

interface ListOptions { year?: number; category?: string; }

export class TimelineService {
  async list({ year, category }: ListOptions) {
    const where: object = {
      ...(year && { date: { gte: new Date(`${year}-01-01`), lte: new Date(`${year}-12-31`) } }),
      ...(category && { category }),
    };
    return prisma.timelineEvent.findMany({ where, orderBy: { date: "asc" } });
  }

  async getById(id: string) {
    const event = await prisma.timelineEvent.findUnique({ where: { id } });
    if (!event) throw new AppError(404, "Timeline event not found");
    return event;
  }

  async create(data: object) {
    return prisma.timelineEvent.create({ data: data as Parameters<typeof prisma.timelineEvent.create>[0]["data"] });
  }

  async update(id: string, data: object) {
    return prisma.timelineEvent.update({ where: { id }, data: data as Parameters<typeof prisma.timelineEvent.update>[0]["data"] });
  }

  async delete(id: string) {
    await prisma.timelineEvent.delete({ where: { id } });
  }
}
