import fs from "fs/promises";
import path from "path";

// Read-only — never writes anywhere. Walks the real public/data/<dir> tree
// (campaigns/personnel/armaments/formations/articles/letters are each laid
// out differently — nested by theater/category/nation, flat per-branch,
// one-object-per-file, etc. — see the architecture audit) and collects
// every record id found, so a related_records target can be checked for
// existence before any import happens.
async function readAllRecordIds(dir: string): Promise<Set<string>> {
  const ids = new Set<string>();

  async function walk(current: string): Promise<void> {
    let entries: import("fs").Dirent[];
    try {
      entries = await fs.readdir(current, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const fullPath = path.join(current, entry.name);
      if (entry.isDirectory()) {
        await walk(fullPath);
        continue;
      }
      if (!entry.name.endsWith(".json") || entry.name === "index.json") continue;
      try {
        const data = JSON.parse(await fs.readFile(fullPath, "utf-8"));
        const records = Array.isArray(data) ? data : [data];
        for (const record of records) {
          if (record && typeof record === "object" && typeof record.id === "string") {
            ids.add(record.id);
          }
        }
      } catch {
        // Unparsable file — skip rather than fail the whole lookup.
      }
    }
  }

  await walk(dir);
  return ids;
}

const TYPE_TO_DIR: Record<string, string> = {
  Campaign: "campaigns",
  Personnel: "personnel",
  Armament: "armaments",
  Formation: "formations",
  Article: "articles",
  Letter: "letters",
};

const idCache = new Map<string, Promise<Set<string>>>();

// Unrecognized types (including the nation-collection labels real letter
// data uses today, e.g. "German Collection") can't be meaningfully
// verified — they're treated as "exists" rather than flagged missing, so
// this never produces a false positive against data this checker doesn't
// understand.
export async function targetExists(type: string | undefined, id: string, publicDataDir: string): Promise<boolean> {
  const dirName = type ? TYPE_TO_DIR[type] : undefined;
  if (!dirName) return true;

  if (!idCache.has(dirName)) {
    idCache.set(dirName, readAllRecordIds(path.join(publicDataDir, dirName)));
  }
  const ids = await idCache.get(dirName)!;
  return ids.has(id);
}

// Tests construct a fresh checker per run; production code shares the
// module-level cache across the whole dry-run pass.
export function resetCrossReferenceCache(): void {
  idCache.clear();
}
