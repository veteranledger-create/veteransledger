import prisma from "../../database/prisma";
import { AppError } from "../../middleware/error.middleware";
import { notFoundAs404 } from "../../utilities/prisma-errors";
import { pickRecordFields } from "../../utilities/allowlist";
import { mergeMetadata } from "../../utilities/metadata-merge";
import { normalizeDateFields } from "../../utilities/date-normalize";
import { toRecordLike } from "../publish/publish.service";
import { toLetterJson } from "../publish/generators/letters.generator";
import { checkLetterRecord } from "../publish/validators/letters.conformance";

const DATE_FIELDS = ["date"] as const;

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
    const fields = normalizeDateFields(pickRecordFields(data), DATE_FIELDS);
    return prisma.record.create({ data: { ...fields, type: "LETTER" } as Parameters<typeof prisma.record.create>[0]["data"] });
  }

  async update(id: string, data: object) {
    const fields = normalizeDateFields(pickRecordFields(data), DATE_FIELDS);
    // See src/utilities/metadata-merge.ts — Json columns are replaced
    // wholesale on update, so merge onto the record's current metadata
    // rather than overwriting with only what the Admin form manages.
    if ("metadata" in fields) {
      const existing = await prisma.record.findUnique({ where: { id }, select: { metadata: true } });
      fields.metadata = mergeMetadata(existing?.metadata, fields.metadata);
    }
    return notFoundAs404(
      () => prisma.record.update({ where: { id }, data: fields as Parameters<typeof prisma.record.update>[0]["data"] }),
      "Letter not found",
    );
  }

  async delete(id: string) {
    await notFoundAs404(() => prisma.record.delete({ where: { id } }), "Letter not found");
  }

  async preview(id: string) {
    const record = await this.getById(id);
    const candidate = toRecordLike(record);
    return { rendered: toLetterJson(candidate), issues: checkLetterRecord(candidate) };
  }
}
