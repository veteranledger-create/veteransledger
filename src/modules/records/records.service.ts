import prisma from "../../database/prisma";
import { AppError } from "../../middleware/error.middleware";
import { notFoundAs404 } from "../../utilities/prisma-errors";
import { pickGenericRecordFields } from "../../utilities/allowlist";
import { normalizeDateFields } from "../../utilities/date-normalize";
import { mergeMetadata } from "../../utilities/metadata-merge";
import { toRecordLike } from "../publish/publish.service";
import { toAwardJson } from "../publish/generators/awards.generator";
import { toMapJson } from "../publish/generators/maps.generator";
import { toPoliticalDocJson } from "../publish/generators/political-docs.generator";
import { checkAwardRecord } from "../publish/validators/awards.conformance";
import { checkMapRecord } from "../publish/validators/maps.conformance";
import { checkPoliticalDocRecord } from "../publish/validators/political-docs.conformance";

const DATE_FIELDS = ["date"] as const;

interface ListOptions { page: number; limit: number; type?: string; search?: string; }

export class RecordsService {
  async list({ page, limit, type, search }: ListOptions) {
    const skip = (page - 1) * limit;
    const where: object = {
      ...(type && { type }),
      ...(search && { OR: [{ title: { contains: search, mode: "insensitive" } }] }),
    };
    const [data, total] = await Promise.all([
      prisma.record.findMany({ where, skip, take: limit, orderBy: { createdAt: "desc" } }),
      prisma.record.count({ where }),
    ]);
    return { data, total, page, limit, pages: Math.ceil(total / limit) };
  }

  async getById(id: string) {
    const record = await prisma.record.findUnique({
      where: { id },
      include: { citations: true, media: true },
    });
    if (!record) throw new AppError(404, "Record not found");
    return record;
  }

  async create(data: object, userId: string) {
    const fields = normalizeDateFields(pickGenericRecordFields(data), DATE_FIELDS);
    if (!fields.type) throw new AppError(400, "type must be one of AWARD, MAP, POLITICAL_DOCUMENT.");
    const record = await prisma.record.create({ data: fields as Parameters<typeof prisma.record.create>[0]["data"] });
    await prisma.auditLog.create({ data: { userId, action: "CREATE", entity: "Record", entityId: record.id } });
    return record;
  }

  async update(id: string, data: object, userId: string) {
    const fields = normalizeDateFields(pickGenericRecordFields(data), DATE_FIELDS);
    // Json columns are replaced wholesale on update — there's no partial
    // write. Merge onto the record's current metadata (fetched fresh, right
    // before the write) rather than the client's payload alone, so fields
    // the Admin form doesn't manage (or doesn't yet exist) survive a save
    // that only ever intended to change the fields it knows about. See
    // src/utilities/metadata-merge.ts.
    if ("metadata" in fields) {
      const existing = await prisma.record.findUnique({ where: { id }, select: { metadata: true } });
      fields.metadata = mergeMetadata(existing?.metadata, fields.metadata);
    }
    const record = await notFoundAs404(
      () => prisma.record.update({ where: { id }, data: fields as Parameters<typeof prisma.record.update>[0]["data"] }),
      "Record not found",
    );
    await prisma.auditLog.create({ data: { userId, action: "UPDATE", entity: "Record", entityId: id } });
    return record;
  }

  async delete(id: string, userId: string) {
    await notFoundAs404(() => prisma.record.delete({ where: { id } }), "Record not found");
    await prisma.auditLog.create({ data: { userId, action: "DELETE", entity: "Record", entityId: id } });
  }

  async preview(id: string) {
    const record = await this.getById(id);
    const candidate = toRecordLike(record);
    switch (record.type) {
      case "AWARD":
        return { rendered: toAwardJson(candidate), issues: checkAwardRecord(candidate) };
      case "MAP":
        return { rendered: toMapJson(candidate), issues: checkMapRecord(candidate) };
      case "POLITICAL_DOCUMENT":
        return { rendered: toPoliticalDocJson(candidate), issues: checkPoliticalDocRecord(candidate) };
      default:
        throw new AppError(400, `No preview available for record type ${record.type}`);
    }
  }
}
