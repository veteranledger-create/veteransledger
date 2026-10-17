import fs from "fs/promises";
import os from "os";
import path from "path";
import { randomUUID } from "crypto";
import { storageConfig } from "../../config/storage";
import { paths } from "../../config/paths";
import { resolveWithin } from "../../utilities/safe-path";
import { listEditorialKeys } from "../site-content/editable-keys";
import { createTar, readTar } from "./tar";
import { sha256, revisionStore, RevisionStore } from "./revision-store";

/**
 * Manual export of the editorial set.
 *
 * Deliberately a command, not a job. There is no schedule, no remote, no
 * credential and no network call anywhere in this module — the archive is
 * written to local storage and getting it somewhere safe is an operator
 * action outside this application. That boundary is the point: an application
 * that can push to a remote on its own is an application whose compromise can
 * also overwrite the backups.
 *
 * Which means the archive on its own is NOT off-volume protection, and this
 * module never reports it as such. `offVolume` is a constant false, and the
 * status it reports says where the archive actually is.
 */

export interface ExportedFile {
  key: string;
  sha256: string;
  bytes: number;
}

export interface ExportManifest {
  createdAt: string;
  archive: string;
  /** SHA-256 of the archive file's exact bytes — matches `sha256sum <archive>`. */
  archiveSha256: string;
  archiveBytes: number;
  fileCount: number;
  totalBytes: number;
  /** Sorted by key, so the manifest is byte-reproducible for equal input. */
  files: ExportedFile[];
  /**
   * Always false. The archive sits on the same storage volume as the content
   * it protects, so it survives an accidental edit but not a volume loss.
   */
  offVolume: false;
  archiveDirectory: string;
  note: string;
}

export type ExportState = "never-exported" | "stale" | "current";

export interface ExportStatus {
  state: ExportState;
  lastExportAt: string | null;
  archive: string | null;
  /** Keys whose current bytes differ from the last export, or are new. */
  staleFiles: string[];
  /** Keys in the last export that no longer exist. */
  removedFiles: string[];
  staleFileCount: number;
  newestRevisionAt: string | null;
  offVolume: false;
  archiveDirectory: string;
  message: string;
}

const EXPORTS_DIRNAME = "exports";
const MANIFEST = "manifest.json";

function exportsDir(root: string): string {
  return path.join(root, EXPORTS_DIRNAME);
}

function stamp(at: Date): string {
  return at.toISOString().replace(/[-:]/g, "").replace(/\.(\d{3})Z$/, "$1Z");
}

async function writeDurable(fullPath: string, data: string | Buffer): Promise<void> {
  const dir = path.dirname(fullPath);
  await fs.mkdir(dir, { recursive: true });
  const tmp = path.join(dir, `.tmp-${randomUUID()}`);
  const handle = await fs.open(tmp, "w");
  try {
    await handle.writeFile(data);
    await handle.sync();
  } finally {
    await handle.close();
  }
  try {
    await fs.rename(tmp, fullPath);
  } catch (err) {
    await fs.rm(tmp, { force: true }).catch(() => undefined);
    throw err;
  }
}

export interface EditorialExporter {
  run(options?: { now?: Date }): Promise<ExportManifest>;
  status(): Promise<ExportStatus>;
  readManifest(): Promise<ExportManifest | null>;
}

export function createEditorialExporter(
  root: string = path.join(storageConfig.basePath, "editorial"),
  contentRoot: string = paths.editorial.root,
  store: RevisionStore = revisionStore,
): EditorialExporter {
  async function readManifest(): Promise<ExportManifest | null> {
    try {
      return JSON.parse(await fs.readFile(path.join(exportsDir(root), MANIFEST), "utf-8")) as ExportManifest;
    } catch {
      return null;
    }
  }

  /**
   * Builds the archive, then proves it by reading it back off disk, extracting
   * it to a temporary directory, and checking every file's bytes and hash.
   * The manifest is only written once that has passed, so a manifest always
   * describes an archive that was verified after being written — not one the
   * writer merely believes it produced.
   */
  async function run(options: { now?: Date } = {}): Promise<ExportManifest> {
    const now = options.now ?? new Date();
    const keys = await listEditorialKeys(contentRoot);
    if (keys.length === 0) {
      throw new Error("Nothing to export: no editorial files found");
    }

    const files: ExportedFile[] = [];
    const entries: Array<{ name: string; content: string }> = [];
    for (const key of keys) {
      const content = await fs.readFile(resolveWithin(contentRoot, key, "key"), "utf-8");
      files.push({ key, sha256: sha256(content), bytes: Buffer.byteLength(content, "utf-8") });
      entries.push({ name: key, content });
    }

    const archiveName = `${stamp(now)}.tar`;
    const archivePath = path.join(exportsDir(root), archiveName);
    const archive = createTar(entries);
    await writeDurable(archivePath, archive);

    const manifest: ExportManifest = {
      createdAt: now.toISOString(),
      archive: archiveName,
      // The archive buffer itself, so the digest is what sha256sum reports.
      archiveSha256: sha256(archive),
      archiveBytes: archive.length,
      fileCount: files.length,
      totalBytes: files.reduce((sum, f) => sum + f.bytes, 0),
      files,
      offVolume: false,
      archiveDirectory: exportsDir(root),
      note:
        "This archive is on the same storage volume as the content it contains. " +
        "It protects against an accidental edit, not against loss of the volume. " +
        "Copy it elsewhere for that.",
    };

    try {
      await verify(archivePath, manifest);
    } catch (err) {
      // An archive that cannot be verified must not be left behind looking
      // like a backup, and must never gain a manifest.
      await fs.rm(archivePath, { force: true }).catch(() => undefined);
      throw err;
    }

    await writeDurable(path.join(exportsDir(root), MANIFEST), `${JSON.stringify(manifest, null, 2)}\n`);
    return manifest;
  }

  /** Extracts the archive to a temp directory and checks it against `manifest`. */
  async function verify(archivePath: string, manifest: ExportManifest): Promise<void> {
    const onDisk = await fs.readFile(archivePath);
    if (onDisk.length !== manifest.archiveBytes) {
      throw new Error(`Archive is ${onDisk.length} bytes on disk but the manifest says ${manifest.archiveBytes}`);
    }
    const actualHash = sha256(onDisk);
    if (actualHash !== manifest.archiveSha256) {
      throw new Error("Archive failed its own checksum after being written");
    }

    const extractDir = await fs.mkdtemp(path.join(os.tmpdir(), "vl-export-verify-"));
    try {
      const extracted = readTar(onDisk);
      if (extracted.length !== manifest.fileCount) {
        throw new Error(`Archive holds ${extracted.length} files but the manifest lists ${manifest.fileCount}`);
      }

      const byKey = new Map(extracted.map((e) => [e.name, e.content]));
      for (const expected of manifest.files) {
        const content = byKey.get(expected.key);
        if (content === undefined) throw new Error(`Archive is missing "${expected.key}"`);

        // Written out and re-read, so the check covers the extraction too,
        // not just the in-memory parse.
        const out = resolveWithin(extractDir, expected.key, "key");
        await fs.mkdir(path.dirname(out), { recursive: true });
        await fs.writeFile(out, content, "utf-8");
        const roundTripped = await fs.readFile(out, "utf-8");

        const bytes = Buffer.byteLength(roundTripped, "utf-8");
        if (bytes !== expected.bytes) {
          throw new Error(`"${expected.key}" extracted as ${bytes} bytes, expected ${expected.bytes}`);
        }
        if (sha256(roundTripped) !== expected.sha256) {
          throw new Error(`"${expected.key}" failed its checksum after extraction`);
        }
      }
    } finally {
      await fs.rm(extractDir, { recursive: true, force: true }).catch(() => undefined);
    }
  }

  async function status(): Promise<ExportStatus> {
    const manifest = await readManifest();

    let newestRevisionAt: string | null = null;
    for (const key of await store.keys()) {
      for (const revision of await store.list(key)) {
        if (newestRevisionAt === null || revision.recordedAt > newestRevisionAt) {
          newestRevisionAt = revision.recordedAt;
        }
      }
    }

    const base = {
      newestRevisionAt,
      offVolume: false as const,
      archiveDirectory: exportsDir(root),
    };

    if (!manifest) {
      const keys = await listEditorialKeys(contentRoot);
      return {
        ...base,
        state: "never-exported",
        lastExportAt: null,
        archive: null,
        staleFiles: keys,
        removedFiles: [],
        staleFileCount: keys.length,
        message:
          "No export has ever been taken. The editorial set has no recovery copy " +
          "outside the live files and whatever Git last recorded.",
      };
    }

    const current = await listEditorialKeys(contentRoot);
    const exported = new Map(manifest.files.map((f) => [f.key, f]));

    const staleFiles: string[] = [];
    for (const key of current) {
      const previous = exported.get(key);
      if (!previous) {
        staleFiles.push(key);
        continue;
      }
      const content = await fs.readFile(resolveWithin(contentRoot, key, "key"), "utf-8").catch(() => null);
      if (content === null || sha256(content) !== previous.sha256) staleFiles.push(key);
    }
    const removedFiles = manifest.files.map((f) => f.key).filter((k) => !current.includes(k));

    const stale = staleFiles.length > 0 || removedFiles.length > 0;
    return {
      ...base,
      state: stale ? "stale" : "current",
      lastExportAt: manifest.createdAt,
      archive: manifest.archive,
      staleFiles,
      removedFiles,
      staleFileCount: staleFiles.length + removedFiles.length,
      message: stale
        ? `${staleFiles.length + removedFiles.length} file(s) have changed since the last export on ${manifest.createdAt}.`
        : `Every editorial file matches the export taken on ${manifest.createdAt}. ` +
          "That archive is on the same volume as the content, so it is not off-volume protection.",
    };
  }

  return { run, status, readManifest };
}

export const editorialExporter = createEditorialExporter();
