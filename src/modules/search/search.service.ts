import prisma from "../../database/prisma";

interface SearchOptions { query: string; type?: string; page: number; limit: number; includeUnpublished?: boolean; }

export class SearchService {
  /**
   * includeUnpublished is true only for authenticated (Admin) callers — see
   * search.controller.ts. An unauthenticated caller must never see draft
   * content through search, matching how every other public read path
   * (publish.service.ts's loadPublished*, translations) already gates on
   * `published`.
   */
  async search({ query, type, page, limit, includeUnpublished = false }: SearchOptions) {
    const skip = (page - 1) * limit;
    const q = query.trim();

    const recordWhere = {
      ...(type && { type }),
      ...(!includeUnpublished && { published: true }),
      ...(q && {
        OR: [
          { title: { contains: q, mode: "insensitive" as const } },
          { summary: { contains: q, mode: "insensitive" as const } },
        ],
      }),
    };

    const entityWhere = {
      ...(!includeUnpublished && { published: true }),
      ...(q && {
        OR: [
          { name: { contains: q, mode: "insensitive" as const } },
          { aliases: { some: { alias: { contains: q, mode: "insensitive" as const } } } },
        ],
      }),
    };

    const includeRecords = !type || type !== "PERSON";
    const includeEntities = !type || type === "PERSON";

    const [records, entities, recordTotal, entityTotal] = await Promise.all([
      includeRecords ? prisma.record.findMany({ where: recordWhere, skip, take: limit }) : [],
      includeEntities ? prisma.entity.findMany({ where: entityWhere, skip, take: limit, include: { aliases: true } }) : [],
      includeRecords ? prisma.record.count({ where: recordWhere }) : 0,
      includeEntities ? prisma.entity.count({ where: entityWhere }) : 0,
    ]);

    return { records, entities, total: recordTotal + entityTotal, page, limit, query: q };
  }
}
