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
function mockProvider(armamentsDir: string, active: string[], obsolete: { file: string; replacedBy: string; reason: string }[] = []) {
  jest.doMock("../armaments-archive-manifest-provider", () => ({
    armamentArchiveManifestProvider: {
      getArmamentsDirectory: () => armamentsDir,
      getArmamentFiles: () => groupActiveByCategory(active),
      getManifest: () => ({ active, obsolete }),
      getLoadError: () => undefined,
    },
  }));
}
async function loadFresh() {
  const loaderMod = require("../armaments-archive-loader");
  const integrityMod = require("../armaments-archive-integrity");
  return {
    loadArmamentsArchive: loaderMod.loadArmamentsArchive as () => Promise<any>,
    validateArmamentArchiveIntegrity: integrityMod.validateArmamentArchiveIntegrity as (a?: any) => Promise<any>,
  };
}

describe("Armaments archive integrity (Phase D)", () => {
  afterEach(() => {
    jest.resetModules();
    jest.dontMock("../armaments-archive-manifest-provider");
  });

  test("real archive integrity passes", async () => {
    jest.resetModules();
    jest.dontMock("../armaments-archive-manifest-provider");
    const integrityMod = require("../armaments-archive-integrity");
    const report = await integrityMod.validateArmamentArchiveIntegrity();
    expect(report.passed).toBe(true);
    expect(report.violations).toEqual([]);
    expect(report.declaredFiles).toBe(28);
    expect(report.totalDeclaredItems).toBe(85);
    expect(report.missingDeclaredFiles).toEqual([]);
    expect(report.unreadableDeclaredFiles).toEqual([]);
    expect(report.malformedDeclaredFiles).toEqual([]);
    expect(report.wrongShapeDeclaredFiles).toEqual([]);
    expect(report.undeclaredFiles).toEqual([]);
    expect(report.duplicateIds).toEqual([]);
    expect(report.duplicateRecordIds).toEqual([]);
  });

  test("missing declared file -> FAIL with missing_declared_file only", async () => {
    const dir = await makeTempDir("integ-missing-");
    await fs.mkdir(path.join(dir, "panzer"), { recursive: true });
    mockProvider(dir, ["panzer/germany.json"]);
    const { validateArmamentArchiveIntegrity } = await loadFresh();
    const report = await validateArmamentArchiveIntegrity();
    expect(report.passed).toBe(false);
    expect(report.missingDeclaredFiles).toEqual(["panzer/germany.json"]);
    expect(report.violations.some((v: any) => v.kind === "missing_declared_file")).toBe(true);
  });

  test("malformed declared file -> FAIL with malformed_declared_file only", async () => {
    const dir = await makeTempDir("integ-malformed-");
    await writeFile(dir, "panzer/germany.json", "{ not valid json");
    mockProvider(dir, ["panzer/germany.json"]);
    const { validateArmamentArchiveIntegrity } = await loadFresh();
    const report = await validateArmamentArchiveIntegrity();
    expect(report.passed).toBe(false);
    expect(report.malformedDeclaredFiles).toEqual(["panzer/germany.json"]);
    expect(report.unreadableDeclaredFiles).toEqual([]);
    expect(report.violations.some((v: any) => v.kind === "malformed_declared_file")).toBe(true);
  });

  test("unreadable declared file (real EISDIR) -> FAIL with unreadable_declared_file only", async () => {
    const dir = await makeTempDir("integ-unreadable-");
    await makeUnreadableJsonEntry(dir, "panzer/germany.json");
    mockProvider(dir, ["panzer/germany.json"]);
    const { validateArmamentArchiveIntegrity } = await loadFresh();
    const report = await validateArmamentArchiveIntegrity();
    expect(report.passed).toBe(false);
    expect(report.unreadableDeclaredFiles).toEqual(["panzer/germany.json"]);
    expect(report.malformedDeclaredFiles).toEqual([]);
    expect(report.violations.some((v: any) => v.kind === "unreadable_declared_file")).toBe(true);
  });

  test("undeclared physical file -> FAIL with undeclared_file", async () => {
    const dir = await makeTempDir("integ-undeclared-");
    await writeFile(dir, "panzer/germany.json", JSON.stringify([{ id: "tiger-i", name: "Tiger I" }]));
    await writeFile(dir, "panzer/extra.json", JSON.stringify([{ id: "extra-tank", name: "Extra Tank" }]));
    mockProvider(dir, ["panzer/germany.json"]);
    const { validateArmamentArchiveIntegrity } = await loadFresh();
    const report = await validateArmamentArchiveIntegrity();
    expect(report.passed).toBe(false);
    expect(report.undeclaredFiles).toEqual(["panzer/extra.json"]);
    expect(report.violations.some((v: any) => v.kind === "undeclared_file")).toBe(true);
  });

  test("wrong-shape declared JSON (bare number) -> FAIL with wrong_shape_declared_file", async () => {
    const dir = await makeTempDir("integ-wrongshape-");
    await writeFile(dir, "panzer/germany.json", "42");
    mockProvider(dir, ["panzer/germany.json"]);
    const { validateArmamentArchiveIntegrity } = await loadFresh();
    const report = await validateArmamentArchiveIntegrity();
    expect(report.passed).toBe(false);
    expect(report.wrongShapeDeclaredFiles).toEqual(["panzer/germany.json"]);
    expect(report.malformedDeclaredFiles).toEqual([]); // parsed fine, just wrong shape — must not be conflated
    expect(report.violations.some((v: any) => v.kind === "wrong_shape_declared_file")).toBe(true);
  });

  test("wrong-shape declared JSON (object without the category's wrapper key) -> FAIL", async () => {
    const dir = await makeTempDir("integ-wrongshape2-");
    await writeFile(dir, "panzer/germany.json", JSON.stringify({ someOtherKey: [1, 2, 3] }));
    mockProvider(dir, ["panzer/germany.json"]);
    const { validateArmamentArchiveIntegrity } = await loadFresh();
    const report = await validateArmamentArchiveIntegrity();
    expect(report.passed).toBe(false);
    expect(report.wrongShapeDeclaredFiles).toEqual(["panzer/germany.json"]);
  });

  test("literal null declared file -> does NOT crash integrity, and is NOT flagged wrong-shape (loader already coerces it to a legitimate empty container)", async () => {
    const dir = await makeTempDir("integ-null-");
    await writeFile(dir, "panzer/germany.json", "null");
    mockProvider(dir, ["panzer/germany.json"]);
    const { validateArmamentArchiveIntegrity } = await loadFresh();
    let threw = false;
    let report: any;
    try {
      report = await validateArmamentArchiveIntegrity();
    } catch {
      threw = true;
    }
    expect(threw).toBe(false);
    expect(report.passed).toBe(true);
    expect(report.wrongShapeDeclaredFiles).toEqual([]);
    expect(report.totalDeclaredItems).toBe(0);
  });

  test("legitimately empty flat array and empty wrapper object -> PASS, not flagged wrong-shape", async () => {
    const dir = await makeTempDir("integ-empty-");
    await writeFile(dir, "panzer/germany.json", "[]");
    await writeFile(dir, "panzer/hungary.json", JSON.stringify({ vehicles: [] }));
    mockProvider(dir, ["panzer/germany.json", "panzer/hungary.json"]);
    const { validateArmamentArchiveIntegrity } = await loadFresh();
    const report = await validateArmamentArchiveIntegrity();
    expect(report.passed).toBe(true);
    expect(report.wrongShapeDeclaredFiles).toEqual([]);
  });

  test("duplicate id across two different files -> FAIL with duplicate_id", async () => {
    const dir = await makeTempDir("integ-dupid-");
    await writeFile(dir, "panzer/germany.json", JSON.stringify([{ id: "tiger-i", name: "Tiger I (Germany)" }]));
    await writeFile(dir, "panzer/italy.json", JSON.stringify([{ id: "tiger-i", name: "Tiger I (Italy, mislabeled)" }]));
    mockProvider(dir, ["panzer/germany.json", "panzer/italy.json"]);
    const { validateArmamentArchiveIntegrity } = await loadFresh();
    const report = await validateArmamentArchiveIntegrity();
    expect(report.passed).toBe(false);
    expect(report.duplicateIds.length).toBe(1);
    expect(report.duplicateIds[0].value).toBe("tiger-i");
    expect(report.duplicateSlugs).toEqual(report.duplicateIds);
    expect(report.violations.some((v: any) => v.kind === "duplicate_id")).toBe(true);
  });

  test("duplicate id WITHIN the same file -> FAIL with duplicate_id (an Armaments-specific case Campaigns' model can't have)", async () => {
    const dir = await makeTempDir("integ-dupid-samefile-");
    await writeFile(dir, "panzer/germany.json", JSON.stringify([
      { id: "tiger-i", name: "Tiger I" },
      { id: "tiger-i", name: "Tiger I (duplicate entry)" },
    ]));
    mockProvider(dir, ["panzer/germany.json"]);
    const { validateArmamentArchiveIntegrity } = await loadFresh();
    const report = await validateArmamentArchiveIntegrity();
    expect(report.passed).toBe(false);
    expect(report.duplicateIds.length).toBe(1);
    expect(report.duplicateIds[0].files.length).toBe(2);
  });

  test("duplicate recordId -> FAIL with duplicate_record_id, independent of duplicate_id", async () => {
    const dir = await makeTempDir("integ-duprecid-");
    await writeFile(dir, "panzer/germany.json", JSON.stringify([{ id: "tiger-i", recordId: "rec1", name: "Tiger I" }]));
    await writeFile(dir, "panzer/italy.json", JSON.stringify([{ id: "panther", recordId: "rec1", name: "Panther" }]));
    mockProvider(dir, ["panzer/germany.json", "panzer/italy.json"]);
    const { validateArmamentArchiveIntegrity } = await loadFresh();
    const report = await validateArmamentArchiveIntegrity();
    expect(report.passed).toBe(false);
    expect(report.duplicateIds).toEqual([]); // ids differ, no id collision
    expect(report.duplicateRecordIds.length).toBe(1);
    expect(report.duplicateRecordIds[0].value).toBe("rec1");
    expect(report.violations.some((v: any) => v.kind === "duplicate_record_id")).toBe(true);
  });

  test("obsolete/replacement: fully covered replacement -> valid, no violations", async () => {
    const dir = await makeTempDir("integ-obs-valid-");
    await writeFile(dir, "panzer/other-axis.json", JSON.stringify([{ id: "toldi-ii", name: "Toldi II" }]));
    await writeFile(dir, "panzer/hungary.json", JSON.stringify([{ id: "toldi-ii", name: "Toldi II", recordId: "rec1" }]));
    mockProvider(dir, ["panzer/hungary.json"], [{ file: "panzer/other-axis.json", replacedBy: "panzer/hungary.json", reason: "promoted to real nation file" }]);
    const { validateArmamentArchiveIntegrity } = await loadFresh();
    const report = await validateArmamentArchiveIntegrity();
    expect(report.passed).toBe(true);
    expect(report.obsoleteFiles.length).toBe(1);
    expect(report.obsoleteFiles[0].valid).toBe(true);
    expect(report.obsoleteFiles[0].uncoveredSourceItems).toEqual([]);
  });

  test("obsolete/replacement: missing replacement file -> FAIL with obsolete_replacement_missing", async () => {
    const dir = await makeTempDir("integ-obs-missing-repl-");
    await writeFile(dir, "panzer/other-axis.json", JSON.stringify([{ id: "toldi-ii", name: "Toldi II" }]));
    mockProvider(dir, [], [{ file: "panzer/other-axis.json", replacedBy: "panzer/hungary.json", reason: "test" }]);
    const { validateArmamentArchiveIntegrity } = await loadFresh();
    const report = await validateArmamentArchiveIntegrity();
    expect(report.passed).toBe(false);
    expect(report.violations.some((v: any) => v.kind === "obsolete_replacement_missing")).toBe(true);
  });

  test("obsolete/replacement: replacement missing one of the source's records -> FAIL with obsolete_replacement_incomplete", async () => {
    const dir = await makeTempDir("integ-obs-incomplete-");
    await writeFile(dir, "panzer/other-axis.json", JSON.stringify([
      { id: "toldi-ii", name: "Toldi II" },
      { id: "r-2-lt-vz-35", name: "R-2" },
    ]));
    await writeFile(dir, "panzer/hungary.json", JSON.stringify([{ id: "toldi-ii", name: "Toldi II", recordId: "rec1" }])); // missing r-2-lt-vz-35
    mockProvider(dir, ["panzer/hungary.json"], [{ file: "panzer/other-axis.json", replacedBy: "panzer/hungary.json", reason: "test" }]);
    const { validateArmamentArchiveIntegrity } = await loadFresh();
    const report = await validateArmamentArchiveIntegrity();
    expect(report.passed).toBe(false);
    expect(report.obsoleteFiles[0].valid).toBe(false);
    expect(report.obsoleteFiles[0].uncoveredSourceItems).toEqual(["r-2-lt-vz-35"]);
    expect(report.violations.some((v: any) => v.kind === "obsolete_replacement_incomplete")).toBe(true);
  });

  test("preloaded archive is consumed directly, not re-read from disk", async () => {
    const dir = await makeTempDir("integ-preload-");
    await writeFile(dir, "panzer/germany.json", JSON.stringify([{ id: "tiger-i", name: "Tiger I" }]));
    mockProvider(dir, ["panzer/germany.json"]);
    const { loadArmamentsArchive, validateArmamentArchiveIntegrity } = await loadFresh();

    const fsp = require("fs/promises");
    const archive = await loadArmamentsArchive();

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

    const report = await validateArmamentArchiveIntegrity(archive);
    expect(readFileCalls).toBe(0);
    expect(readdirCalls).toBe(0);
    expect(report.passed).toBe(true);

    (fsp.readFile as jest.Mock).mockRestore();
    (fsp.readdir as jest.Mock).mockRestore();
  });
});
