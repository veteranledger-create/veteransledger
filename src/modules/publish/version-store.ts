import fs from "fs/promises";
import path from "path";
import { randomUUID } from "crypto";
import { storageConfig } from "../../config/storage";
import { paths } from "../../config/paths";
import { resolveWithin } from "../../utilities/safe-path";

/**
 * Retained copies of the published archive, plus the pointer naming which one
 * is live.
 *
 * The problem this exists to solve is not storage, it is consistency. Every
 * public page loads an index and then fetches records whose URLs came out of
 * that index — two or more separate HTTP requests. Promoting between them
 * used to mean the second request could be answered from different content
 * than the first. Keeping prior versions addressable lets a page that has
 * already read an index keep resolving records against the exact version that
 * index came from, for as long as that version is retained.
 *
 * Layout, under <storage>/published/:
 *   active.json          -> { version, updatedAt }
 *   versions/v41/<type>/ -> complete copy of that version
 *
 * public/data stays exactly where it is, Git-tracked, and remains what the
 * existing public URLs serve when no version store is present.
 *
 * The store is a factory rather than a module of constants so that tests can
 * exercise a real store on a throwaway root instead of the project's own.
 */

/** Content types the promotion pipeline owns, and therefore versions. */
export const VERSIONED_TYPES = [
  "armaments", "articles", "awards", "campaigns", "formations",
  "letters", "maps", "personnel", "political-docs", "timeline",
] as const;

/**
 * Hand-maintained content (homepage.json, about/, legal/, …) is NOT versioned:
 * it is edited live through the Admin rather than promoted, so freezing it
 * into a version would stop edits appearing. Those paths keep being served
 * straight from public/data exactly as they are today.
 *
 * `nsdap` is deliberately absent despite being a publish type. All 23 of its
 * files are edited through the Admin (nsdap-admin.js), it has no database
 * source and no index regenerator, and its record URLs come from a static
 * DATA_MAP rather than from its index — so there is no index-to-record
 * derivation for a version pin to protect, and versioning it would only
 * freeze editorial text until someone ran a promotion.
 */
export function isVersionedType(type: string): boolean {
  return (VERSIONED_TYPES as readonly string[]).includes(type);
}

/** Strict: "v" followed by a positive integer with no leading zero. */
const VERSION_ID = /^v[1-9][0-9]{0,14}$/;

export function isValidVersionId(id: unknown): id is string {
  return typeof id === "string" && VERSION_ID.test(id);
}

/** How many consecutive ids a single capture will try before giving up. */
const ID_ALLOCATION_ATTEMPTS = 25;

/** At least this many versions older than the active one are kept. */
export const MIN_RETAINED_PRIOR = 3;

interface ActivePointer {
  version: string;
  updatedAt: string;
}

export interface PruneResult {
  kept: string[];
  pruned: string[];
  protectedFromPrune: string[];
}

export interface VersionStore {
  readonly root: string;
  readonly versionsRoot: string;
  readonly pointerFile: string;
  versionDir(id: string): string;
  resolveVersionedPath(id: string, relPath: string): string;
  readActiveVersion(): Promise<string | null>;
  writeActiveVersion(id: string): Promise<void>;
  versionExists(id: string): Promise<boolean>;
  listVersions(): Promise<string[]>;
  createVersionFrom(sourceDir?: string): Promise<string>;
  claimVersion(id: string): () => void;
  claimedVersions(): string[];
  pruneVersions(opts?: { keepPrior?: number; alsoProtect?: string[] }): Promise<PruneResult>;
}

export function createVersionStore(root: string): VersionStore {
  const versionsRoot = path.join(root, "versions");
  const pointerFile = path.join(root, "active.json");

  // A promotion or rollback holds a claim on the versions it is reading or
  // writing. Retention consults this, so a long-running operation can never
  // have the ground removed from under it by a concurrent prune.
  const inFlight = new Map<string, number>();

  function versionDir(id: string): string {
    if (!isValidVersionId(id)) throw new Error(`Invalid version id: ${JSON.stringify(id)}`);
    return path.join(versionsRoot, id);
  }

  /**
   * Resolves a file inside one version. Both arguments are untrusted — the
   * version id is checked against the pattern and the relative path is
   * constrained to the version directory, so neither can address anything else.
   */
  function resolveVersionedPath(id: string, relPath: string): string {
    return resolveWithin(versionDir(id), relPath, "content path");
  }

  /** The live version, or null when versioning has never been used. */
  async function readActiveVersion(): Promise<string | null> {
    try {
      const parsed = JSON.parse(await fs.readFile(pointerFile, "utf-8")) as Partial<ActivePointer>;
      return isValidVersionId(parsed.version) ? parsed.version : null;
    } catch {
      return null;
    }
  }

  async function versionExists(id: string): Promise<boolean> {
    if (!isValidVersionId(id)) return false;
    try {
      return (await fs.stat(versionDir(id))).isDirectory();
    } catch {
      return false;
    }
  }

  /**
   * Flips the pointer in one step. The pointer is written to a temp file and
   * renamed over the old one, so a reader sees either the whole previous
   * pointer or the whole new one — never a partial write, and never a missing
   * file in between.
   */
  async function writeActiveVersion(id: string): Promise<void> {
    if (!isValidVersionId(id)) throw new Error(`Invalid version id: ${JSON.stringify(id)}`);
    if (!(await versionExists(id))) {
      throw new Error(`Cannot activate "${id}": that version directory does not exist`);
    }
    await fs.mkdir(root, { recursive: true });
    const payload: ActivePointer = { version: id, updatedAt: new Date().toISOString() };
    const tmp = path.join(root, `.active-${randomUUID()}.json`);
    await fs.writeFile(tmp, JSON.stringify(payload, null, 2), "utf-8");
    await fs.rename(tmp, pointerFile);
  }

  /** Every retained version, oldest first. Ordered numerically, not lexically. */
  async function listVersions(): Promise<string[]> {
    let entries: import("fs").Dirent[];
    try {
      entries = await fs.readdir(versionsRoot, { withFileTypes: true });
    } catch {
      return [];
    }
    return entries
      .filter((e) => e.isDirectory() && isValidVersionId(e.name))
      .map((e) => e.name)
      .sort((a, b) => Number(a.slice(1)) - Number(b.slice(1)));
  }

  /**
   * The highest version number any entry in the versions root has used,
   * whether or not it is a usable version directory.
   *
   * listVersions() deliberately reports only directories, but allocation has
   * to account for everything: a leftover or stray entry with a
   * version-shaped name must not be handed out again as the next id.
   */
  async function highestAllocated(): Promise<number> {
    let entries: import("fs").Dirent[];
    try {
      entries = await fs.readdir(versionsRoot, { withFileTypes: true });
    } catch {
      return 0;
    }
    let highest = 0;
    for (const e of entries) {
      if (!isValidVersionId(e.name)) continue;
      highest = Math.max(highest, Number(e.name.slice(1)));
    }
    return highest;
  }

  /**
   * Captures `sourceDir` as a new version. The copy is assembled under a temp
   * name and renamed into place, so a half-copied directory is never visible
   * as a version and never selectable by the resolver.
   */
  async function createVersionFrom(sourceDir: string = paths.published.root): Promise<string> {
    await fs.mkdir(versionsRoot, { recursive: true });
    const tmpDir = path.join(versionsRoot, `.tmp-${randomUUID()}`);

    await fs.mkdir(tmpDir, { recursive: true });
    try {
      for (const type of VERSIONED_TYPES) {
        const from = path.join(sourceDir, type);
        try {
          if (!(await fs.stat(from)).isDirectory()) continue;
        } catch {
          continue; // type not present in this archive — nothing to capture
        }
        await fs.cp(from, path.join(tmpDir, type), { recursive: true });
      }

      // Claim an id by renaming onto it. A name already taken — by a
      // concurrent promotion, or by a stray entry — means try the next one,
      // rather than overwriting whatever is there.
      let candidate = (await highestAllocated()) + 1;
      for (let attempt = 0; attempt < ID_ALLOCATION_ATTEMPTS; attempt++, candidate++) {
        const id = `v${candidate}`;
        const target = versionDir(id);
        try {
          await fs.access(target);
          continue; // already taken
        } catch { /* free as far as we can tell */ }
        try {
          await fs.rename(tmpDir, target);
          return id;
        } catch (err) {
          const code = (err as NodeJS.ErrnoException).code;
          if (code === "EEXIST" || code === "ENOTEMPTY" || code === "EPERM" || code === "EACCES") continue;
          throw err;
        }
      }
      throw new Error(
        `Could not allocate a version id after ${ID_ALLOCATION_ATTEMPTS} attempts starting at v${
          (await highestAllocated()) + 1
        }`,
      );
    } catch (err) {
      await fs.rm(tmpDir, { recursive: true, force: true }).catch(() => undefined);
      throw err;
    }
  }

  function claimVersion(id: string): () => void {
    inFlight.set(id, (inFlight.get(id) ?? 0) + 1);
    let released = false;
    return () => {
      if (released) return;
      released = true;
      const n = (inFlight.get(id) ?? 1) - 1;
      if (n <= 0) inFlight.delete(id);
      else inFlight.set(id, n);
    };
  }

  function claimedVersions(): string[] {
    return [...inFlight.keys()];
  }

  /**
   * Keeps the active version plus at least MIN_RETAINED_PRIOR older ones.
   *
   * The active version is never pruned, and neither is any version a
   * promotion or rollback currently holds a claim on — even when that pushes
   * the retained set past the minimum. Retention is a floor, not a quota.
   */
  async function pruneVersions(opts: { keepPrior?: number; alsoProtect?: string[] } = {}): Promise<PruneResult> {
    const keepPrior = Math.max(opts.keepPrior ?? MIN_RETAINED_PRIOR, MIN_RETAINED_PRIOR);
    const all = await listVersions(); // oldest first
    const active = await readActiveVersion();

    const protectedIds = new Set<string>([...claimedVersions(), ...(opts.alsoProtect ?? [])]);
    if (active) protectedIds.add(active);

    // Everything from the active version onward is retained, plus the N
    // immediately preceding it. A version newer than active (built but never
    // activated) is retained rather than silently discarded.
    const activeIndex = active ? all.indexOf(active) : all.length - 1;
    const firstKeptIndex = Math.max(0, activeIndex - keepPrior);

    const kept: string[] = [];
    const pruned: string[] = [];
    const protectedFromPrune: string[] = [];

    for (let i = 0; i < all.length; i++) {
      const id = all[i];
      if (i >= firstKeptIndex) { kept.push(id); continue; }
      if (protectedIds.has(id)) { kept.push(id); protectedFromPrune.push(id); continue; }
      await fs.rm(versionDir(id), { recursive: true, force: true });
      pruned.push(id);
    }

    return { kept, pruned, protectedFromPrune };
  }

  return {
    root, versionsRoot, pointerFile,
    versionDir, resolveVersionedPath,
    readActiveVersion, writeActiveVersion,
    versionExists, listVersions, createVersionFrom,
    claimVersion, claimedVersions, pruneVersions,
  };
}

/** The store this application uses. */
export const versionStore = createVersionStore(path.join(storageConfig.basePath, "published"));
