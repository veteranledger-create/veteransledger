import express from "express";
import fs from "fs/promises";
import { isValidVersionId, isVersionedType, versionStore, VersionStore } from "./version-store";

/**
 * Serves published archive content for a specific version.
 *
 * Mounted at /public/data ahead of the existing express.static("/public"), so
 * the public URLs themselves are unchanged. Three cases:
 *
 *   ?v=<id>  — serve that exact version, or 410 Gone if it has been pruned.
 *   no ?v=   — serve the active version and say which one that was, so the
 *              client can pin its follow-up record requests to it.
 *   neither  — fall through to express.static untouched.
 *
 * The last case is what makes this safe to deploy before versioning is in
 * use: with no version store on disk, every request falls through and the
 * site behaves exactly as it did before.
 *
 * Why the active version is served from the version directory rather than
 * from public/data: the response header has to name the version the bytes
 * actually came from. Reading the pointer and then letting static read
 * public/data leaves a window where a promotion lands between the two, and
 * the client would pin records to a version its index did not come from. No
 * ordering of "write content" and "flip pointer" closes that window — only
 * reading both from the same immutable snapshot does.
 */

export const CONTENT_VERSION_HEADER = "X-Content-Version";

async function statFile(fullPath: string): Promise<import("fs").Stats | null> {
  try {
    const s = await fs.stat(fullPath);
    return s.isFile() ? s : null;
  } catch {
    return null;
  }
}

/** The leading path segment identifies the content type ("armaments/…"). */
function typeOf(relPath: string): string {
  return relPath.split("/")[0] ?? "";
}

/**
 * A validator that identifies the version the bytes came from.
 *
 * This is not a cosmetic addition. A version directory is a copy, and the
 * copy keeps the source file's size and mtime — so the ETag express would
 * derive from the stat alone is byte-identical across versions and across
 * public/data itself. A browser holding a response from before versioning,
 * or from a different version, then revalidates, gets a 304, and keeps
 * serving its stored headers — which do not carry X-Content-Version at all.
 * Observed in Chromium: the stored entry stayed on 22 headers while a
 * no-store fetch of the same URL returned 26.
 *
 * Folding the version into the ETag makes that impossible: a stored response
 * from another version can never satisfy the conditional request, so the
 * client always receives a 200 carrying the version header. A 304 is then
 * only ever served to a client that already holds *this* version, whose
 * stored headers already name it.
 */
function versionedEtag(versionId: string, stat: import("fs").Stats): string {
  return `W/"${versionId}-${stat.size.toString(16)}-${Math.floor(stat.mtimeMs).toString(16)}"`;
}

/** If-None-Match is a comma-separated list, and may be "*". */
function matchesEtag(header: string | undefined, etag: string): boolean {
  if (!header) return false;
  if (header.trim() === "*") return true;
  return header.split(",").some((candidate) => candidate.trim() === etag);
}

function sendVersioned(
  req: express.Request,
  res: express.Response,
  versionId: string,
  fullPath: string,
  stat: import("fs").Stats,
  immutable: boolean,
): void {
  const etag = versionedEtag(versionId, stat);

  res.setHeader(CONTENT_VERSION_HEADER, versionId);
  res.setHeader("Access-Control-Expose-Headers", CONTENT_VERSION_HEADER);
  res.setHeader("ETag", etag);
  if (immutable) {
    // A version-pinned URL can never change meaning, so a long-lived tab
    // should not have to revalidate it on every record fetch.
    res.setHeader("Cache-Control", "public, max-age=31536000, immutable");
  }

  if (matchesEtag(req.headers["if-none-match"], etag)) {
    res.status(304).end();
    return;
  }

  // etag and lastModified are both handled here rather than by send(): its
  // own ETag would overwrite the version-scoped one, and a Last-Modified
  // date is identical across versions, so an If-Modified-Since request would
  // reintroduce exactly the stale-304 problem the ETag above prevents.
  res.sendFile(fullPath, { etag: false, lastModified: false });
}

export function versionResolver(store: VersionStore = versionStore): express.RequestHandler {
  return function resolveContentVersion(req, res, next): void {
    if (req.method !== "GET" && req.method !== "HEAD") return next();

    let relPath: string;
    try {
      relPath = decodeURIComponent(req.path).replace(/^\/+/, "");
    } catch {
      res.status(400).json({ error: "Malformed content path" });
      return;
    }
    if (relPath === "") return next();

    const requested = req.query.v;

    // ── An explicit version was asked for ──────────────────────
    if (requested !== undefined) {
      if (typeof requested !== "string" || !isValidVersionId(requested)) {
        res.status(400).json({ error: "Invalid version identifier" });
        return;
      }
      if (!isVersionedType(typeOf(relPath))) {
        res.status(400).json({ error: "This content is not versioned" });
        return;
      }

      void (async () => {
        if (!(await store.versionExists(requested))) {
          // Deliberately not a fallback to active content: the caller is
          // holding an index from this version, and answering with different
          // content would be the mixed-version state versioning exists to
          // prevent. The client is told to start again from a fresh index.
          res.status(410).json({
            error: "Content version no longer available",
            requestedVersion: requested,
            activeVersion: await store.readActiveVersion(),
          });
          return;
        }

        let fullPath: string;
        try {
          fullPath = store.resolveVersionedPath(requested, relPath);
        } catch {
          res.status(400).json({ error: "Invalid content path" });
          return;
        }

        const stat = await statFile(fullPath);
        if (!stat) {
          res.status(404).json({ error: "Not found in this version", version: requested });
          return;
        }
        sendVersioned(req, res, requested, fullPath, stat, true);
      })().catch(next);
      return;
    }

    // ── No version asked for: serve active, and name it ────────
    if (!isVersionedType(typeOf(relPath))) return next();

    void (async () => {
      const active = await store.readActiveVersion();
      if (!active) return next(); // versioning not in use — behave exactly as before

      let fullPath: string;
      try {
        fullPath = store.resolveVersionedPath(active, relPath);
      } catch {
        res.status(400).json({ error: "Invalid content path" });
        return;
      }

      // A file the active version does not contain is not part of that
      // version. Falling through leaves it served by static with no version
      // header, so the client will not pin anything to it.
      const stat = await statFile(fullPath);
      if (!stat) return next();

      sendVersioned(req, res, active, fullPath, stat, false);
    })().catch(next);
  };
}
