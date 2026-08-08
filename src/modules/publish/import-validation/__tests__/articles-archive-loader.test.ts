import fs from "fs/promises";
import os from "os";
import path from "path";

async function makeTempDir(prefix: string): Promise<string> {
  return fs.mkdtemp(path.join(os.tmpdir(), prefix));
}
async function writeFile(dir: string, relPath: string, content: string) {
  const full = path.join(dir, relPath);
  await fs.mkdir(path.dirname(full), { recursive: true });
  await fs.writeFile(full, content);
}
async function makeUnreadableJsonEntry(dir: string, relPath: string) {
  await fs.mkdir(path.join(dir, relPath), { recursive: true });
}
function groupActiveByCategory(active: string[]): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  for (const relPath of active) {
    const idx = relPath.indexOf("/");
    (out[relPath.slice(0, idx)] ??= []).push(relPath.slice(idx + 1));
  }
  return out;
}
function mockProvider(articlesDir: string, active: string[], obsolete: { file: string; replacedBy: string; reason: string }[] = []) {
  jest.doMock("../articles-archive-manifest-provider", () => ({
    articleArchiveManifestProvider: {
      getArticlesDirectory: () => articlesDir,
      getArticleFiles: () => groupActiveByCategory(active),
      getManifest: () => ({ active, obsolete }),
      getLoadError: () => undefined,
    },
  }));
}
async function loadFresh() {
  const mod = require("../articles-archive-loader");
  return { loadArticlesArchive: mod.loadArticlesArchive as () => Promise<any> };
}

describe("Articles archive loader (Phase C) — synthetic scenarios", () => {
  afterEach(() => {
    jest.resetModules();
    jest.dontMock("../articles-archive-manifest-provider");
  });

  test("1. valid archive loads successfully", async () => {
    const dir = await makeTempDir("art-valid-");
    await writeFile(dir, "military/foo.json", JSON.stringify({ id: "foo", title: "Foo" }));
    mockProvider(dir, ["military/foo.json"]);
    const { loadArticlesArchive } = await loadFresh();
    const archive = await loadArticlesArchive();
    expect(archive.declaredItems.length).toBe(1);
    expect(archive.declaredItems[0].category).toBe("military");
    expect(archive.declaredItems[0].article).toEqual({ id: "foo", title: "Foo" });
  });

  test("2. malformed JSON -> zero items, raw undefined, no readError flag", async () => {
    const dir = await makeTempDir("art-malformed-");
    await writeFile(dir, "military/foo.json", "{ not valid json");
    mockProvider(dir, ["military/foo.json"]);
    const { loadArticlesArchive } = await loadFresh();
    const archive = await loadArticlesArchive();
    expect(archive.declaredItems.length).toBe(0);
    const entry = archive.filesOnDisk.find((f: any) => f.relPath === "military/foo.json");
    expect(entry.raw).toBeUndefined();
    expect(entry.readError).toBeUndefined();
  });

  test("3. real unreadable file (EISDIR) -> zero items, raw undefined, readError:true, distinguishable from malformed", async () => {
    const dir = await makeTempDir("art-unreadable-");
    await makeUnreadableJsonEntry(dir, "military/foo.json"); // a directory, not a file
    mockProvider(dir, ["military/foo.json"]);
    const { loadArticlesArchive } = await loadFresh();
    const archive = await loadArticlesArchive();
    expect(archive.declaredItems.length).toBe(0);
    const entry = archive.filesOnDisk.find((f: any) => f.relPath === "military/foo.json");
    expect(entry.raw).toBeUndefined();
    expect(entry.readError).toBe(true);
  });

  test("4. missing declared file does not crash the loader", async () => {
    const dir = await makeTempDir("art-missing-");
    await fs.mkdir(path.join(dir, "military"), { recursive: true }); // dir exists, file does not
    mockProvider(dir, ["military/foo.json"]);
    const { loadArticlesArchive } = await loadFresh();
    let threw = false;
    let archive: any;
    try {
      archive = await loadArticlesArchive();
    } catch {
      threw = true;
    }
    expect(threw).toBe(false);
    expect(archive.declaredItems.length).toBe(0);
    expect(archive.filesOnDisk.find((f: any) => f.relPath === "military/foo.json")).toBeUndefined();
  });

  test("5. literal null does not crash the loader, coerced to {}", async () => {
    const dir = await makeTempDir("art-null-");
    await writeFile(dir, "military/foo.json", "null");
    mockProvider(dir, ["military/foo.json"]);
    const { loadArticlesArchive } = await loadFresh();
    let threw = false;
    let archive: any;
    try {
      archive = await loadArticlesArchive();
    } catch {
      threw = true;
    }
    expect(threw).toBe(false);
    expect(archive.declaredItems.length).toBe(1);
    expect(archive.declaredItems[0].article).toEqual({});
    const entry = archive.filesOnDisk.find((f: any) => f.relPath === "military/foo.json");
    expect(entry.raw).toBeNull(); // filesOnDisk preserves the true raw value
  });

  test("6. wrong-shape JSON (bare number, bare array) does not crash the loader", async () => {
    const dir = await makeTempDir("art-wrongshape-");
    await writeFile(dir, "military/foo.json", "42");
    await writeFile(dir, "military/bar.json", "[1,2,3]");
    mockProvider(dir, ["military/foo.json", "military/bar.json"]);
    const { loadArticlesArchive } = await loadFresh();
    let threw = false;
    let archive: any;
    try {
      archive = await loadArticlesArchive();
    } catch {
      threw = true;
    }
    expect(threw).toBe(false);
    expect(archive.declaredItems.length).toBe(2);
    const fooItem = archive.declaredItems.find((i: any) => i.category === "military" && i.article === 42);
    const barItem = archive.declaredItems.find((i: any) => Array.isArray(i.article));
    expect(fooItem).toBeDefined();
    expect(barItem).toBeDefined();
    expect(barItem.article).toEqual([1, 2, 3]);
  });

  test("7. two independent calls return independent snapshots — no global caching", async () => {
    const dir = await makeTempDir("art-nocache-");
    await writeFile(dir, "military/foo.json", JSON.stringify({ id: "foo" }));
    mockProvider(dir, ["military/foo.json"]);
    const { loadArticlesArchive } = await loadFresh();

    const first = await loadArticlesArchive();
    expect((first.declaredItems[0].article as any).id).toBe("foo");

    await writeFile(dir, "military/foo.json", JSON.stringify({ id: "CHANGED" }));

    const second = await loadArticlesArchive();
    expect((second.declaredItems[0].article as any).id).toBe("CHANGED");
    expect(second).not.toBe(first);
  });

  test("8. real archive: all 8 files discovered, category breakdown exact", async () => {
    jest.resetModules();
    jest.dontMock("../articles-archive-manifest-provider");
    const { loadArticlesArchive } = require("../articles-archive-loader");
    const archive = await loadArticlesArchive();
    expect(archive.filesOnDisk.length).toBe(8);
    expect(archive.declaredItems.length).toBe(8);
    const byCategory: Record<string, number> = {};
    for (const f of archive.filesOnDisk) byCategory[f.category] = (byCategory[f.category] ?? 0) + 1;
    expect(byCategory).toEqual({ military: 3, political: 4, legal: 1 });
  });

  test("single-load: one readdir per category, one read per discovered file", async () => {
    const dir = await makeTempDir("art-singleload-");
    await writeFile(dir, "military/foo.json", JSON.stringify({ id: "foo" }));
    await writeFile(dir, "political/bar.json", JSON.stringify({ id: "bar" }));
    mockProvider(dir, ["military/foo.json", "political/bar.json"]);

    const fsp = require("fs/promises");
    let readFileCalls = 0;
    let readdirCalls = 0;
    const origReadFile = fsp.readFile;
    const origReaddir = fsp.readdir;
    jest.spyOn(fsp, "readFile").mockImplementation((...args: any[]) => {
      if (String(args[0]).startsWith(dir)) readFileCalls++;
      return origReadFile(...(args as [any]));
    });
    jest.spyOn(fsp, "readdir").mockImplementation((...args: any[]) => {
      if (String(args[0]).startsWith(dir)) readdirCalls++;
      return origReaddir(...(args as [any]));
    });

    const { loadArticlesArchive } = await loadFresh();
    const archive = await loadArticlesArchive();

    expect(readdirCalls).toBe(2); // one per category folder
    expect(readFileCalls).toBe(2); // one per discovered file
    expect(archive.declaredItems.length).toBe(2);

    (fsp.readFile as jest.Mock).mockRestore();
    (fsp.readdir as jest.Mock).mockRestore();
  });
});
