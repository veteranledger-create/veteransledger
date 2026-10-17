import fs from "fs";
import fsp from "fs/promises";
import os from "os";
import path from "path";
import { createRevisionStore, RevisionStore, sha256 } from "../revision-store";

/**
 * Phase 1D — the revision store.
 *
 * Every test runs against a throwaway store and a throwaway "editorial file"
 * under the OS temp dir. Nothing here touches public/data or the project's
 * own storage/.
 *
 * The central property under test is ordering: a revision is durable before
 * the editable file is touched, so a history failure can never cost content.
 */

let tmp: string;
let store: RevisionStore;
let target: string;

const KEY = "about/mission.json";
const read = (): string | null => {
  try { return fs.readFileSync(target, "utf-8"); } catch { return null; }
};

beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "vl-editorial-"));
  store = createRevisionStore(path.join(tmp, "editorial"));
  target = path.join(tmp, "public-data", "about", "mission.json");
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, '{"title":"original"}\n', "utf-8");
});

afterEach(() => {
  jest.restoreAllMocks();
  fs.rmSync(tmp, { recursive: true, force: true });
});

const save = (content: string, extra: Record<string, unknown> = {}) =>
  store.recordAndApply({ key: KEY, targetFile: target, content, ...extra });

describe("recording a save", () => {
  it("captures what was already on disk before overwriting it", async () => {
    await save('{"title":"edited"}\n');

    const revisions = await store.list(KEY);
    expect(revisions).toHaveLength(2);
    expect(revisions[0].source).toBe("captured");
    expect(revisions[1].source).toBe("save");

    // The pre-existing content is recoverable, byte for byte.
    expect(await store.read(KEY, revisions[0].id)).toBe('{"title":"original"}\n');
    expect(read()).toBe('{"title":"edited"}\n');
  });

  it("records the hash and byte count, and verifies both on read", async () => {
    const content = '{"title":"edited"}\n';
    const revision = await save(content);

    expect(revision.sha256).toBe(sha256(content));
    expect(revision.bytes).toBe(Buffer.byteLength(content, "utf-8"));
    expect(await store.read(KEY, revision.id)).toBe(content);
  });

  it("does not re-capture when the file already matches the newest revision", async () => {
    await save('{"a":1}\n');
    await save('{"a":2}\n');
    await save('{"a":3}\n');

    const sources = (await store.list(KEY)).map((r) => r.source);
    // One capture of the original, then one entry per save — no duplicates.
    expect(sources).toEqual(["captured", "save", "save", "save"]);
  });

  it("captures an edit made outside this API", async () => {
    await save('{"a":1}\n');
    fs.writeFileSync(target, '{"a":"changed on disk"}\n', "utf-8");

    await save('{"a":2}\n');
    const revisions = await store.list(KEY);
    const captured = revisions.filter((r) => r.source === "captured");
    expect(captured).toHaveLength(2);
    expect(await store.read(KEY, captured[1].id)).toBe('{"a":"changed on disk"}\n');
  });

  it("gives revision ids that sort chronologically", async () => {
    const ids: string[] = [];
    for (let i = 0; i < 5; i++) ids.push((await save(`{"n":${i}}\n`)).id);
    expect([...ids].sort()).toEqual(ids);
  });

  it("records a file that did not exist before without a capture", async () => {
    const fresh = path.join(tmp, "public-data", "homepage.json");
    const revision = await store.recordAndApply({
      key: "homepage.json", targetFile: fresh, content: '{"new":true}\n',
    });
    expect((await store.list("homepage.json")).map((r) => r.source)).toEqual(["save"]);
    expect(fs.readFileSync(fresh, "utf-8")).toBe('{"new":true}\n');
    expect(revision.source).toBe("save");
  });
});

describe("failures at each step of the write sequence", () => {
  it("step 1 — capturing the previous revision fails: file untouched", async () => {
    const before = read();
    // The first blob written for this key is the capture of the current file.
    jest.spyOn(fsp, "open").mockRejectedValueOnce(new Error("disk full") as never);

    await expect(save('{"title":"edited"}\n')).rejects.toThrow("disk full");
    expect(read()).toBe(before);
    expect(await store.list(KEY)).toEqual([]);
  });

  it("step 2 — writing the new revision blob fails: file untouched", async () => {
    const before = read();
    const realRename = jest.requireActual<typeof fsp>("fs/promises").rename;

    // Blob renames land on history/<key>/<id>.json. The first is the capture
    // of the current file; the second is the new revision. Failing the second
    // isolates this step without depending on how many opens it takes.
    let blobRenames = 0;
    jest.spyOn(fsp, "rename").mockImplementation(((from: string, to: string) => {
      const dest = String(to);
      const isBlob = dest.includes(path.join("history", "about")) && !dest.endsWith("revisions.json");
      if (isBlob && ++blobRenames === 2) return Promise.reject(new Error("blob write failed"));
      return realRename(from, dest);
    }) as never);

    await expect(save('{"title":"edited"}\n')).rejects.toThrow("blob write failed");
    expect(read()).toBe(before);

    jest.restoreAllMocks();
    // Only the capture was recorded; the attempted content was not applied.
    expect((await store.list(KEY)).map((r) => r.source)).toEqual(["captured"]);
  });

  it("step 3 — appending to the log fails: file untouched, blob is an orphan", async () => {
    const before = read();
    const realRename = jest.requireActual<typeof fsp>("fs/promises").rename;
    jest.spyOn(fsp, "rename").mockImplementation(((from: string, to: string) => {
      if (String(to).endsWith("revisions.json")) return Promise.reject(new Error("log write failed"));
      return realRename(from, to);
    }) as never);

    await expect(save('{"title":"edited"}\n')).rejects.toThrow("log write failed");
    expect(read()).toBe(before);

    jest.restoreAllMocks();

    // The log never recorded anything, but the blobs survived on disk.
    expect(await store.list(KEY)).toEqual([]);
    const report = await store.reconcile(KEY);
    expect(report.adopted.length).toBeGreaterThan(0);
    expect(report.corrupt).toEqual([]);

    // And the adopted revisions are readable, so the content is recovered.
    for (const revision of await store.list(KEY)) {
      await expect(store.read(KEY, revision.id)).resolves.toEqual(expect.any(String));
    }
  });

  it("step 4 — applying to the editable file fails: the revision is still recorded", async () => {
    // A directory where the file should be makes the final rename fail.
    const blocked = path.join(tmp, "public-data", "blocked.json");
    fs.mkdirSync(blocked, { recursive: true });

    await expect(
      store.recordAndApply({ key: "homepage.json", targetFile: blocked, content: '{"x":1}\n' }),
    ).rejects.toThrow();

    // Recorded first, by design — the content is recoverable even though it
    // never reached the file.
    const revisions = await store.list("homepage.json");
    expect(revisions).toHaveLength(1);
    expect(await store.read("homepage.json", revisions[0].id)).toBe('{"x":1}\n');
    expect(fs.statSync(blocked).isDirectory()).toBe(true);
  });

  it("leaves no temp files behind after a failure", async () => {
    const realRename = jest.requireActual<typeof fsp>("fs/promises").rename;
    jest.spyOn(fsp, "rename").mockImplementation(((from: string, to: string) => {
      if (String(to).endsWith("revisions.json")) return Promise.reject(new Error("nope"));
      return realRename(from, to);
    }) as never);
    await expect(save('{"a":1}\n')).rejects.toThrow();
    jest.restoreAllMocks();

    const stray = fs.readdirSync(store.historyDir(KEY)).filter((n) => n.startsWith(".tmp-"));
    expect(stray).toEqual([]);
  });
});

describe("concurrent saves", () => {
  it("records every one, losing no log entries", async () => {
    const contents = Array.from({ length: 8 }, (_, i) => `{"n":${i}}\n`);
    await Promise.all(contents.map((c) => save(c)));

    const revisions = await store.list(KEY);
    const saves = revisions.filter((r) => r.source === "save");
    expect(saves).toHaveLength(8);
    // One capture of the original; the saves chain, so nothing else is captured.
    expect(revisions.filter((r) => r.source === "captured")).toHaveLength(1);

    // Every submitted body is recoverable.
    const recorded = new Set(saves.map((r) => r.sha256));
    for (const c of contents) expect(recorded.has(sha256(c))).toBe(true);

    // And the file holds exactly one of them, intact.
    expect(contents).toContain(read());
  });

  it("serialises interleaved saves to different keys independently", async () => {
    const other = path.join(tmp, "public-data", "homepage.json");
    await Promise.all([
      save('{"a":1}\n'),
      store.recordAndApply({ key: "homepage.json", targetFile: other, content: '{"b":1}\n' }),
      save('{"a":2}\n'),
      store.recordAndApply({ key: "homepage.json", targetFile: other, content: '{"b":2}\n' }),
    ]);

    expect((await store.list(KEY)).filter((r) => r.source === "save")).toHaveLength(2);
    expect((await store.list("homepage.json")).filter((r) => r.source === "save")).toHaveLength(2);
  });
});

describe("hash and length verification", () => {
  it("refuses a revision whose bytes have been altered", async () => {
    const revision = await save('{"title":"edited"}\n');
    const blob = path.join(store.historyDir(KEY), `${revision.id}.json`);
    fs.writeFileSync(blob, '{"title":"tampered with"}\n', "utf-8");

    await expect(store.read(KEY, revision.id)).rejects.toThrow(/checksum|bytes/);
  });

  it("refuses a revision whose length no longer matches", async () => {
    const revision = await save('{"title":"edited"}\n');
    const log = path.join(store.historyDir(KEY), "revisions.json");
    const parsed = JSON.parse(fs.readFileSync(log, "utf-8"));
    parsed.revisions.at(-1).bytes = 999;
    fs.writeFileSync(log, JSON.stringify(parsed, null, 2), "utf-8");

    await expect(store.read(KEY, revision.id)).rejects.toThrow(/999/);
  });

  it("refuses an unrecorded revision id", async () => {
    await save('{"a":1}\n');
    await expect(store.read(KEY, "20261013T071158123Z-deadbeef")).rejects.toThrow(/not recorded/);
  });

  it("refuses a malformed revision id rather than resolving a path from it", async () => {
    await save('{"a":1}\n');
    for (const bad of ["../../etc/passwd", "..", "/absolute", "revisions", "x".repeat(40)]) {
      await expect(store.read(KEY, bad)).rejects.toThrow();
    }
  });
});

describe("reconcile", () => {
  it("reports nothing to do for a healthy key", async () => {
    await save('{"a":1}\n');
    expect(await store.reconcile(KEY)).toEqual({ key: KEY, adopted: [], missingBlobs: [], corrupt: [] });
  });

  it("reports a log entry whose blob has been deleted", async () => {
    const revision = await save('{"a":1}\n');
    fs.rmSync(path.join(store.historyDir(KEY), `${revision.id}.json`));

    const report = await store.reconcile(KEY);
    expect(report.missingBlobs).toContain(revision.id);
    // The entry is kept: the log is a record of what happened, not of what
    // still has bytes on disk.
    expect((await store.list(KEY)).some((r) => r.id === revision.id)).toBe(true);
  });

  it("refuses to adopt a blob that does not match the hash in its own name", async () => {
    await save('{"a":1}\n');
    const fake = path.join(store.historyDir(KEY), "20261013T071158123Z-aaaaaaaa.json");
    fs.writeFileSync(fake, '{"planted":true}\n', "utf-8");

    const report = await store.reconcile(KEY);
    expect(report.corrupt).toContain("20261013T071158123Z-aaaaaaaa");
    expect(report.adopted).toEqual([]);
  });

  it("is safe to run when a key has no history at all", async () => {
    expect(await store.reconcile("legal/cookie-policy.json")).toEqual({
      key: "legal/cookie-policy.json", adopted: [], missingBlobs: [], corrupt: [],
    });
  });
});

describe("key handling", () => {
  it("keeps each key's history in its own directory", async () => {
    await save('{"a":1}\n');
    expect(fs.existsSync(path.join(store.root, "history", "about", "mission.json", "revisions.json"))).toBe(true);
  });

  it("refuses keys that would escape the history root", async () => {
    for (const bad of ["../escape.json", "/etc/passwd", "a/../../b.json", ""]) {
      expect(() => store.historyDir(bad)).toThrow();
    }
  });

  it("lists every key that has history", async () => {
    await save('{"a":1}\n');
    await store.recordAndApply({
      key: "homepage.json", targetFile: path.join(tmp, "public-data", "homepage.json"), content: "{}\n",
    });
    expect(await store.keys()).toEqual(["about/mission.json", "homepage.json"]);
  });

  it("treats a damaged log as no history rather than failing the read", async () => {
    await save('{"a":1}\n');
    fs.writeFileSync(path.join(store.historyDir(KEY), "revisions.json"), "{ not json", "utf-8");
    await expect(store.list(KEY)).resolves.toEqual([]);
    // And editing still works, so a damaged log cannot lock the Admin out.
    await expect(save('{"a":2}\n')).resolves.toBeDefined();
  });
});
