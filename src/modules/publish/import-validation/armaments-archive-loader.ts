import fs from "fs/promises";
import path from "path";
import { LoadedArmament, extractItems } from "./armament-record-mapper";
import { armamentArchiveManifestProvider } from "./armaments-archive-manifest-provider";

// Armaments-specific archive-record loading — deliberately NOT part of the
// generic framework (archive-manifest-loader.ts / archive-manifest-provider.ts).
// The provider remains responsible only for manifest access (getManifest,
// getArmamentFiles, getArmamentsDirectory); this file is what actually
// reads the individual category/fileNation JSON files the manifest
// declares, and it is the single place that does so.
//
// Unlike Campaigns (one record per file), an Armaments file holds an ARRAY
// of records — either a flat top-level array or an object wrapped under a
// category-specific key. extractItems() (armament-record-mapper.ts) already
// owns that distinction and is reused here unchanged; this file's only job
// is getting each declared file's raw parsed content to extractItems()
// safely, exactly once per file, per run.
//
// loadArmamentsArchive() is NOT wired into runArmamentsImport()/
// runArmamentsImportDryRun()/buildImportPreview() yet — the old
// loadAllArmaments() (armaments-import-check.ts) remains the production
// path until a later phase. Nothing here is cached beyond a single call —
// the returned object is a plain, disposable snapshot; calling this
// function again always re-reads from disk. This is deliberately NOT a
// global cache.

export interface ArmamentArchiveFileEntry {
  category: string;
  fileNation: string;
  relPath: string;
  /** Parsed JSON content of any shape, or undefined if the file could not be read or parsed. */
  raw: unknown;
  /**
   * Only meaningful when raw is undefined. True if the failure happened
   * reading the file itself (permission denied, removed between the
   * readdir listing and the read, other I/O error) — false/absent means
   * the read succeeded but JSON.parse failed. Same distinction Campaigns'
   * loader makes, for the same reason: a future integrity validator must
   * never mislabel one as the other.
   */
  readError?: boolean;
}

export interface LoadedArmamentsArchive {
  /**
   * Every .json file physically present in every category folder the
   * manifest declares at least one active file for — declared or not.
   * This single scan is what both "read every declared file" and "find
   * undeclared files" are built from; a file is read from disk exactly
   * once here regardless of how many downstream checks need its content.
   */
  filesOnDisk: ArmamentArchiveFileEntry[];
  /**
   * Every record extracted from declared, successfully-parsed files —
   * flattened across all files, in the same shape loadAllArmaments() has
   * always produced (armament-record-mapper.ts's LoadedArmament). A
   * declared file that is missing, unreadable, or fails to parse simply
   * contributes zero entries here (never thrown) — callers that need to
   * know *why* look it up in filesOnDisk instead. Classifying these states
   * is a future integrity validator's job, not this loader's — this file
   * invents no violations of its own.
   */
  declaredItems: LoadedArmament[];
}

function lookupRaw(filesOnDisk: ArmamentArchiveFileEntry[]): (relPath: string) => unknown {
  const index = new Map<string, unknown>();
  for (const entry of filesOnDisk) index.set(entry.relPath, entry.raw);
  return (relPath) => index.get(relPath);
}

export async function loadArmamentsArchive(): Promise<LoadedArmamentsArchive> {
  const armamentsDir = armamentArchiveManifestProvider.getArmamentsDirectory();
  const armamentFiles = armamentArchiveManifestProvider.getArmamentFiles();
  const manifest = armamentArchiveManifestProvider.getManifest();

  // Scan every category folder that's either declared-active or referenced
  // by an obsolete entry's "file"/"replacedBy" — mirrors Campaigns'
  // loader exactly. The Phase A manifest's obsolete list is currently
  // empty, so this expansion is a no-op today, but a future obsolete
  // entry never silently stops being scanned because of it.
  const categories = new Set<string>(Object.keys(armamentFiles));
  for (const entry of manifest.obsolete) {
    categories.add(entry.file.slice(0, entry.file.indexOf("/")));
    categories.add(entry.replacedBy.slice(0, entry.replacedBy.indexOf("/")));
  }

  const filesOnDisk: ArmamentArchiveFileEntry[] = [];

  for (const category of categories) {
    const dir = path.join(armamentsDir, category);
    let onDiskFilenames: string[];
    try {
      onDiskFilenames = (await fs.readdir(dir)).filter((f) => f.endsWith(".json"));
    } catch {
      onDiskFilenames = [];
    }

    for (const filename of onDiskFilenames) {
      const relPath = `${category}/${filename}`;
      let raw: unknown;
      let readError = false;
      let content: string | undefined;
      try {
        content = await fs.readFile(path.join(dir, filename), "utf-8");
      } catch {
        readError = true;
      }
      if (content !== undefined) {
        try {
          raw = JSON.parse(content);
        } catch {
          raw = undefined;
        }
      }
      filesOnDisk.push({
        category,
        fileNation: filename.replace(/\.json$/, ""),
        relPath,
        raw,
        ...(readError ? { readError: true } : {}),
      });
    }
  }

  const findRaw = lookupRaw(filesOnDisk);
  const declaredItems: LoadedArmament[] = [];
  for (const [category, filenames] of Object.entries(armamentFiles)) {
    for (const filename of filenames) {
      const relPath = `${category}/${filename}`;
      const raw = findRaw(relPath);
      if (raw === undefined) continue;
      const fileNation = filename.replace(/\.json$/, "");
      // A declared file containing the literal JSON value `null` parses
      // successfully (raw !== undefined — this is not "missing" or
      // "malformed"), but extractItems() casts non-array raw to an object
      // and reads a wrapper key off it — null[wrapperKey] throws before
      // this would ever reach a future conformance check. Coerced to []
      // (an empty container), not {} (Campaigns' choice for its
      // one-record-per-file model) — Armaments' unit of "nothing here" is
      // a file holding zero records, so [] lands the file on
      // extractItems()'s own existing empty-flat-array path rather than
      // inventing a new one.
      const { items, schemaType } = extractItems(raw === null ? [] : raw, category);
      for (const item of items) {
        declaredItems.push({ category, fileNation, schemaType, item });
      }
    }
  }

  return { filesOnDisk, declaredItems };
}
