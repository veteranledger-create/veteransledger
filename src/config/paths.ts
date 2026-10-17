import path from "path";
import { config } from "./app";
import { storageConfig } from "./storage";
import { normalizeRelativePath, resolveWithin } from "../utilities/safe-path";

/**
 * Role-based filesystem roots.
 *
 * Until now, every module that needed a content directory built its own path
 * — some from `__dirname`, some from `process.cwd()`, each with its own
 * containment check. That made it impossible to answer, by reading the code,
 * which directories are *inputs* the pipeline reads, which are *outputs* it
 * generates, and which hold content an administrator edits by hand.
 *
 * Today three of those roles share one directory, `public/data`:
 *
 *   repoInput  — archive manifests and source JSON the importers READ
 *   published  — generated per-record output the promotion service WRITES
 *   editorial  — hand-maintained JSON the Admin WRITES via /api/site-content
 *
 * They are given separate names here precisely *because* they are currently
 * the same directory. That overlap is the thing that has caused incidents:
 * an editorial write landing on generated output is silently destructive,
 * and nothing in the old code made the boundary visible. Naming the roles
 * now means a later phase can relocate one of them by changing a single
 * constant, instead of auditing every call site again.
 *
 * This module deliberately changes no location. Every accessor resolves to
 * exactly where its data lives today.
 */

/** Repository root — the checkout itself. */
const ROOT = config.paths.root;

/** Everything served under the /public URL prefix (see app.ts). */
const PUBLIC_ROOT = config.paths.public;

/** The one directory that currently backs three different roles. */
const PUBLIC_DATA = path.join(PUBLIC_ROOT, "data");

/** The URL prefix `public/` is mounted at. Public URLs must not change. */
const PUBLIC_URL_PREFIX = "/public";

/**
 * Immutable repository inputs: archive manifests and source JSON that the
 * import/validation pipeline READS and must never write to.
 */
const repoInput = {
  root: PUBLIC_DATA,
  /** e.g. dir("armaments") -> <repo>/public/data/armaments */
  dir(type: string): string {
    return resolveWithin(PUBLIC_DATA, type, "content type");
  },
  /** e.g. file("timeline", "events.json") */
  file(type: string, relPath: string): string {
    return resolveWithin(this.dir(type), relPath, "input path");
  },
};

/**
 * Generated output staged for review. Written wholesale by
 * writeStagedFilesAtomically, which fully owns this directory — nothing else
 * may ever be placed here.
 */
const staging = {
  root: storageConfig.directories.publishStaging,
  dir(type: string): string {
    return resolveWithin(storageConfig.directories.publishStaging, type, "content type");
  },
};

/**
 * The active published archive — what the public site actually serves. Only
 * the promotion service writes here, and only to the exact relative paths it
 * staged.
 */
const published = {
  root: PUBLIC_DATA,
  dir(type: string): string {
    return resolveWithin(PUBLIC_DATA, type, "content type");
  },
  file(type: string, relPath: string): string {
    return resolveWithin(this.dir(type), relPath, "published path");
  },
  /**
   * The public URL a published file is served at. Frontend fetches depend on
   * this exact shape, so it is derived from the mount point rather than
   * hard-coded per call site.
   */
  url(type: string, relPath?: string): string {
    const tail = relPath ? `/${normalizeRelativePath(relPath, "published path")}` : "";
    return `${PUBLIC_URL_PREFIX}/data/${normalizeRelativePath(type, "content type")}${tail}`;
  },
};

/**
 * Hand-maintained content edited through the Admin. Shares a directory with
 * `published` today, which is exactly why site-content.service.ts enforces an
 * allowlist on top of this resolver — containment alone is not enough to stop
 * an editorial save from overwriting generated archive output.
 */
const editorial = {
  root: PUBLIC_DATA,
  /** Resolve an editorial key such as "homepage.json" or "about/mission.json". */
  resolve(key: string): string {
    return resolveWithin(PUBLIC_DATA, key, "key");
  },
};

/**
 * Static assets reachable over HTTP, for translating between a stored URL
 * and the file behind it (media attribution, content-health checks).
 */
const publicAsset = {
  root: PUBLIC_ROOT,
  urlPrefix: PUBLIC_URL_PREFIX,
  /**
   * Filesystem path for a "/public/..." URL, or null if it is not one — or
   * if it could not be resolved safely. Callers scan URLs found in content
   * files, so a malformed or traversing URL must read as unresolvable rather
   * than aborting the scan or escaping the public root.
   */
  fromUrl(url: string): string | null {
    const prefix = `${PUBLIC_URL_PREFIX}/`;
    if (!url.startsWith(prefix)) return null;
    try {
      return resolveWithin(PUBLIC_ROOT, url.slice(prefix.length), "public url");
    } catch {
      return null;
    }
  },
};

export const paths = { root: ROOT, repoInput, staging, published, editorial, publicAsset };
