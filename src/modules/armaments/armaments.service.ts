import prisma from "../../database/prisma";
import { AppError } from "../../middleware/error.middleware";
import { findAdminDuplicateCandidates } from "./admin-duplicate-check";
import { toRecordLike } from "../publish/publish.service";
import { toArmamentJson } from "../publish/generators/armaments.generator";
import { checkArmamentRecord } from "../publish/validators/armaments.conformance";
import { slugify } from "../publish/import-validation/armament-record-mapper";

interface ListOptions { page: number; limit: number; category?: string; nation?: string; search?: string; }

export interface ArmamentInput {
  title: string;
  summary?: string;
  category: string;
  nation: string;
  specs?: Record<string, unknown>;
  sources?: unknown[];
  related_records?: unknown[];
  published?: boolean;
}

// Maps the admin form's structured input onto Record's real columns +
// metadata — the exact same shape toRecordCreateInput() produces during
// migration, so an admin-created Armament is indistinguishable from a
// migrated one once saved.
//
// slug is passed in separately, not derived here — it must only ever be
// generated once, at create time (see resolveUniqueSlug below), and must
// never silently regenerate on a later title edit, since that would break
// any link or related_records reference already pointing at the original
// slug. checkArmamentRecord() requires it for every record regardless of
// how the record was created.
function buildRecordData(input: Partial<ArmamentInput>, slug?: string) {
  const { title, summary, category, nation, specs, sources, related_records, published } = input;
  return {
    type: "ARMAMENT",
    ...(slug && { slug }),
    title,
    summary: summary ?? null,
    nationality: nation,
    tags: category ? [category] : undefined,
    published: published ?? false,
    metadata: {
      ...(specs ?? {}),
      category,
      nation,
      sources: sources ?? null,
      related_records: related_records ?? null,
    },
  };
}

// Same collision-avoidance approach already proven for migration-sourced
// content, applied here to admin-authored titles instead of source-file
// names: try the bare slug first, then append -2, -3, ... until a free
// one is found, so a create() call can never fail on a slug collision
// or silently overwrite an unrelated existing record.
async function resolveUniqueSlug(title: string): Promise<string> {
  const base = slugify(title);
  let candidate = base;
  let suffix = 2;
  while (await prisma.record.findUnique({ where: { slug: candidate } })) {
    candidate = `${base}-${suffix}`;
    suffix++;
  }
  return candidate;
}

export class ArmamentsService {
  async list({ page, limit, category, nation, search }: ListOptions) {
    const skip = (page - 1) * limit;
    const where: object = {
      type: "ARMAMENT",
      ...(category && { metadata: { path: ["category"], equals: category } }),
      ...(nation && { metadata: { path: ["nation"], equals: nation } }),
      ...(search && { OR: [{ title: { contains: search, mode: "insensitive" } }] }),
    };
    const [data, total] = await Promise.all([
      prisma.record.findMany({ where, skip, take: limit, orderBy: { title: "asc" } }),
      prisma.record.count({ where }),
    ]);
    return { data, total, page, limit, pages: Math.ceil(total / limit) };
  }

  async getById(id: string) {
    const record = await prisma.record.findUnique({ where: { id }, include: { citations: true, media: true } });
    if (!record) throw new AppError(404, "Armament not found");
    return record;
  }

  async create(input: ArmamentInput) {
    const slug = await resolveUniqueSlug(input.title);
    return prisma.record.create({ data: buildRecordData(input, slug) as Parameters<typeof prisma.record.create>[0]["data"] });
  }

  async update(id: string, input: Partial<ArmamentInput>) {
    const existing = await prisma.record.findUnique({ where: { id } });
    if (!existing) throw new AppError(404, "Armament not found");

    const existingMeta = (existing.metadata as Record<string, unknown>) ?? {};
    const merged: Partial<ArmamentInput> = {
      title: input.title ?? existing.title,
      summary: input.summary ?? existing.summary ?? undefined,
      category: input.category ?? (existingMeta.category as string),
      nation: input.nation ?? (existingMeta.nation as string) ?? existing.nationality ?? undefined,
      specs: input.specs ?? existingMeta,
      sources: input.sources ?? (existingMeta.sources as unknown[]),
      related_records: input.related_records ?? (existingMeta.related_records as unknown[]),
      published: input.published ?? existing.published,
    };

    return prisma.record.update({ where: { id }, data: buildRecordData(merged) as Parameters<typeof prisma.record.update>[0]["data"] });
  }

  // Admin-specific collision check — see admin-duplicate-check.ts for why
  // this is deliberately separate from the migration system's
  // file-origin-based DUPLICATE_RESOLUTIONS table.
  async checkDuplicates(category: string, name: string, excludeId?: string) {
    return findAdminDuplicateCandidates(category, name, excludeId);
  }

  // Preview renders via the literal same generator publish uses — never a
  // parallel rendering path that could drift from what actually gets
  // published. Also runs conformance so the UI can show validation issues
  // alongside the preview, not just the rendered output.
  async preview(id: string) {
    const record = await this.getById(id);
    const candidate = toRecordLike(record);
    return {
      rendered: toArmamentJson(candidate),
      issues: checkArmamentRecord(candidate),
    };
  }

  async delete(id: string) {
    await prisma.record.delete({ where: { id } });
  }

  // Uses the existing RecordMedia relation already declared on both
  // Record and MediaAsset in the schema — no new table or column. One
  // call handles both directions so a single "save" action in the admin
  // UI can attach newly-selected media and detach removed media together.
  async updateMedia(id: string, attach: string[], detach: string[]) {
    const record = await prisma.record.findUnique({ where: { id } });
    if (!record) throw new AppError(404, "Armament not found");

    return prisma.record.update({
      where: { id },
      data: {
        media: {
          ...(attach.length && { connect: attach.map((mediaId) => ({ id: mediaId })) }),
          ...(detach.length && { disconnect: detach.map((mediaId) => ({ id: mediaId })) }),
        },
      },
      include: { media: true },
    });
  }
}
