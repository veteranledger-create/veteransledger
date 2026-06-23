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

    // Armaments-only: the frontend discovers nation files dynamically via
    // index.json (see armaments.js / search.js), so the manifest must be
    // regenerated from the real post-promotion directory state every time —
    // otherwise a newly promoted file (e.g. naval/romania.json) would be on
    // disk but invisible to the live site. If this step fails, the staged
    // promotion above is rolled back too, so no partial state can remain.
    if (type === "armaments") {
      try {
        // Orphan pruning runs BEFORE manifest regeneration, scoped only to
        // this batch's categories, so the manifest scan below sees the
        // already-correct directory state (no stale other-axis.json).
        const touchedCategories = categoriesInBatch(promoted);
        const orphanDeletions = await findOrphanedOtherAxisFiles(targetDir, touchedCategories, promoted);

        if (orphanDeletions.size > 0) {
          const { applied: orphanApplied, snapshot: orphanSnapshot } = await applyFileChangesAtomically(targetDir, orphanDeletions);
          filesAffected = [...filesAffected, ...orphanApplied];
          fullSnapshot = { ...fullSnapshot, ...orphanSnapshot };
        }

        const indexChange = await regenerateArmamentsIndex(targetDir);
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
