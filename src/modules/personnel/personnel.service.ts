import prisma from "../../database/prisma";
import { AppError } from "../../middleware/error.middleware";
import { toPersonnelJson } from "../publish/generators/personnel.generator";
import { checkPersonnelRecord } from "../publish/validators/personnel.conformance";
import { RelatedRecordEntry } from "../publish/import-validation/personnel-entity-mapper";

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

  private async resolveUniqueSlug(name: string): Promise<string> {
    const base = name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "person";
    let candidate = base;
    let suffix = 2;
    while (await prisma.entity.findFirst({ where: { slug: candidate, type: "PERSON" } })) {
      candidate = `${base}-${suffix++}`;
    }
    return candidate;
  }

  async create(data: object) {
    const d = data as { name?: string; slug?: string; [key: string]: unknown };
    const slug = d.slug || await this.resolveUniqueSlug(d.name || "person");
    return prisma.entity.create({ data: { ...d, type: "PERSON", slug } as Parameters<typeof prisma.entity.create>[0]["data"] });
  }

  async update(id: string, data: object) {
    return prisma.entity.update({ where: { id }, data: data as Parameters<typeof prisma.entity.update>[0]["data"] });
  }

  async delete(id: string) {
    await prisma.entity.delete({ where: { id } });
  }

  async preview(id: string) {
    const entity = await prisma.entity.findUnique({
      where: { id },
      include: { relationsFrom: { include: { to: true } } },
    });
    if (!entity) throw new AppError(404, "Personnel record not found");

    const entityLike = {
      id: entity.id,
      slug: entity.slug ?? null,
      name: entity.name,
      nationality: entity.nationality ?? null,
      birthDate: entity.birthDate ?? null,
      deathDate: entity.deathDate ?? null,
      biography: entity.biography ?? null,
      summary: entity.summary ?? null,
      tags: entity.tags ?? [],
      metadata: (entity.metadata as Record<string, unknown>) ?? null,
      published: entity.published,
    };

    const personnelLinks: RelatedRecordEntry[] = (entity.relationsFrom as Array<{
      to: { id: string; slug: string | null; name: string };
    }>).map((r) => ({
      id: r.to.slug ?? r.to.id,
      title: r.to.name,
      type: "Personnel" as const,
      url: undefined,
    }));

    return {
      rendered: toPersonnelJson(entityLike, personnelLinks),
      issues: checkPersonnelRecord(entityLike),
    };
  }
}
