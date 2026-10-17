import fs from "fs/promises";
import path from "path";
import { createHash, randomUUID } from "crypto";
import { storageConfig } from "../../config/storage";
import { normalizeRelativePath, resolveWithin } from "../../utilities/safe-path";

/**
 * Per-save history for hand-maintained editorial content.
 *
 * The editable file never moves: it stays at public/data/<key>, served by the
 * same URL as always. What this adds is an append-only log beside it, so a
 * save can be undone and so the editorial set has a recovery path that does
 * not depend on the publish pipeline (which does not own these files) or on
 * Git (which only has what was last committed).
 *
 * Layout, under <storage>/editorial/:
 *   history/<key>/revisions.json       the log
 *   history/<key>/<revision-id>.json   immutable byte-for-byte copies
 *
 * Revisions store the file's RAW BYTES, not a re-serialisation. The files on
 * disk do not all match what JSON.stringify would produce — none of the 23
 * NSDAP files do — so re-serialising would silently reformat content a
 * restore is supposed to reproduce exactly.
 *
 * A factory rather than a module of constants, so tests exercise a real store
 * on a throwaway root instead of the project's own.
 */

export type RevisionSource = "save" | "restore" | "captured";

export interface Revision {
  /** Sorts lexically in chronological order. */
  id: string;
  sha256: string;
  bytes: number;
  recordedAt: string;
  actor: string | null;
  note: string | null;
  /**
   * "captured" marks a revision taken from a file that was already on disk —
   * the state before this log existed, or an edit made outside this API.
   */
  source: RevisionSource;
}

interface RevisionLog {
  key: string;
  revisions: Revision[];
}

export interface ReconcileReport {
  key: string;
  /** Blob files that were present but missing from the log, now adopted. */
  adopted: string[];
  /** Log entries whose blob is gone. The log keeps them; the content is lost. */
  missingBlobs: string[];
  /** Blob files whose bytes no longer match their recorded hash. */
  corrupt: string[];
}

export interface RevisionStore {
  readonly root: string;
  historyDir(key: string): string;
  list(key: string): Promise<Revision[]>;
  /** Raw bytes of one revision, hash- and length-verified before returning. */
  read(key: string, revisionId: string): Promise<string>;
  /**
   * Records `content` as a new revision and only then writes it to
   * `targetFile`. If anything about recording fails, the target file is left
   * exactly as it was.
   */
  recordAndApply(args: {
    key: string;
    targetFile: string;
    content: string;
    actor?: string | null;
    note?: string | null;
    source?: RevisionSource;
  }): Promise<Revision>;
  reconcile(key: string): Promise<ReconcileReport>;
  keys(): Promise<string[]>;
}

/**
 * SHA-256 of exactly these bytes.
 *
 * A string is hashed as UTF-8, which is how the editorial files are read and
 * written, so a per-file digest matches what `sha256sum` reports for that
 * file. A Buffer is hashed as-is — passing `buffer.toString("binary")` here
 * instead would re-encode every byte above 0x7F through latin1 into two UTF-8
 * bytes and produce a digest no standard tool can reproduce.
 */
export function sha256(data: string | Buffer): string {
  return typeof data === "string"
    ? createHash("sha256").update(data, "utf-8").digest("hex")
    : createHash("sha256").update(data).digest("hex");
}

/** Compact ISO, so revision ids sort chronologically as plain strings. */
function stamp(at: Date): string {
  return at.toISOString().replace(/[-:]/g, "").replace(/\.(\d{3})Z$/, "$1Z");
}

const LOG_FILE = "revisions.json";

/**
 * Writes via a temp file and a rename, flushing the file itself before the
 * rename so the bytes are on disk and not only in the page cache. The
 * directory flush that would also guarantee the rename itself is attempted
 * but not required — it is not supported on every platform.
 */
async function writeDurable(fullPath: string, data: string): Promise<void> {
  const dir = path.dirname(fullPath);
  await fs.mkdir(dir, { recursive: true });
  const tmp = path.join(dir, `.tmp-${randomUUID()}`);

  const handle = await fs.open(tmp, "w");
  try {
    await handle.writeFile(data, "utf-8");
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

  const dirHandle = await fs.open(dir, "r").catch(() => null);
  if (dirHandle) {
    await dirHandle.sync().catch(() => undefined); // unsupported on some platforms
    await dirHandle.close().catch(() => undefined);
  }
}

export function createRevisionStore(root: string): RevisionStore {
  const historyRoot = path.join(root, "history");

  // Saves to the same key are serialised. The log is a read-modify-write, so
  // two concurrent saves would otherwise race and one entry would be lost.
  // This process is the only writer (a single Express server), which is what
  // makes an in-process lock sufficient; see the module's known limitations.
  const locks = new Map<string, Promise<unknown>>();

  function withLock<T>(key: string, fn: () => Promise<T>): Promise<T> {
    const previous = locks.get(key) ?? Promise.resolve();
    // Run regardless of whether the previous holder resolved or rejected.
    const run = previous.then(fn, fn);
    locks.set(
      key,
      run.then(
        () => undefined,
        () => undefined,
      ),
    );
    return run;
  }

  function historyDir(key: string): string {
    return resolveWithin(historyRoot, normalizeRelativePath(key, "key"), "key");
  }

  function logPath(key: string): string {
    return path.join(historyDir(key), LOG_FILE);
  }

  function blobPath(key: string, revisionId: string): string {
    // Revision ids are generated here, never supplied by a caller, but the
    // restore path accepts one from a request — so it is constrained too.
    if (!/^[0-9]{8}T[0-9]{9}Z-[0-9a-f]{8}$/.test(revisionId)) {
      throw new Error(`Invalid revision id: ${JSON.stringify(revisionId)}`);
    }
    return path.join(historyDir(key), `${revisionId}.json`);
  }

  async function readLog(key: string): Promise<RevisionLog> {
    try {
      const parsed = JSON.parse(await fs.readFile(logPath(key), "utf-8")) as Partial<RevisionLog>;
      if (Array.isArray(parsed.revisions)) return { key, revisions: parsed.revisions };
    } catch {
      // absent or unreadable — treated as no history yet, never as an error,
      // so a damaged log cannot block editing. reconcile() surfaces it.
    }
    return { key, revisions: [] };
  }

  async function writeLog(log: RevisionLog): Promise<void> {
    await writeDurable(logPath(log.key), `${JSON.stringify(log, null, 2)}\n`);
  }

  async function list(key: string): Promise<Revision[]> {
    return (await readLog(key)).revisions;
  }

  async function read(key: string, revisionId: string): Promise<string> {
    const log = await readLog(key);
    const entry = log.revisions.find((r) => r.id === revisionId);
    if (!entry) throw new Error(`Revision ${revisionId} is not recorded for "${key}"`);

    const content = await fs.readFile(blobPath(key, revisionId), "utf-8");
    const actualBytes = Buffer.byteLength(content, "utf-8");
    if (actualBytes !== entry.bytes) {
      throw new Error(
        `Revision ${revisionId} of "${key}" is ${actualBytes} bytes but was recorded as ${entry.bytes}`,
      );
    }
    const actualHash = sha256(content);
    if (actualHash !== entry.sha256) {
      throw new Error(
        `Revision ${revisionId} of "${key}" failed its checksum (recorded ${entry.sha256.slice(0, 12)}…, found ${actualHash.slice(0, 12)}…)`,
      );
    }
    return content;
  }

  /** Writes one revision blob and appends it to the log. Caller holds the lock. */
  async function append(
    key: string,
    content: string,
    source: RevisionSource,
    actor: string | null,
    note: string | null,
    at: Date,
  ): Promise<Revision> {
    const hash = sha256(content);
    const revision: Revision = {
      id: `${stamp(at)}-${hash.slice(0, 8)}`,
      sha256: hash,
      bytes: Buffer.byteLength(content, "utf-8"),
      recordedAt: at.toISOString(),
      actor,
      note,
      source,
    };

    // Blob first: an orphaned blob is recoverable (reconcile adopts it),
    // whereas a log entry with no blob is content that is simply gone.
    await writeDurable(blobPath(key, revision.id), content);

    const log = await readLog(key);
    log.revisions.push(revision);
    await writeLog(log);

    return revision;
  }

  async function recordAndApply(args: {
    key: string;
    targetFile: string;
    content: string;
    actor?: string | null;
    note?: string | null;
    source?: RevisionSource;
  }): Promise<Revision> {
    const { key, targetFile, content } = args;
    const actor = args.actor ?? null;
    const note = args.note ?? null;
    const source = args.source ?? "save";

    return withLock(key, async () => {
      // Whatever is on disk now may predate this log, or have been edited
      // outside this API. Record it before overwriting it, or that content
      // would be unrecoverable.
      const existing = await fs.readFile(targetFile, "utf-8").catch(() => null);
      if (existing !== null) {
        const log = await readLog(key);
        const latest = log.revisions[log.revisions.length - 1];
        if (!latest || latest.sha256 !== sha256(existing)) {
          await append(key, existing, "captured", null, "state before this save", new Date());
        }
      }

      // The new revision is durable before the editable file is touched. If
      // this throws, the file on disk is still the old content.
      const revision = await append(key, content, source, actor, note, new Date());

      await writeDurable(targetFile, content);
      return revision;
    });
  }

  /**
   * Compares the blobs on disk against the log.
   *
   * A crash between writing a blob and appending to the log leaves an orphan.
   * The blob's own name carries the first 8 hex of its hash, and its bytes are
   * intact, so it can be adopted rather than discarded — content is never
   * thrown away to tidy up metadata.
   */
  async function reconcile(key: string): Promise<ReconcileReport> {
    return withLock(key, async () => {
      const report: ReconcileReport = { key, adopted: [], missingBlobs: [], corrupt: [] };

      let entries: string[];
      try {
        entries = (await fs.readdir(historyDir(key))).filter(
          (n) => n.endsWith(".json") && n !== LOG_FILE && !n.startsWith(".tmp-"),
        );
      } catch {
        return report; // no history directory for this key
      }

      const log = await readLog(key);
      const recorded = new Set(log.revisions.map((r) => r.id));

      for (const entry of log.revisions) {
        if (!entries.includes(`${entry.id}.json`)) report.missingBlobs.push(entry.id);
      }

      const adopted: Revision[] = [];
      for (const name of entries.sort()) {
        const id = name.slice(0, -".json".length);
        if (recorded.has(id)) continue;

        let content: string;
        try {
          content = await fs.readFile(path.join(historyDir(key), name), "utf-8");
        } catch {
          report.corrupt.push(id);
          continue;
        }
        const hash = sha256(content);
        // The id embeds the hash prefix, so a blob that does not match its own
        // name is damaged and must not be adopted as trustworthy history.
        if (!id.endsWith(`-${hash.slice(0, 8)}`)) {
          report.corrupt.push(id);
          continue;
        }
        adopted.push({
          id,
          sha256: hash,
          bytes: Buffer.byteLength(content, "utf-8"),
          recordedAt: new Date().toISOString(),
          actor: null,
          note: "adopted by reconcile: blob was present but unlogged",
          source: "captured",
        });
      }

      if (adopted.length > 0) {
        log.revisions = [...log.revisions, ...adopted].sort((a, b) => a.id.localeCompare(b.id));
        await writeLog(log);
        report.adopted = adopted.map((r) => r.id);
      }

      return report;
    });
  }

  /** Every key that has history, as POSIX-style relative keys. */
  async function keys(): Promise<string[]> {
    const found: string[] = [];
    const walk = async (dir: string, rel: string): Promise<void> => {
      let entries: import("fs").Dirent[];
      try {
        entries = await fs.readdir(dir, { withFileTypes: true });
      } catch {
        return;
      }
      if (entries.some((e) => e.isFile() && e.name === LOG_FILE)) {
        found.push(rel);
        return;
      }
      for (const e of entries) {
        if (e.isDirectory()) await walk(path.join(dir, e.name), rel ? `${rel}/${e.name}` : e.name);
      }
    };
    await walk(historyRoot, "");
    return found.sort();
  }

  return { root, historyDir, list, read, recordAndApply, reconcile, keys };
}

/** The store this application uses. */
export const revisionStore = createRevisionStore(path.join(storageConfig.basePath, "editorial"));
