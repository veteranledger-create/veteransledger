import { Prisma } from "@prisma/client";
import prisma from "../../database/prisma";
import { AppError } from "../../middleware/error.middleware";
import { notFoundAs404 } from "../../utilities/prisma-errors";
import { normalizeDateInput } from "../../utilities/date-normalize";
import { mergeMetadata } from "../../utilities/metadata-merge";

interface ListOptions {
  page: number;
  limit: number;
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
  summary?: string | null;
  significance?: string | null;
  published?: boolean;
  metadata?: Record<string, unknown> | null;
}

function toDbData(data: EventInput) {
  return {
    title: data.title,
    year: data.year ?? null,
    // normalizeDateInput() returns undefined for an absent/unparseable
    // value; toDbData() always includes date/endDate as explicit keys
    // (full-replace semantics, not a partial update), so that's coalesced
    // to null here to preserve this function's existing behavior exactly.
    date: normalizeDateInput(data.date) ?? null,
    endDate: normalizeDateInput(data.endDate) ?? null,
    category: data.category ?? null,
    location: data.location ?? null,
    summary: data.summary ?? null,
    significance: data.significance ?? null,
    published: data.published ?? true,
    metadata: data.metadata ? (data.metadata as Prisma.InputJsonValue) : undefined,
  };
}

export class TimelineService {
  async list({ page, limit, year, category, published }: ListOptions) {
    const where: Record<string, unknown> = {};
    if (year) where.year = year;
    if (category) where.category = category;
    if (published !== undefined) where.published = published;
    const skip = (page - 1) * limit;
    const [data, total] = await Promise.all([
      prisma.timelineEvent.findMany({
        where,
        skip,
        take: limit,
        orderBy: [{ year: "asc" }, { date: "asc" }, { title: "asc" }],
      }),
      prisma.timelineEvent.count({ where }),
    ]);
    return { data, total, page, limit, pages: Math.ceil(total / limit) };
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
    const existing = await this.getById(id);
    const dbData = toDbData(data);
    // toDbData()'s metadata is a full replacement value (or undefined if the
    // caller sent none at all) — merge onto the record's current metadata
    // rather than overwriting with only what the Admin form manages. See
    // src/utilities/metadata-merge.ts.
    if (dbData.metadata !== undefined) {
      dbData.metadata = mergeMetadata(existing.metadata, dbData.metadata) as Prisma.InputJsonValue;
    }
    return prisma.timelineEvent.update({ where: { id }, data: dbData });
  }

  async delete(id: string) {
    await notFoundAs404(() => prisma.timelineEvent.delete({ where: { id } }), "Timeline event not found");
  }
}
