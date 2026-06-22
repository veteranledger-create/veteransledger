import prisma from "../../database/prisma";

interface SearchOptions { query: string; type?: string; page: number; limit: number; }

export class SearchService {
  async search({ query, type, page, limit }: SearchOptions) {
    const skip = (page - 1) * limit;
    const q = query.trim();

    const recordWhere = {
      ...(type && { type }),
      ...(q && {
        OR: [
          { title: { contains: q, mode: "insensitive" as const } },
          { summary: { contains: q, mode: "insensitive" as const } },
        ],
      }),
    };

    const entityWhere = {
      ...(q && {
        OR: [
          { name: { contains: q, mode: "insensitive" as const } },
          { aliases: { some: { alias: { contains: q, mode: "insensitive" as const } } } },
        ],
      }),
    };

    const [records, entities, total] = await Promise.all([
      !type || type !== "PERSON"
        ? prisma.record.findMany({ where: recordWhere, skip, take: limit })
        : [],
      !type || type === "PERSON"
        ? prisma.entity.findMany({ where: entityWhere, take: limit, include: { aliases: true } })
        : [],
      prisma.record.count({ where: recordWhere }),
    ]);

    return { records, entities, total, page, limit, query: q };
  }
}
