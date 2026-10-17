import fs from "fs/promises";
import path from "path";
import { paths } from "../../config/paths";

/**
 * Which files under public/data/ the Admin may read and write.
 *
 * This is the real security boundary for editorial writes: editorial content
 * shares a directory with generated archive output, so path containment alone
 * would still let a save land on a published record.
 *
 * Prefix matching: a key is allowed if it equals an entry, or begins with one
 * followed by "/".
 */
export const ALLOWED_PREFIXES: readonly string[] = [
  "navigation.json",
  "site-settings.json",
  "homepage.json",
  "page-content.json",
  "ui-strings.json",
  "about",
  "legal",
  "site-policies",
  "nsdap",
  // "formations" was here as a bare prefix, which permitted writing any file
  // under public/data/formations/ through this API even though no Admin screen
  // does so — formations records are edited in PostgreSQL through
  // /api/formations. Removing it closes a write path nothing used, and keeps
  // formations' published output owned solely by the publish pipeline.
  //
  // Section manifests: labels and ordering are editorial, but the file
  // listings inside them are regenerated at promotion time. Writes to those
  // generated fields are rejected — see content-validation.ts.
  "armaments/index.json",
  "campaigns/index.json",
  "personnel/index.json",
  "letters/index.json",
  "articles/index.json",
  "awards/index.json",
  "maps/index.json",
  "political-docs/index.json",
];

export function isAllowedKey(key: string): boolean {
  return ALLOWED_PREFIXES.some((prefix) => key === prefix || key.startsWith(`${prefix}/`));
}

/**
 * Every editorial file that currently exists, as POSIX-style keys.
 *
 * Derived from the allowlist and the filesystem rather than hard-coded, so an
 * export covers exactly what this API can change — no more, no less.
 */
export async function listEditorialKeys(root: string = paths.editorial.root): Promise<string[]> {
  const found = new Set<string>();

  const walk = async (dir: string, rel: string): Promise<void> => {
    let entries: import("fs").Dirent[];
    try {
      entries = await fs.readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const childRel = rel ? `${rel}/${entry.name}` : entry.name;
      if (entry.isDirectory()) {
        await walk(path.join(dir, entry.name), childRel);
      } else if (entry.name.endsWith(".json") && isAllowedKey(childRel)) {
        found.add(childRel);
      }
    }
  };

  for (const prefix of ALLOWED_PREFIXES) {
    const full = path.join(root, prefix);
    let stat: import("fs").Stats;
    try {
      stat = await fs.stat(full);
    } catch {
      continue; // allowlisted but not present
    }
    if (stat.isDirectory()) await walk(full, prefix);
    else if (prefix.endsWith(".json")) found.add(prefix);
  }

  return [...found].sort();
}
