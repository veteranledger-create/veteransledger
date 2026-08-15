import prisma from "../../database/prisma";
import { AppError } from "../../middleware/error.middleware";
import { notFoundAs404 } from "../../utilities/prisma-errors";
import { pickRecordFields } from "../../utilities/allowlist";
import { mergeMetadata } from "../../utilities/metadata-merge";
import { normalizeDateFields } from "../../utilities/date-normalize";
import { toRecordLike } from "../publish/publish.service";
import { toCampaignJson } from "../publish/generators/campaigns.generator";
import { checkCampaignRecord } from "../publish/validators/campaigns.conformance";

const DATE_FIELDS = ["startDate", "endDate"] as const;

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
    const fields = normalizeDateFields(pickRecordFields(data), DATE_FIELDS);
    return prisma.record.create({ data: { ...fields, type: "CAMPAIGN" } as Parameters<typeof prisma.record.create>[0]["data"] });
  }

  async update(id: string, data: object) {
    const fields = normalizeDateFields(pickRecordFields(data), DATE_FIELDS);
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
    return notFoundAs404(
      () => prisma.record.update({ where: { id }, data: fields as Parameters<typeof prisma.record.update>[0]["data"] }),
      "Campaign not found",
    );
  }

  async delete(id: string) {
    await notFoundAs404(() => prisma.record.delete({ where: { id } }), "Campaign not found");
  }

  async preview(id: string) {
    const record = await this.getById(id);
    const candidate = toRecordLike(record);
    return { rendered: toCampaignJson(candidate), issues: checkCampaignRecord(candidate) };
  }
}
