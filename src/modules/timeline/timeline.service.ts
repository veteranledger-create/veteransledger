import { Prisma } from "@prisma/client";
import prisma from "../../database/prisma";
import { AppError } from "../../middleware/error.middleware";

interface ListOptions {
  year?: number;
  category?: string;
  published?: boolean;
}

export interface EventInput {
  title: string;
  year?: number | null;
  date?: string | null;
  endDate?: string | null;
  category?: string | null;
  location?: string | null;
  significance?: string | null;
  published?: boolean;
  metadata?: Record<string, unknown> | null;
}

function toDbData(data: EventInput) {
  return {
    title: data.title,
    year: data.year ?? null,
    date: data.date ? new Date(data.date) : null,
    endDate: data.endDate ? new Date(data.endDate) : null,
    category: data.category ?? null,
    location: data.location ?? null,
    significance: data.significance ?? null,
    published: data.published ?? true,
    metadata: data.metadata ? (data.metadata as Prisma.InputJsonValue) : undefined,
  };
}

export class TimelineService {
  async list({ year, category, published }: ListOptions) {
    const where: Record<string, unknown> = {};
    if (year) where.year = year;
    if (category) where.category = category;
    if (published !== undefined) where.published = published;
    return prisma.timelineEvent.findMany({
      where,
      orderBy: [{ year: "asc" }, { date: "asc" }, { title: "asc" }],
    });
  }

  async getById(id: string) {
    const event = await prisma.timelineEvent.findUnique({ where: { id } });
    if (!event) throw new AppError(404, "Timeline event not found");
    return event;
  }

  async create(data: EventInput) {
    if (!data.title?.trim()) throw new AppError(400, "title is required");
    return prisma.timelineEvent.create({ data: toDbData(data) });
  }

  async update(id: string, data: EventInput) {
    await this.getById(id);
    return prisma.timelineEvent.update({ where: { id }, data: toDbData(data) });
  }

  async delete(id: string) {
    await prisma.timelineEvent.delete({ where: { id } });
  }
}
