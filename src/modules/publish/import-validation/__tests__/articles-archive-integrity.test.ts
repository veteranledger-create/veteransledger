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
  const loaderMod = require("../articles-archive-loader");
  const integrityMod = require("../articles-archive-integrity");
  return {
    loadArticlesArchive: loaderMod.loadArticlesArchive as () => Promise<any>,
    validateArticleArchiveIntegrity: integrityMod.validateArticleArchiveIntegrity as (a?: any) => Promise<any>,
  };
}

describe("Articles archive integrity (Phase D)", () => {
  afterEach(() => {
    jest.resetModules();
    jest.dontMock("../articles-archive-manifest-provider");
  });

  test("real archive integrity passes", async () => {
    jest.resetModules();
    jest.dontMock("../articles-archive-manifest-provider");
    const integrityMod = require("../articles-archive-integrity");
    const report = await integrityMod.validateArticleArchiveIntegrity();
    expect(report.passed).toBe(true);
    expect(report.violations).toEqual([]);
    expect(report.declaredFiles).toBe(8);
    expect(report.activeFiles.length).toBe(8);
    expect(report.obsoleteFiles).toEqual([]);
    expect(report.missingDeclaredFiles).toEqual([]);
    expect(report.unreadableDeclaredFiles).toEqual([]);
    expect(report.malformedDeclaredFiles).toEqual([]);
    expect(report.undeclaredFiles).toEqual([]);
    expect(report.duplicateIds).toEqual([]);
    expect(report.duplicateRecordIds).toEqual([]);
  });

  test("missing declared file -> FAIL with missing_declared_file only", async () => {
    const dir = await makeTempDir("art-integ-missing-");
    await fs.mkdir(path.join(dir, "military"), { recursive: true });
    mockProvider(dir, ["military/foo.json"]);
    const { validateArticleArchiveIntegrity } = await loadFresh();
    const report = await validateArticleArchiveIntegrity();
    expect(report.passed).toBe(false);
    expect(report.missingDeclaredFiles).toEqual(["military/foo.json"]);
    expect(report.violations.some((v: any) => v.kind === "missing_declared_file")).toBe(true);
  });

  test("malformed declared file -> FAIL with malformed_declared_file only", async () => {
    const dir = await makeTempDir("art-integ-malformed-");
    await writeFile(dir, "military/foo.json", "{ not valid json");
    mockProvider(dir, ["military/foo.json"]);
    const { validateArticleArchiveIntegrity } = await loadFresh();
    const report = await validateArticleArchiveIntegrity();
    expect(report.passed).toBe(false);
    expect(report.malformedDeclaredFiles).toEqual(["military/foo.json"]);
    expect(report.unreadableDeclaredFiles).toEqual([]);
    expect(report.violations.some((v: any) => v.kind === "malformed_declared_file")).toBe(true);
  });

  test("unreadable declared file (real EISDIR) -> FAIL with unreadable_declared_file only", async () => {
    const dir = await makeTempDir("art-integ-unreadable-");
    await makeUnreadableJsonEntry(dir, "military/foo.json");
    mockProvider(dir, ["military/foo.json"]);
    const { validateArticleArchiveIntegrity } = await loadFresh();
    const report = await validateArticleArchiveIntegrity();
    expect(report.passed).toBe(false);
    expect(report.unreadableDeclaredFiles).toEqual(["military/foo.json"]);
    expect(report.malformedDeclaredFiles).toEqual([]);
    expect(report.violations.some((v: any) => v.kind === "unreadable_declared_file")).toBe(true);
  });

  test("undeclared physical file -> FAIL with undeclared_file", async () => {
    const dir = await makeTempDir("art-integ-undeclared-");
    await writeFile(dir, "military/foo.json", JSON.stringify({ id: "foo" }));
    await writeFile(dir, "military/extra.json", JSON.stringify({ id: "extra" }));
    mockProvider(dir, ["military/foo.json"]);
    const { validateArticleArchiveIntegrity } = await loadFresh();
    const report = await validateArticleArchiveIntegrity();
    expect(report.passed).toBe(false);
    expect(report.undeclaredFiles).toEqual(["military/extra.json"]);
    expect(report.violations.some((v: any) => v.kind === "undeclared_file")).toBe(true);
  });

  test("filename/id mismatch -> FAIL with filename_id_mismatch", async () => {
    const dir = await makeTempDir("art-integ-idmismatch-");
    await writeFile(dir, "military/foo.json", JSON.stringify({ id: "not-foo" }));
    mockProvider(dir, ["military/foo.json"]);
    const { validateArticleArchiveIntegrity } = await loadFresh();
    const report = await validateArticleArchiveIntegrity();
    expect(report.passed).toBe(false);
    expect(report.violations.some((v: any) => v.kind === "filename_id_mismatch")).toBe(true);
  });

  test("duplicate id across two files -> FAIL with duplicate_id, duplicateSlugs mirrors it", async () => {
    const dir = await makeTempDir("art-integ-dupid-");
    await writeFile(dir, "military/foo.json", JSON.stringify({ id: "same-id" }));
    await writeFile(dir, "political/bar.json", JSON.stringify({ id: "same-id" }));
    mockProvider(dir, ["military/foo.json", "political/bar.json"]);
    const { validateArticleArchiveIntegrity } = await loadFresh();
    const report = await validateArticleArchiveIntegrity();
    expect(report.passed).toBe(false);
    expect(report.duplicateIds.length).toBe(1);
    expect(report.duplicateIds[0].value).toBe("same-id");
    expect(report.duplicateSlugs).toEqual(report.duplicateIds);
    expect(report.violations.some((v: any) => v.kind === "duplicate_id")).toBe(true);
  });

  test("duplicate recordId -> FAIL with duplicate_record_id, independent of duplicate_id", async () => {
    const dir = await makeTempDir("art-integ-duprecid-");
    await writeFile(dir, "military/foo.json", JSON.stringify({ id: "foo", recordId: "rec1" }));
    await writeFile(dir, "political/bar.json", JSON.stringify({ id: "bar", recordId: "rec1" }));
    mockProvider(dir, ["military/foo.json", "political/bar.json"]);
    const { validateArticleArchiveIntegrity } = await loadFresh();
    const report = await validateArticleArchiveIntegrity();
    expect(report.passed).toBe(false);
    expect(report.duplicateIds).toEqual([]);
    expect(report.duplicateRecordIds.length).toBe(1);
    expect(report.duplicateRecordIds[0].value).toBe("rec1");
    expect(report.violations.some((v: any) => v.kind === "duplicate_record_id")).toBe(true);
  });

  test("obsolete/replacement: fully valid replacement -> valid, no violations", async () => {
    const dir = await makeTempDir("art-integ-obs-valid-");
    // The replacement's filename must match its own in-file id (the
    // active filename_id_mismatch check applies to it, since it's the
    // declared file) — the obsolete source's filename is unchecked, since
    // it's never in articleFiles at all.
    await writeFile(dir, "military/old-article-a.json", JSON.stringify({ id: "article-a" }));
    await writeFile(dir, "military/article-a.json", JSON.stringify({ id: "article-a", recordId: "rec1" }));
    mockProvider(dir, ["military/article-a.json"], [{ file: "military/old-article-a.json", replacedBy: "military/article-a.json", reason: "renamed" }]);
    const { validateArticleArchiveIntegrity } = await loadFresh();
    const report = await validateArticleArchiveIntegrity();
    expect(report.passed).toBe(true);
    expect(report.obsoleteFiles.length).toBe(1);
    expect(report.obsoleteFiles[0].valid).toBe(true);
  });

  test("obsolete/replacement: missing replacement -> FAIL with obsolete_replacement_missing", async () => {
    const dir = await makeTempDir("art-integ-obs-missing-");
    await writeFile(dir, "military/old.json", JSON.stringify({ id: "article-a" }));
    mockProvider(dir, [], [{ file: "military/old.json", replacedBy: "military/new.json", reason: "test" }]);
    const { validateArticleArchiveIntegrity } = await loadFresh();
    const report = await validateArticleArchiveIntegrity();
    expect(report.passed).toBe(false);
    expect(report.violations.some((v: any) => v.kind === "obsolete_replacement_missing")).toBe(true);
  });

  test("obsolete/replacement: mismatched logical id -> FAIL with obsolete_replacement_mismatch", async () => {
    const dir = await makeTempDir("art-integ-obs-mismatch-");
    await writeFile(dir, "military/old.json", JSON.stringify({ id: "article-a" }));
    await writeFile(dir, "military/new.json", JSON.stringify({ id: "article-b", recordId: "rec1" }));
    mockProvider(dir, ["military/new.json"], [{ file: "military/old.json", replacedBy: "military/new.json", reason: "test" }]);
    const { validateArticleArchiveIntegrity } = await loadFresh();
    const report = await validateArticleArchiveIntegrity();
    expect(report.passed).toBe(false);
    expect(report.violations.some((v: any) => v.kind === "obsolete_replacement_mismatch")).toBe(true);
  });

  test("obsolete/replacement: replacement without recordId -> FAIL with obsolete_replacement_missing_record_id", async () => {
    const dir = await makeTempDir("art-integ-obs-norecid-");
    await writeFile(dir, "military/old.json", JSON.stringify({ id: "article-a" }));
    await writeFile(dir, "military/new.json", JSON.stringify({ id: "article-a" })); // no recordId
    mockProvider(dir, ["military/new.json"], [{ file: "military/old.json", replacedBy: "military/new.json", reason: "test" }]);
    const { validateArticleArchiveIntegrity } = await loadFresh();
    const report = await validateArticleArchiveIntegrity();
    expect(report.passed).toBe(false);
    expect(report.violations.some((v: any) => v.kind === "obsolete_replacement_missing_record_id")).toBe(true);
  });

  test("preloaded archive is consumed directly, not re-read from disk", async () => {
    const dir = await makeTempDir("art-integ-preload-");
    await writeFile(dir, "military/foo.json", JSON.stringify({ id: "foo" }));
    mockProvider(dir, ["military/foo.json"]);
    const { loadArticlesArchive, validateArticleArchiveIntegrity } = await loadFresh();

    const fsp = require("fs/promises");
    const archive = await loadArticlesArchive();

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

    const report = await validateArticleArchiveIntegrity(archive);
    expect(readFileCalls).toBe(0);
    expect(readdirCalls).toBe(0);
    expect(report.passed).toBe(true);

    (fsp.readFile as jest.Mock).mockRestore();
    (fsp.readdir as jest.Mock).mockRestore();
  });
});
