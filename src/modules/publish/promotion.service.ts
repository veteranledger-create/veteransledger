import fs from "fs/promises";
import path from "path";
import { randomUUID } from "crypto";
import prisma from "../../database/prisma";
import { config } from "../../config/app";
import { storageConfig } from "../../config/storage";
import { AppError } from "../../middleware/error.middleware";
import { promoteFilesAtomically, restoreFromSnapshot, applyFileChangesAtomically, PromotionSnapshot } from "./promote-atomic";

interface ArmamentsIndexCategory {
  id: string;
  label: string;
  nations: string[];
  [key: string]: unknown;
}

interface ArmamentsIndex {
  categories: ArmamentsIndexCategory[];
  [key: string]: unknown;
}

// Fallback labels used only if public/data/armaments/index.json is ever
// missing entirely — every real run preserves the labels already on disk
// instead of these.
const DEFAULT_ARMAMENTS_CATEGORIES: Array<{ id: string; label: string }> = [
  { id: "panzer", label: "Panzers & Armour" },
  { id: "aircraft", label: "Aircraft" },
  { id: "naval", label: "Naval Vessels" },
  { id: "missiles", label: "Missiles & Rockets" },
  { id: "wunderwaffen", label: "Wunderwaffen" },
  { id: "equipment", label: "Infantry Equipment" },
];

export interface PromotionHistoryEntry {
  runId: string;
  action: "promote" | "rollback";
  type: string;
  timestamp: string;
  userId: string;
  filesAffected: string[];
  restoredFromRunId?: string;
}

export interface PromotionResult {
  runId: string;
  action: "promote" | "rollback";
  type: string;
  filesAffected: string[];
  status: "success" | "failed" | "disabled";
  error?: string;
}

// Same two-factor fail-closed design as every transactional database
// importer already proven in this project — this flag AND the caller's
// literal-typed confirmation must both agree. This is the first code in
// the entire project that writes to public/data/ at all, so it gets at
// least the same safety treatment as the highest-stakes database writes
// already shipped, not less.
//
// History: briefly set to true twice for Phase 7F verification — promoted
// and rolled back the real Naval staged output (runId
// c8aea22d-3e40-4132-a120-2b5b15b4c5ef, then again for the live-frontend
// check, runId 1f46e3ec-cbb4-4d8d-b133-2261d0fa0ae5) — each verified via
// an independent, out-of-band checksum backup taken before any of it ran,
// confirming byte-for-byte restoration, then reset to false.
//
// Briefly set to true again for Phase 7G (manifest regeneration):
// promoted Naval (runId 102913ed-a96e-49cc-9e00-b6dff1b5726d, included
// the regenerated index.json), rolled it back to confirm byte-for-byte
// restoration of both the data files and the manifest together, then
// re-promoted (runId e665f896-93ff-4efa-b2e7-ff67ecf1404c) as the final,
// intentionally-kept live state — naval/romania.json is now genuinely
// published and discoverable via index.json. Reset to false afterward.
//
// Briefly set to true again for the Phase 8A aircraft pilot: promoted
// (runId 352a671c-4e26-40d6-8b25-dcea4df35f66 — staging scoped to
// aircraft/* only, Naval excluded from the batch so it was never
// touched), which also introduced and exercised the orphaned-
// other-axis.json pruning logic (aircraft/other-axis.json deleted,
// fully superseded by italy/japan/romania.json). Rolled back (runId
// 67214a5f-23d4-4817-ad13-4df211d0e73f), confirmed byte-for-byte
// restoration of all 5 aircraft-dir files + index.json + Naval
// untouched, then re-promoted (runId d96734d7-8ff7-4e02-9736-
// e13283ce9e18) as the final, intentionally-kept live state. Reset to
// false afterward.
//
// Briefly set to true again for the Phase 9A panzer pilot: promoted
// (runId 49ea6691-df9e-4151-b4ae-adbc4b2052e8 — staging restricted to
// panzer/* only; Naval and Aircraft excluded from the batch so neither
// was touched), which also exercised the orphan-pruning logic again
// (panzer/other-axis.json deleted, superseded by italy/japan/romania/
// hungary.json). Rolled back (runId c9d3dfc2-eada-45f6-88c1-
// 41f79042d044), confirmed byte-for-byte restoration of all 5
// panzer-dir files + index.json + Naval/Aircraft untouched, then
// re-promoted (runId c5763466-4fd9-4130-9d16-161788e80bed) as the
// final, intentionally-kept live state. Reset to false afterward.
//
// Briefly set to true again for the Phase 10A equipment pilot:
// promoted (runId 7195e208-98a7-4c1f-977a-1f913904f6bd — staging
// restricted to equipment/* only; Naval/Aircraft/Panzer excluded from
// the batch). other-axis.json's two compound-nation entries ("ZB vz.
// 26" -> Czechoslovakia/Germany (captured), "Mannlicher M1895" ->
// Hungary/Romania/Bulgaria) produced unconventional but functionally
// correct filenames via the existing nationality-slug logic — not a
// new behavior, faithfully reflecting the source data's own nation
// field as authored. Rolled back (runId
// 4da5381a-8586-45d4-9502-58c63ba5c99a), confirmed byte-for-byte
// restoration of all equipment-dir files + index.json + other
// categories untouched, then re-promoted (runId
// 73f62ddd-5734-49ff-ae03-efbb9e6f885e) as the final, intentionally-
// kept live state. Reset to false afterward.
//
// Phase 11A (full finalization): all 6 categories published from DB
// and promoted together (runId 50dce0eb-7e97-4df7-80ee-4b517cb61f5a
// — 28 staged files + 3 orphan deletions (missiles/naval/wunderwaffen
// other-axis.json) + index.json). Rolled back (runId
// 5be6789d-de2b-4370-8e29-e6c24dbae653), confirmed all 32 files
// restored byte-for-byte. Re-promoted (runId
// 6a7105d0-7823-4742-b942-b4bf8016aa45) as the final, intentionally-
// kept live state. Reset to false afterward.
//
// Translation-system recordId backfill: republished and promoted all 8
// content types with staged output (letters runId
// 640842a0-fc24-4259-ba24-eaabcfe01497, armaments
// 6b0e0099-3e1a-4be7-93ee-33f61a0705ff, personnel
// e592ae2e-a7de-4d16-a09b-08616481276e, campaigns
// cc8b04c5-342a-430c-b2ab-02427a0b9475, articles
// cbe61fe7-86f4-47e6-8263-fe46e23bcf14, timeline
// 3d311ee7-73c1-492d-bc06-b130b38f5f64, formations
// 6b7d7ec0-34b9-44c2-8b48-f452582f781c, nsdap
// af989f90-288d-4941-9e4f-cbebc73cd8ca) so every live published record now
// carries the new `recordId` field the translation system resolves
// translations by (see the generators' recordId field — distinct from the
// public `id`/slug). A full backup of public/data/ was taken before this
// run; diffed after and confirmed the only changes were the new recordId
// field, one legitimately new campaign record not previously published,
// and harmless JSON key-order differences — no data loss. Awards, maps,
// and political-docs had zero staged files (no DB records of those types
// exist yet) so nothing was promoted for them. Reset to false afterward.
//
// Awards/Maps/PoliticalDocs verification fixtures: created one temporary
// DB record per type, published+promoted to verify translation rendering
// end-to-end on these previously-empty content types (listing, detail,
// locale switch, recordId lookup, English fallback, machine notice — all
// confirmed working). Deleted the 3 fixture records and their translations
// from the DB, then discovered these three types have no orphan-pruning
// logic in their index regenerators (unlike armaments/campaigns/articles),
// so a second publish+promote with 0 records left the stale
// temp-fixture-*.json files behind. Removed those 3 files and reset all
// three index.json to { "records": [] } directly — verified byte-identical
// to the pre-fixture state and zero remaining references anywhere in the
// repo. Reset to false afterward.
const PROMOTION_ENABLED = false;

function publicDataDir(type: string): string {
  return path.join(config.paths.public, "data", type);
}

function stagingDir(type: string): string {
  return path.join(storageConfig.directories.publishStaging, type);
}

function snapshotDir(type: string, runId: string): string {
  return path.join(storageConfig.directories.publishSnapshots, type, runId);
}

async function listFilesRecursive(dir: string, base = dir): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  let entries: import("fs").Dirent[];
  try {
    entries = await fs.readdir(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      const nested = await listFilesRecursive(fullPath, base);
      for (const [k, v] of nested) out.set(k, v);
    } else {
      out.set(path.relative(base, fullPath), await fs.readFile(fullPath, "utf-8"));
    }
  }
  return out;
}

async function persistSnapshotManifest(type: string, runId: string, snapshot: PromotionSnapshot): Promise<void> {
  const dir = snapshotDir(type, runId);
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(path.join(dir, "manifest.json"), JSON.stringify(snapshot, null, 2), "utf-8");
}

async function loadSnapshotManifest(type: string, runId: string): Promise<PromotionSnapshot> {
  const manifestPath = path.join(snapshotDir(type, runId), "manifest.json");
  const raw = await fs.readFile(manifestPath, "utf-8");
  return JSON.parse(raw) as PromotionSnapshot;
}

// Rebuilds categories[].nations from a real scan of public/data/armaments/<id>/
// — never from anything staged or assumed — so a newly promoted file (e.g.
// naval/romania.json, added by an admin-authored record whose real nation
// isn't one of the four legacy migration folders) is picked up automatically.
// Existing category labels (and any other top-level manifest content, e.g.
// the unrelated `nations` flag list) are preserved verbatim.
async function regenerateArmamentsIndex(targetDir: string): Promise<{ relPath: string; content: string } | null> {
  const indexPath = path.join(targetDir, "index.json");
  let current: ArmamentsIndex;
  try {
    current = JSON.parse(await fs.readFile(indexPath, "utf-8")) as ArmamentsIndex;
  } catch {
    current = { categories: DEFAULT_ARMAMENTS_CATEGORIES.map((c) => ({ ...c, nations: [] })) };
  }

  const categories = current.categories?.length
    ? current.categories
    : DEFAULT_ARMAMENTS_CATEGORIES.map((c) => ({ ...c, nations: [] }));

  const rebuilt: ArmamentsIndexCategory[] = [];
  for (const cat of categories) {
    let entries: import("fs").Dirent[];
    try {
      entries = await fs.readdir(path.join(targetDir, cat.id), { withFileTypes: true });
    } catch {
      entries = [];
    }
    const nations = entries
      .filter((e) => e.isFile() && e.name.endsWith(".json"))
      .map((e) => e.name.slice(0, -".json".length))
      .sort();
    rebuilt.push({ ...cat, nations });
  }

  const newIndex: ArmamentsIndex = { ...current, categories: rebuilt };
  const content = JSON.stringify(newIndex, null, 2);

  // Skip the write entirely if nothing actually changed — avoids a
  // no-op snapshot entry cluttering rollback history on every promotion.
  let existingRaw: string | null = null;
  try {
    existingRaw = await fs.readFile(indexPath, "utf-8");
  } catch {
    // index.json doesn't exist yet — proceed with the write
  }
  if (existingRaw !== null && JSON.stringify(JSON.parse(existingRaw)) === JSON.stringify(newIndex)) {
    return null;
  }

  return { relPath: "index.json", content };
}

// Generic helper — reads a JSON file from disk, returns null on any error.
async function readJsonFile<T>(filePath: string): Promise<T | null> {
  try { return JSON.parse(await fs.readFile(filePath, "utf-8")) as T; } catch { return null; }
}

// Regenerates personnel/index.json after a personnel promotion.
// Preserves existing branch labels; detects which branch files are
// actually present on disk so new branches appear automatically.
async function regeneratePersonnelIndex(targetDir: string): Promise<{ relPath: string; content: string } | null> {
  const indexPath = path.join(targetDir, "index.json");
  interface PersonnelIndex { branches: Array<{ id: string; label: string; file: string; [k: string]: unknown }>; [k: string]: unknown }
  const current = await readJsonFile<PersonnelIndex>(indexPath);
  const existing = new Map((current?.branches ?? []).map((b) => [b.id, b]));

  const defaultBranches = [
    { id: "army",         label: "Heer (Army)",        file: "" },
    { id: "luftwaffe",    label: "Luftwaffe",           file: "" },
    { id: "kriegsmarine", label: "Kriegsmarine",        file: "" },
    { id: "waffen-ss",    label: "Waffen-SS",           file: "" },
    { id: "foreign",      label: "Foreign Volunteers",  file: "" },
  ];

  const knownIds = new Set(defaultBranches.map((b) => b.id));
  const branches = existing.size > 0 ? [...existing.values()] : defaultBranches;

  // Discover any new branch files not yet in the index
  let entries: import("fs").Dirent[];
  try { entries = await fs.readdir(targetDir, { withFileTypes: true }); } catch { entries = []; }
  for (const e of entries) {
    if (!e.isFile() || !e.name.endsWith(".json") || e.name === "index.json") continue;
    const id = e.name.slice(0, -".json".length);
    if (!existing.has(id) && !knownIds.has(id)) {
      branches.push({ id, label: id, file: `/public/data/personnel/${e.name}` });
    }
  }

  const rebuilt = branches.map((b) => ({
    ...b,
    file: `/public/data/personnel/${b.id}.json`,
  }));

  const newIndex = { ...(current ?? {}), branches: rebuilt };
  const content = JSON.stringify(newIndex, null, 2);
  const existingRaw = await readJsonFile<unknown>(indexPath);
  if (existingRaw !== null && JSON.stringify(existingRaw) === JSON.stringify(newIndex)) return null;
  return { relPath: "index.json", content };
}

// Regenerates letters/index.json after a letters promotion.
async function regenerateLettersIndex(targetDir: string): Promise<{ relPath: string; content: string } | null> {
  const indexPath = path.join(targetDir, "index.json");
  interface LettersIndex { collections: Array<{ id: string; label: string; file: string; [k: string]: unknown }>; [k: string]: unknown }
  const current = await readJsonFile<LettersIndex>(indexPath);
  const existing = new Map((current?.collections ?? []).map((c) => [c.id, c]));

  let entries: import("fs").Dirent[];
  try { entries = await fs.readdir(targetDir, { withFileTypes: true }); } catch { entries = []; }

  const collections = [...existing.values()];
  const seenIds = new Set(collections.map((c) => c.id));

  for (const e of entries) {
    if (!e.isFile() || !e.name.endsWith(".json") || e.name === "index.json") continue;
    const id = e.name.slice(0, -".json".length);
    if (!seenIds.has(id)) {
      const label = id.charAt(0).toUpperCase() + id.slice(1);
      collections.push({ id, label, file: `/public/data/letters/${e.name}` });
    } else {
      // Update file path on existing entry (preserves label and other fields)
      const c = existing.get(id)!;
      existing.set(id, { ...c, file: `/public/data/letters/${e.name}` });
    }
  }

  const rebuilt = collections.map((c) => ({ ...existing.get(c.id) ?? c }));
  const newIndex = { ...(current ?? {}), collections: rebuilt };
  const content = JSON.stringify(newIndex, null, 2);
  const existingRaw = await readJsonFile<unknown>(indexPath);
  if (existingRaw !== null && JSON.stringify(existingRaw) === JSON.stringify(newIndex)) return null;
  return { relPath: "index.json", content };
}

// Regenerates campaigns/index.json after a campaigns promotion.
// Scans theater subdirectories for campaign files to keep the campaigns[]
// list in sync with what is actually on disk.
async function regenerateCampaignsIndex(targetDir: string): Promise<{ relPath: string; content: string } | null> {
  const indexPath = path.join(targetDir, "index.json");
  interface CampaignsIndex { theaters: Array<{ id: string; label: string; campaigns: string[]; [k: string]: unknown }>; [k: string]: unknown }
  const current = await readJsonFile<CampaignsIndex>(indexPath);
  const existing = new Map((current?.theaters ?? []).map((t) => [t.id, t]));

  let topEntries: import("fs").Dirent[];
  try { topEntries = await fs.readdir(targetDir, { withFileTypes: true }); } catch { topEntries = []; }

  const theaterDirs = topEntries.filter((e) => e.isDirectory());
  const rebuilt = [];

  for (const dir of theaterDirs) {
    const theaterId = dir.name;
    let files: import("fs").Dirent[];
    try { files = await fs.readdir(path.join(targetDir, theaterId), { withFileTypes: true }); } catch { files = []; }
    const campaigns = files
      .filter((f) => f.isFile() && f.name.endsWith(".json"))
      .map((f) => f.name.slice(0, -".json".length))
      .sort();
    const prev = existing.get(theaterId);
    rebuilt.push({ ...prev, id: theaterId, label: prev?.label ?? theaterId, campaigns });
  }

  // Preserve theaters in the existing index that have no directory yet (empty theaters)
  for (const [id, t] of existing) {
    if (!rebuilt.find((r) => r.id === id)) rebuilt.push({ ...t, campaigns: t.campaigns ?? [] });
  }

  const newIndex = { ...(current ?? {}), theaters: rebuilt };
  const content = JSON.stringify(newIndex, null, 2);
  const existingRaw = await readJsonFile<unknown>(indexPath);
  if (existingRaw !== null && JSON.stringify(existingRaw) === JSON.stringify(newIndex)) return null;
  return { relPath: "index.json", content };
}

// Regenerates articles/index.json after an articles promotion.
// Scans category subdirectories for article files; preserves existing labels.
async function regenerateArticlesIndex(targetDir: string): Promise<{ relPath: string; content: string } | null> {
  const indexPath = path.join(targetDir, "index.json");
  interface ArticlesIndex { categories: Array<{ id: string; label: string; files: string[]; [k: string]: unknown }>; [k: string]: unknown }
  const current = await readJsonFile<ArticlesIndex>(indexPath);
  const existing = new Map((current?.categories ?? []).map((c) => [c.id, c]));

  let topEntries: import("fs").Dirent[];
  try { topEntries = await fs.readdir(targetDir, { withFileTypes: true }); } catch { topEntries = []; }

  const categoryDirs = topEntries.filter((e) => e.isDirectory());
  const rebuilt = [];

  for (const dir of categoryDirs) {
    const categoryId = dir.name;
    let files: import("fs").Dirent[];
    try { files = await fs.readdir(path.join(targetDir, categoryId), { withFileTypes: true }); } catch { files = []; }
    const filePaths = files
      .filter((f) => f.isFile() && f.name.endsWith(".json"))
      .map((f) => `/public/data/articles/${categoryId}/${f.name}`)
      .sort();
    const prev = existing.get(categoryId);
    const label = prev?.label ?? (categoryId.charAt(0).toUpperCase() + categoryId.slice(1));
    rebuilt.push({ ...prev, id: categoryId, label, files: filePaths });
  }

  for (const [id, c] of existing) {
    if (!rebuilt.find((r) => r.id === id)) rebuilt.push({ ...c, files: c.files ?? [] });
  }

  const newIndex = { ...(current ?? {}), categories: rebuilt };
  const content = JSON.stringify(newIndex, null, 2);
  const existingRaw = await readJsonFile<unknown>(indexPath);
  if (existingRaw !== null && JSON.stringify(existingRaw) === JSON.stringify(newIndex)) return null;
  return { relPath: "index.json", content };
}

// Regenerates a flat index.json for Awards, Maps, or Political Documents
// after a promotion. Scans the target directory for record files, reads
// the key display fields from each, and rebuilds the records[] array.
// The index is the only discovery mechanism for these types on the public site.
async function regenerateFlatIndex(
  targetDir: string,
  pickFields: (raw: Record<string, unknown>) => Record<string, unknown>,
): Promise<{ relPath: string; content: string } | null> {
  const indexPath = path.join(targetDir, "index.json");
  let entries: import("fs").Dirent[];
  try { entries = await fs.readdir(targetDir, { withFileTypes: true }); } catch { return null; }

  const records: Record<string, unknown>[] = [];
  for (const e of entries.sort((a, b) => a.name.localeCompare(b.name))) {
    if (!e.isFile() || !e.name.endsWith(".json") || e.name === "index.json") continue;
    try {
      const raw = JSON.parse(await fs.readFile(path.join(targetDir, e.name), "utf-8")) as Record<string, unknown>;
      records.push(pickFields(raw));
    } catch { /* skip malformed files */ }
  }

  const newIndex = { records };
  const content = JSON.stringify(newIndex, null, 2);
  const existingRaw = await readJsonFile<unknown>(indexPath);
  if (existingRaw !== null && JSON.stringify(existingRaw) === JSON.stringify(newIndex)) return null;
  return { relPath: "index.json", content };
}

async function regenerateAwardsIndex(targetDir: string) {
  return regenerateFlatIndex(targetDir, (r) => ({
    id: r.id, recordId: r.recordId, title: r.title,
    ...(r.nation ? { nation: r.nation } : {}),
    ...(r.summary ? { summary: r.summary } : {}),
    ...(r.image ? { image: r.image } : {}),
  }));
}
async function regenerateMapsIndex(targetDir: string) {
  return regenerateFlatIndex(targetDir, (r) => ({
    id: r.id, recordId: r.recordId, title: r.title,
    ...(r.theater ? { theater: r.theater } : {}),
    ...(r.year ? { year: r.year } : {}),
    ...(r.image ? { image: r.image } : {}),
  }));
}
async function regeneratePoliticalDocsIndex(targetDir: string) {
  return regenerateFlatIndex(targetDir, (r) => ({
    id: r.id, recordId: r.recordId, title: r.title,
    ...(r.date ? { date: r.date } : {}),
    ...(r.summary ? { summary: r.summary } : {}),
    ...(r.image ? { image: r.image } : {}),
  }));
}

// Phase 8A: "other-axis" is a migration-source folder concept, not a
// published-data concept — once a category's records are grouped by real
// nationality (see publish.service.ts's generateFiles), there is no
// longer a record whose actual nation is "other-axis" itself, so no
// <category>/other-axis.json is ever staged for it again. Left alone,
// the old file would sit on disk indefinitely, orphaned and stale,
// duplicating content now correctly published under its real nation
// (Italy/Japan/Romania/etc.) — exactly the case found for Aircraft.
// Scoped strictly to the categories actually present in THIS promotion's
// staged batch — a category never touched by a given promotion run is
// never inspected here, so e.g. a Naval-excluded run cannot prune
// Naval's other-axis.json as a side effect.
function categoriesInBatch(relPaths: string[]): Set<string> {
  return new Set(
    relPaths
      .map((p) => p.replace(/\\/g, "/").split("/")[0])
      .filter((c) => c && c !== "index.json"),
  );
}

// Finds JSON files sitting directly in targetDir root (not in subdirs, not
// index.json). For campaigns and articles these are old per-theater/per-category
// aggregate files generated by the previous pipeline format (e.g.
// eastern-front.json, military.json). The new pipeline only writes to
// {theater}/{slug}.json or {category}/{slug}.json subdirectories, so any
// root-level .json file other than index.json is an orphaned aggregate.
async function findOrphanedRootJsonFiles(targetDir: string): Promise<Map<string, null>> {
  const toDelete = new Map<string, null>();
  let entries: import("fs").Dirent[];
  try { entries = await fs.readdir(targetDir, { withFileTypes: true }); } catch { return toDelete; }
  for (const entry of entries) {
    if (entry.isFile() && entry.name.endsWith(".json") && entry.name !== "index.json") {
      toDelete.set(entry.name, null);
    }
  }
  return toDelete;
}

async function findOrphanedOtherAxisFiles(
  targetDir: string,
  touchedCategories: Set<string>,
  stagedRelPaths: string[],
): Promise<Map<string, null>> {
  const stagedSet = new Set(stagedRelPaths.map((p) => p.replace(/\\/g, "/")));
  const toDelete = new Map<string, null>();
  for (const category of touchedCategories) {
    const relPath = `${category}/other-axis.json`;
    if (stagedSet.has(relPath)) continue; // still genuinely staged — not orphaned
    const exists = await fs.access(path.join(targetDir, category, "other-axis.json")).then(() => true, () => false);
    if (exists) toDelete.set(relPath, null);
  }
  return toDelete;
}

async function appendHistory(entry: PromotionHistoryEntry): Promise<void> {
  await fs.mkdir(storageConfig.directories.publishHistory, { recursive: true });
  const historyFile = path.join(storageConfig.directories.publishHistory, `${entry.type}.json`);

  let existing: PromotionHistoryEntry[] = [];
  try {
    existing = JSON.parse(await fs.readFile(historyFile, "utf-8")) as PromotionHistoryEntry[];
  } catch {
    // first entry for this type — fine
  }
  existing.push(entry);
  await fs.writeFile(historyFile, JSON.stringify(existing, null, 2), "utf-8");

  await prisma.auditLog.create({
    data: {
      userId: entry.userId,
      action: entry.action === "promote" ? "PUBLISH_PROMOTE" : "PUBLISH_ROLLBACK",
      entity: "Record",
      entityId: entry.runId,
      metadata: entry as unknown as object,
    },
  });
}

export class PromotionService {
  async listHistory(type: string): Promise<PromotionHistoryEntry[]> {
    const historyFile = path.join(storageConfig.directories.publishHistory, `${type}.json`);
    try {
      return JSON.parse(await fs.readFile(historyFile, "utf-8")) as PromotionHistoryEntry[];
    } catch {
      return [];
    }
  }

  // Promotes only the files actually present in storage/publish-staging/<type>/
  // right now — never the whole public/data/<type>/ directory. Every
  // category, every other file (index.json, other categories, etc.)
  // already in public/data/<type>/ is left completely untouched, since
  // promoteFilesAtomically only ever acts on the exact relPaths staged.
  async promote(type: string, userId: string, confirmPromotion: true): Promise<PromotionResult> {
    const runId = randomUUID();

    if (!PROMOTION_ENABLED || confirmPromotion !== true) {
      return {
        runId, action: "promote", type, filesAffected: [], status: "disabled",
        error: "Promotion is disabled (PROMOTION_ENABLED=false). No filesystem write of any kind was attempted.",
      };
    }

    const staged = await listFilesRecursive(stagingDir(type));
    if (staged.size === 0) {
      throw new AppError(400, `No staged files found for type "${type}" — run a publish first.`);
    }

    const targetDir = publicDataDir(type);
    const { promoted, snapshot } = await promoteFilesAtomically(targetDir, staged);

    let filesAffected = promoted;
    let fullSnapshot = snapshot;

    // After every promotion, regenerate the section's index.json so that
    // any new files added to the directory are immediately discoverable by
    // the frontend without requiring a source-code change. Each regenerator
    // preserves existing labels and only writes if something actually changed.
    // If this step fails, the staged promotion above is rolled back too so no
    // partial state can remain.
    const indexRegenerator: (() => Promise<{ relPath: string; content: string } | null>) | null =
      type === "armaments"      ? () => regenerateArmamentsIndex(targetDir)      :
      type === "personnel"      ? () => regeneratePersonnelIndex(targetDir)      :
      type === "letters"        ? () => regenerateLettersIndex(targetDir)        :
      type === "campaigns"      ? () => regenerateCampaignsIndex(targetDir)      :
      type === "articles"       ? () => regenerateArticlesIndex(targetDir)       :
      type === "awards"         ? () => regenerateAwardsIndex(targetDir)         :
      type === "maps"           ? () => regenerateMapsIndex(targetDir)           :
      type === "political-docs" ? () => regeneratePoliticalDocsIndex(targetDir)  :
      // formations: index.json is static structural config (category paths never change) — no regeneration needed.
      // nsdap: files are promoted as-is; no index.json to update.
      null;

    if (indexRegenerator) {
      try {
        if (type === "armaments") {
          // Armaments prunes orphaned other-axis.json files (per-nation migration artifact).
          const touchedCategories = categoriesInBatch(promoted);
          const orphanDeletions = await findOrphanedOtherAxisFiles(targetDir, touchedCategories, promoted);
          if (orphanDeletions.size > 0) {
            const { applied: orphanApplied, snapshot: orphanSnapshot } = await applyFileChangesAtomically(targetDir, orphanDeletions);
            filesAffected = [...filesAffected, ...orphanApplied];
            fullSnapshot = { ...fullSnapshot, ...orphanSnapshot };
          }
        } else if (type === "campaigns" || type === "articles") {
          // Campaigns and articles prune old per-theater/per-category aggregate
          // JSON files at the root of the data directory (e.g. eastern-front.json,
          // military.json). These were written by the old pipeline and are now
          // superseded by per-record files in {theater|category}/{slug}.json subdirs.
          const orphanDeletions = await findOrphanedRootJsonFiles(targetDir);
          if (orphanDeletions.size > 0) {
            const { applied: orphanApplied, snapshot: orphanSnapshot } = await applyFileChangesAtomically(targetDir, orphanDeletions);
            filesAffected = [...filesAffected, ...orphanApplied];
            fullSnapshot = { ...fullSnapshot, ...orphanSnapshot };
          }
        }

        const indexChange = await indexRegenerator();
        if (indexChange) {
          const { applied: indexApplied, snapshot: indexSnapshot } = await applyFileChangesAtomically(
            targetDir,
            new Map([[indexChange.relPath, indexChange.content]]),
          );
          filesAffected = [...filesAffected, ...indexApplied];
          fullSnapshot = { ...fullSnapshot, ...indexSnapshot };
        }
      } catch (err) {
        await restoreFromSnapshot(targetDir, fullSnapshot).catch(() => undefined);
        throw err;
      }
    }

    await persistSnapshotManifest(type, runId, fullSnapshot);
    await appendHistory({ runId, action: "promote", type, timestamp: new Date().toISOString(), userId, filesAffected });

    return { runId, action: "promote", type, filesAffected, status: "success" };
  }

  // Restores public/data/<type>/ to exactly the state it was in
  // immediately before a specific past promotion run, using that run's
  // saved snapshot manifest — deleting any file the manifest says did not
  // exist before that promotion, restoring the saved content for every
  // other file it touched.
  async rollback(type: string, targetRunId: string, userId: string, confirmRollback: true): Promise<PromotionResult> {
    const runId = randomUUID();

    if (!PROMOTION_ENABLED || confirmRollback !== true) {
      return {
        runId, action: "rollback", type, filesAffected: [], status: "disabled",
        error: "Promotion (and therefore rollback) is disabled (PROMOTION_ENABLED=false).",
      };
    }

    let snapshot: PromotionSnapshot;
    try {
      snapshot = await loadSnapshotManifest(type, targetRunId);
    } catch {
      throw new AppError(404, `No snapshot found for runId "${targetRunId}" — cannot roll back.`);
    }

    const targetDir = publicDataDir(type);
    const { restored } = await restoreFromSnapshot(targetDir, snapshot);

    await appendHistory({
      runId, action: "rollback", type, timestamp: new Date().toISOString(), userId,
      filesAffected: restored, restoredFromRunId: targetRunId,
    });

    return { runId, action: "rollback", type, filesAffected: restored, status: "success" };
  }
}
