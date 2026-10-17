import express from "express";
import fs from "fs";
import http from "http";
import os from "os";
import path from "path";
import { createVersionStore, VersionStore } from "../version-store";
import { versionResolver, CONTENT_VERSION_HEADER } from "../version-resolver";

/**
 * Phase 1C — the resolver, over real HTTP.
 *
 * A genuine express server on an ephemeral port, mounted exactly as the
 * application mounts it: the resolver at /public/data ahead of
 * express.static at /public. Nothing is mocked, so the status codes, headers
 * and fall-through behaviour under test are the ones a browser would see.
 */

let tmpRoot: string;
let publicDir: string;
let dataDir: string;
let store: VersionStore;
let server: http.Server;
let origin: string;

interface Res {
  status: number;
  headers: http.IncomingHttpHeaders;
  body: string;
}

/**
 * Raw HTTP so the request path is sent exactly as written — a URL parser
 * would normalise away the traversal sequences these tests rely on.
 */
function raw(rawPath: string, headers: Record<string, string> = {}): Promise<Res> {
  return new Promise((resolve, reject) => {
    const req = http.request(`${origin}${rawPath}`, { method: "GET", headers }, (res) => {
      let body = "";
      res.setEncoding("utf-8");
      res.on("data", (c) => (body += c));
      res.on("end", () => resolve({ status: res.statusCode ?? 0, headers: res.headers, body }));
    });
    req.on("error", reject);
    req.end();
  });
}

function writeArchive(marker: string): void {
  fs.mkdirSync(path.join(dataDir, "armaments", "naval"), { recursive: true });
  fs.mkdirSync(path.join(dataDir, "personnel"), { recursive: true });
  fs.writeFileSync(
    path.join(dataDir, "armaments", "index.json"),
    JSON.stringify({ marker, categories: [{ id: "naval", path: "naval" }] }),
    "utf-8",
  );
  fs.writeFileSync(path.join(dataDir, "armaments", "naval", "germany.json"), JSON.stringify({ marker }), "utf-8");
  fs.writeFileSync(path.join(dataDir, "personnel", "index.json"), JSON.stringify({ marker }), "utf-8");
  // Editorial content: never versioned, always served live.
  fs.writeFileSync(path.join(dataDir, "homepage.json"), JSON.stringify({ marker }), "utf-8");
  fs.mkdirSync(path.join(dataDir, "about"), { recursive: true });
  fs.writeFileSync(path.join(dataDir, "about", "mission.json"), JSON.stringify({ marker }), "utf-8");
}

/** One promotion: new content into public/data, captured, then activated. */
async function promote(marker: string): Promise<string> {
  writeArchive(marker);
  const id = await store.createVersionFrom(dataDir);
  await store.writeActiveVersion(id);
  return id;
}

beforeEach(async () => {
  tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "vl-resolver-"));
  publicDir = path.join(tmpRoot, "public");
  dataDir = path.join(publicDir, "data");
  fs.mkdirSync(dataDir, { recursive: true });
  writeArchive("initial");
  store = createVersionStore(path.join(tmpRoot, "published"));

  const app = express();
  app.use("/public/data", versionResolver(store));
  app.use("/public", express.static(publicDir));

  server = await new Promise<http.Server>((resolve) => {
    const s = app.listen(0, "127.0.0.1", () => resolve(s));
  });
  const addr = server.address() as { port: number };
  origin = `http://127.0.0.1:${addr.port}`;
});

afterEach(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
  fs.rmSync(tmpRoot, { recursive: true, force: true });
});

describe("before versioning is in use", () => {
  it("serves existing public URLs exactly as the static handler always did", async () => {
    const res = await raw("/public/data/armaments/index.json");
    expect(res.status).toBe(200);
    expect(JSON.parse(res.body).marker).toBe("initial");
    expect(res.headers[CONTENT_VERSION_HEADER.toLowerCase()]).toBeUndefined();
  });

  it("serves nested records and editorial content unchanged", async () => {
    for (const p of [
      "/public/data/armaments/naval/germany.json",
      "/public/data/homepage.json",
      "/public/data/about/mission.json",
    ]) {
      const res = await raw(p);
      expect(res.status).toBe(200);
      expect(JSON.parse(res.body).marker).toBe("initial");
    }
  });

  it("reports a version request as gone, naming no active version", async () => {
    const res = await raw("/public/data/armaments/index.json?v=v1");
    expect(res.status).toBe(410);
    expect(JSON.parse(res.body).activeVersion).toBeNull();
  });
});

describe("once a version is active", () => {
  it("names the version that served the index", async () => {
    const v1 = await promote("A");
    const res = await raw("/public/data/armaments/index.json");
    expect(res.status).toBe(200);
    expect(res.headers[CONTENT_VERSION_HEADER.toLowerCase()]).toBe(v1);
    expect(JSON.parse(res.body).marker).toBe("A");
  });

  it("leaves editorial content unversioned and live", async () => {
    await promote("A");
    // Editorial content changes without any promotion at all.
    fs.writeFileSync(path.join(dataDir, "homepage.json"), JSON.stringify({ marker: "edited" }), "utf-8");
    const res = await raw("/public/data/homepage.json");
    expect(res.status).toBe(200);
    expect(JSON.parse(res.body).marker).toBe("edited");
    expect(res.headers[CONTENT_VERSION_HEADER.toLowerCase()]).toBeUndefined();
  });

  it("marks version-pinned responses immutable and active ones revalidating", async () => {
    const v1 = await promote("A");
    const pinned = await raw(`/public/data/armaments/index.json?v=${v1}`);
    expect(pinned.headers["cache-control"]).toContain("immutable");
    const active = await raw("/public/data/armaments/index.json");
    expect(active.headers["cache-control"] ?? "").not.toContain("immutable");
  });
});

describe("an index read from one version, records fetched after a promotion", () => {
  it("still answers every v41 record from v41 after promotion to v42", async () => {
    const v41 = await promote("A");

    // The page reads its index. This is the version it is now committed to.
    const index = await raw("/public/data/armaments/index.json");
    const pinned = index.headers[CONTENT_VERSION_HEADER.toLowerCase()];
    expect(pinned).toBe(v41);
    expect(JSON.parse(index.body).marker).toBe("A");

    // A promotion lands before the page fetches its records.
    const v42 = await promote("B");
    expect(v42).not.toBe(v41);
    expect(await store.readActiveVersion()).toBe(v42);

    // Every record the page asks for still resolves against its own version.
    for (const p of ["armaments/index.json", "armaments/naval/germany.json", "personnel/index.json"]) {
      const res = await raw(`/public/data/${p}?v=${pinned}`);
      expect(res.status).toBe(200);
      expect(JSON.parse(res.body).marker).toBe("A");
      expect(res.headers[CONTENT_VERSION_HEADER.toLowerCase()]).toBe(v41);
    }

    // A fresh page load sees the new version.
    const fresh = await raw("/public/data/armaments/naval/germany.json");
    expect(JSON.parse(fresh.body).marker).toBe("B");
    expect(fresh.headers[CONTENT_VERSION_HEADER.toLowerCase()]).toBe(v42);
  });

  it("survives more than three successive promotions", async () => {
    const first = await promote("A");
    const markers = ["B", "C", "D", "E", "F"];
    for (const m of markers) {
      await promote(m);
      await store.pruneVersions();
    }

    // Active + 3 prior retained, so the oldest is gone but recent ones hold.
    const retained = await store.listVersions();
    expect(retained.length).toBe(4);
    expect(retained).not.toContain(first);

    for (const id of retained) {
      const res = await raw(`/public/data/armaments/naval/germany.json?v=${id}`);
      expect(res.status).toBe(200);
      expect(res.headers[CONTENT_VERSION_HEADER.toLowerCase()]).toBe(id);
    }
  });

  it("keeps concurrent page loads internally consistent across repeated promotions", async () => {
    await promote("A");

    // Three page loads start, each reading its index at a different moment,
    // with a promotion between each.
    const loads: Array<{ pinned: string; marker: string }> = [];
    for (const m of ["B", "C", "D"]) {
      const index = await raw("/public/data/armaments/index.json");
      loads.push({
        pinned: String(index.headers[CONTENT_VERSION_HEADER.toLowerCase()]),
        marker: JSON.parse(index.body).marker,
      });
      await promote(m);
    }

    // Now every load fetches its records, long after the promotions.
    const results = await Promise.all(
      loads.map(async (l) => {
        const res = await raw(`/public/data/armaments/naval/germany.json?v=${l.pinned}`);
        return { expected: l.marker, got: JSON.parse(res.body).marker, status: res.status };
      }),
    );

    for (const r of results) {
      expect(r.status).toBe(200);
      // Each load's record matches the index that load actually read.
      expect(r.got).toBe(r.expected);
    }
    expect(results.map((r) => r.expected)).toEqual(["A", "B", "C"]);
  });
});

describe("a pruned version", () => {
  it("answers 410 Gone and names the active version", async () => {
    const v1 = await promote("A");
    for (const m of ["B", "C", "D", "E"]) await promote(m);
    await store.pruneVersions();
    expect(await store.versionExists(v1)).toBe(false);

    const res = await raw(`/public/data/armaments/naval/germany.json?v=${v1}`);
    expect(res.status).toBe(410);
    const body = JSON.parse(res.body);
    expect(body.requestedVersion).toBe(v1);
    expect(body.activeVersion).toBe(await store.readActiveVersion());
  });

  it("never substitutes current content for the version that was asked for", async () => {
    const v1 = await promote("A");
    for (const m of ["B", "C", "D", "E"]) await promote(m);
    await store.pruneVersions();

    const res = await raw(`/public/data/armaments/naval/germany.json?v=${v1}`);
    expect(res.status).toBe(410);
    expect(res.body).not.toContain('"marker":"E"');
  });
});

describe("rejecting bad input", () => {
  beforeEach(async () => { await promote("A"); });

  it.each(["v0", "V1", "latest", "1", "v1.2", "v-1", "", "v%201"])(
    "rejects version %p with 400", async (v) => {
      const res = await raw(`/public/data/armaments/index.json?v=${v}`);
      expect(res.status).toBe(400);
    });

  it.each([
    "/public/data/armaments/%2e%2e%2f%2e%2e%2factive.json?v=v1",
    "/public/data/armaments/..%2f..%2fversions%2fv1%2farmaments%2findex.json?v=v1",
    "/public/data/%2e%2e%2f%2e%2e%2f%2e%2e%2fpackage.json?v=v1",
  ])("refuses traversal %p", async (p) => {
    const res = await raw(p);
    expect([400, 404]).toContain(res.status);
    expect(res.body).not.toContain('"name"'); // never package.json
    expect(res.body).not.toContain('"updatedAt"'); // never the pointer file
  });

  it("refuses a version request for unversioned editorial content", async () => {
    const res = await raw("/public/data/homepage.json?v=v1");
    expect(res.status).toBe(400);
  });

  it("404s a file that is not in the requested version", async () => {
    const res = await raw("/public/data/armaments/naval/nonexistent.json?v=v1");
    expect(res.status).toBe(404);
    expect(JSON.parse(res.body).version).toBe("v1");
  });
});

describe("a failed promotion", () => {
  it("leaves the active version untouched when capture fails", async () => {
    const v1 = await promote("A");

    // New content is already in public/data, but the capture cannot complete:
    // the versions root has been replaced by a file.
    writeArchive("B");
    fs.rmSync(store.versionsRoot, { recursive: true, force: true });
    fs.writeFileSync(store.versionsRoot, "blocked", "utf-8");

    await expect(store.createVersionFrom(dataDir)).rejects.toThrow();

    // The pointer never moved, so the published version is still v1 — even
    // though public/data has moved on.
    expect(await store.readActiveVersion()).toBe(v1);
  });

  it("serves the previous version in full while a promotion is incomplete", async () => {
    const v1 = await promote("A");

    // public/data has the new content, but no version was captured or
    // activated — so readers see v1 in full rather than a half-published mix.
    writeArchive("B");

    const res = await raw("/public/data/armaments/naval/germany.json");
    expect(res.status).toBe(200);
    expect(res.headers[CONTENT_VERSION_HEADER.toLowerCase()]).toBe(v1);
    expect(JSON.parse(res.body).marker).toBe("A");
  });

  it("leaves the active version untouched when activation fails", async () => {
    const v1 = await promote("A");
    await expect(store.writeActiveVersion("v99")).rejects.toThrow();
    expect(await store.readActiveVersion()).toBe(v1);
  });
});

/**
 * Regression: the response validator must identify the version.
 *
 * A version directory is a copy, and fs.cp preserves the source file's size
 * and mtime — so the ETag express derives from the stat alone is identical
 * across every version and across public/data itself. That was observed to
 * break version pinning end to end in a real browser: Chromium held an index
 * response cached from before versioning, revalidated it, got a 304, and went
 * on serving its stored headers, which carried no X-Content-Version at all.
 * The page therefore pinned nothing and fetched its records unpinned.
 *
 * Folding the version into the ETag makes a cross-version 304 impossible.
 */
describe("the cache validator identifies the version", () => {
  it("names the version in the ETag", async () => {
    const v1 = await promote("A");
    const res = await raw("/public/data/armaments/index.json");
    expect(res.headers.etag).toBe(`W/"${v1}-${res.body.length.toString(16)}-${
      Math.floor(
        fs.statSync(path.join(store.versionDir(v1), "armaments", "index.json")).mtimeMs,
      ).toString(16)
    }"`);
    expect(res.headers.etag).toContain(v1);
  });

  it("gives the same file different ETags in different versions", async () => {
    const v1 = await promote("A");
    const v2 = await promote("A"); // byte-identical content, deliberately

    const a = await raw(`/public/data/armaments/index.json?v=${v1}`);
    const b = await raw(`/public/data/armaments/index.json?v=${v2}`);

    // The bodies really are identical — only the version differs.
    expect(a.body).toBe(b.body);
    expect(a.headers.etag).not.toBe(b.headers.etag);
  });

  it("answers 200 with the version header when the client holds another version's ETag", async () => {
    const v1 = await promote("A");
    const stale = (await raw(`/public/data/armaments/index.json?v=${v1}`)).headers.etag as string;

    const v2 = await promote("B");
    const res = await raw("/public/data/armaments/index.json", { "If-None-Match": stale });

    expect(res.status).toBe(200);
    expect(res.headers[CONTENT_VERSION_HEADER.toLowerCase()]).toBe(v2);
    expect(JSON.parse(res.body).marker).toBe("B");
  });

  it("answers 200 with the version header when the client holds a pre-versioning ETag", async () => {
    // Exactly the browser's situation: a response cached before any version
    // store existed, whose ETag came from the stat alone.
    const statEtag = `W/"64a-19f05d19bbf"`;
    const v1 = await promote("A");

    const res = await raw("/public/data/armaments/index.json", { "If-None-Match": statEtag });
    expect(res.status).toBe(200);
    expect(res.headers[CONTENT_VERSION_HEADER.toLowerCase()]).toBe(v1);
  });

  it("still allows a 304 to a client holding this exact version, and names it", async () => {
    const v1 = await promote("A");
    const first = await raw(`/public/data/armaments/index.json?v=${v1}`);
    const etag = first.headers.etag as string;

    const second = await raw(`/public/data/armaments/index.json?v=${v1}`, { "If-None-Match": etag });
    expect(second.status).toBe(304);
    // The stored response already names this version, and the 304 repeats it.
    expect(second.headers[CONTENT_VERSION_HEADER.toLowerCase()]).toBe(v1);
    expect(second.body).toBe("");
  });

  it("handles a list of candidate ETags", async () => {
    const v1 = await promote("A");
    const etag = (await raw(`/public/data/armaments/index.json?v=${v1}`)).headers.etag as string;
    const res = await raw(`/public/data/armaments/index.json?v=${v1}`, {
      "If-None-Match": `W/"other-1-1", ${etag}, W/"another-2-2"`,
    });
    expect(res.status).toBe(304);
  });

  it("sends no Last-Modified, so If-Modified-Since cannot produce a stale 304", async () => {
    await promote("A");
    const first = await raw("/public/data/armaments/index.json");
    expect(first.headers["last-modified"]).toBeUndefined();

    const v2 = await promote("B");
    const res = await raw("/public/data/armaments/index.json", {
      "If-Modified-Since": new Date(Date.now() + 60_000).toUTCString(),
    });
    expect(res.status).toBe(200);
    expect(res.headers[CONTENT_VERSION_HEADER.toLowerCase()]).toBe(v2);
    expect(JSON.parse(res.body).marker).toBe("B");
  });

  it("leaves unversioned editorial content on the static handler's own validator", async () => {
    await promote("A");
    const res = await raw("/public/data/homepage.json");
    expect(res.status).toBe(200);
    expect(res.headers[CONTENT_VERSION_HEADER.toLowerCase()]).toBeUndefined();
    // express.static still supplies its normal validators here.
    expect(res.headers["last-modified"]).toBeDefined();
  });
});
