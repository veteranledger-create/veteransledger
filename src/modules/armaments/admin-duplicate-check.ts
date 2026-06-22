import prisma from "../../database/prisma";

// Separate, deliberately, from the migration system's DUPLICATE_RESOLUTIONS
// table (src/modules/publish/import-validation/armament-record-mapper.ts).
// That table is keyed by category/fileNation/name and exists to resolve
// known duplicates across *source files* during import — it has no
// meaning for admin-authored content, which has no file origin at all.
// This is a separate, general check: does an admin-created or edited
// Armament's name collide with an already-published one in the same
// category, regardless of how either was created.
export function normalizeArmamentName(name: string): string {
  return name
    .toLowerCase()
    .normalize("NFD").replace(/[̀-ͯ]/g, "")
    .replace(/[^\w\s]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

export interface DuplicateCandidate {
  id: string;
  title: string;
  published: boolean;
}

export async function findAdminDuplicateCandidates(
  category: string,
  name: string,
  excludeId?: string,
): Promise<DuplicateCandidate[]> {
  const normalized = normalizeArmamentName(name);
  if (!normalized) return [];

  const candidates = await prisma.record.findMany({
    where: {
      type: "ARMAMENT",
      ...(excludeId && { id: { not: excludeId } }),
      metadata: { path: ["category"], equals: category },
    },
    select: { id: true, title: true, published: true },
  });

  return candidates.filter((c) => normalizeArmamentName(c.title) === normalized);
}
