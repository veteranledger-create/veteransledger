/**
 * Phase 11A finalization audit: records, images, sources, related_records,
 * DB-vs-published-file consistency across all 6 Armaments categories.
 */
import fs from "fs/promises";
import path from "path";
import prisma from "../src/database/prisma";

const PUBLIC_DIR = path.resolve(__dirname, "../public/data/armaments");

async function main() {
  // ── 1. DB record & collection counts ─────────────────────────────────
  const dbRecords = await prisma.record.findMany({
    where: { type: "ARMAMENT", published: true },
    select: { id: true, slug: true, title: true, nationality: true, tags: true, metadata: true },
  });
  const dbCollections = await prisma.collection.findMany({
    where: { category: "armaments" },
    select: { id: true, slug: true },
  });

  const byCategory: Record<string, number> = {};
  const byNation: Record<string, number> = {};
  let withImage = 0, withoutImage = 0;
  let withSources = 0, withoutSources = 0;
  const relatedRecordLinks: { slug: string; title: string; links: string[] }[] = [];
  const missingImages: { slug: string; title: string; image: string }[] = [];

  for (const r of dbRecords) {
    const meta = r.metadata as Record<string, unknown> | null ?? {};
    const category = (meta.category as string) ?? "unknown";
    const nat = r.nationality ?? "unknown";
    byCategory[category] = (byCategory[category] ?? 0) + 1;
    byNation[nat] = (byNation[nat] ?? 0) + 1;

    const image = meta.image as string | null;
    if (image) {
      withImage++;
      // Check if image file exists on disk
      const imgPath = path.resolve(__dirname, "../", image.replace(/^\//, ""));
      try { await fs.access(imgPath); } catch { missingImages.push({ slug: r.slug ?? "", title: r.title, image }); }
    } else {
      withoutImage++;
    }

    const sources = meta.sources;
    if (sources && Array.isArray(sources) && sources.length > 0) withSources++;
    else withoutSources++;

    const related = meta.related_records as string[] | null;
    if (related && Array.isArray(related) && related.length > 0) {
      relatedRecordLinks.push({ slug: r.slug ?? "", title: r.title, links: related });
    }
  }

  // ── 2. Related-records link integrity ────────────────────────────────
  const allSlugs = new Set(
    (await prisma.record.findMany({ select: { slug: true } }))
      .map((r) => r.slug)
      .filter(Boolean) as string[],
  );
  const brokenLinks: { slug: string; title: string; brokenLink: unknown }[] = [];
  for (const { slug, title, links } of relatedRecordLinks) {
    for (const link of links) {
      if (typeof link === "string") {
        const linkedSlug = link.replace(/^.*\//, "");
        if (!allSlugs.has(linkedSlug) && !allSlugs.has(link)) {
          brokenLinks.push({ slug, title, brokenLink: link });
        }
      }
      // Non-string entries (objects, etc.) — just note them as-is
    }
  }

  // ── 3. DB ↔ published-file consistency ───────────────────────────────
  const publishedFiles = new Map<string, unknown[]>();
  const categories = ["aircraft", "equipment", "missiles", "naval", "panzer", "wunderwaffen"];
  for (const cat of categories) {
    let entries: import("fs").Dirent[];
    try { entries = await fs.readdir(path.join(PUBLIC_DIR, cat), { withFileTypes: true }); }
    catch { entries = []; }
    for (const entry of entries) {
      if (!entry.name.endsWith(".json")) continue;
      const raw = JSON.parse(await fs.readFile(path.join(PUBLIC_DIR, cat, entry.name), "utf-8"));
      const items = Array.isArray(raw) ? raw : (Object.values(raw).find((v) => Array.isArray(v)) as unknown[] ?? []);
      publishedFiles.set(`${cat}/${entry.name.slice(0, -5)}`, items);
    }
  }

  const dbSlugSet = new Set(dbRecords.map((r) => r.slug).filter(Boolean) as string[]);
  const publishedSlugs = new Set<string>();
  for (const [, items] of publishedFiles) {
    for (const item of items as Record<string, unknown>[]) {
      if (item.id) publishedSlugs.add(item.id as string);
    }
  }

  const inDbNotPublished = [...dbSlugSet].filter((s) => !publishedSlugs.has(s));
  const publishedNotInDb = [...publishedSlugs].filter((s) => !dbSlugSet.has(s));

  // ── 4. Published file record counts ──────────────────────────────────
  const fileRecordCounts: Record<string, number> = {};
  for (const [key, items] of publishedFiles) {
    fileRecordCounts[key] = (items as unknown[]).length;
  }

  const report = {
    generatedAt: new Date().toISOString(),
    db: {
      totalRecords: dbRecords.length,
      totalCollections: dbCollections.length,
      byCategory,
      byNation,
    },
    images: {
      withImage,
      withoutImage,
      missingOnDisk: missingImages,
    },
    sources: { withSources, withoutSources },
    relatedRecords: {
      recordsWithLinks: relatedRecordLinks.length,
      totalLinks: relatedRecordLinks.reduce((n, r) => n + r.links.length, 0),
      brokenLinks,
    },
    consistency: {
      inDbNotPublished,
      publishedNotInDb,
      fileRecordCounts,
    },
  };

  console.log(JSON.stringify(report, null, 2));
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());
