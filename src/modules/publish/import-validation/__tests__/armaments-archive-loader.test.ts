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
  const mod = require("../armaments-archive-loader");
  return { loadArmamentsArchive: mod.loadArmamentsArchive as () => Promise<any> };
}

describe("Armaments archive loader (Phase C) — synthetic state matrix", () => {
  afterEach(() => {
    jest.resetModules();
    jest.dontMock("../armaments-archive-manifest-provider");
  });

  test("1. valid flat-array file: extracted correctly, schemaType full", async () => {
    const dir = await makeTempDir("arm-flat-");
    await writeFile(dir, "panzer/germany.json", JSON.stringify([{ id: "tiger-i", name: "Tiger I" }, { id: "panther", name: "Panther" }]));
    mockProvider(dir, ["panzer/germany.json"]);
    const { loadArmamentsArchive } = await loadFresh();
    const archive = await loadArmamentsArchive();
    expect(archive.declaredItems.length).toBe(2);
    expect(archive.declaredItems.every((i: any) => i.schemaType === "full")).toBe(true);
    expect(archive.declaredItems.map((i: any) => i.item.id).sort()).toEqual(["panther", "tiger-i"]);
    expect(archive.declaredItems[0].category).toBe("panzer");
    expect(archive.declaredItems[0].fileNation).toBe("germany");
  });

  test("2. valid wrapper-key file: extracted correctly, schemaType minor", async () => {
    const dir = await makeTempDir("arm-wrapper-");
    // panzer's wrapper key is "vehicles" (WRAPPER_KEY_BY_CATEGORY)
    await writeFile(dir, "panzer/hungary.json", JSON.stringify({ vehicles: [{ id: "toldi-ii", name: "Toldi II" }] }));
    mockProvider(dir, ["panzer/hungary.json"]);
    const { loadArmamentsArchive } = await loadFresh();
    const archive = await loadArmamentsArchive();
    expect(archive.declaredItems.length).toBe(1);
    expect(archive.declaredItems[0].schemaType).toBe("minor");
    expect(archive.declaredItems[0].item.id).toBe("toldi-ii");
    expect(archive.declaredItems[0].fileNation).toBe("hungary");
  });

  test("3. malformed JSON -> zero items, raw undefined, no readError flag", async () => {
    const dir = await makeTempDir("arm-malformed-");
    await writeFile(dir, "panzer/germany.json", "{ not valid json");
    mockProvider(dir, ["panzer/germany.json"]);
    const { loadArmamentsArchive } = await loadFresh();
    const archive = await loadArmamentsArchive();
    expect(archive.declaredItems.length).toBe(0);
    const entry = archive.filesOnDisk.find((f: any) => f.relPath === "panzer/germany.json");
    expect(entry.raw).toBeUndefined();
    expect(entry.readError).toBeUndefined();
  });

  test("4. real unreadable file (EISDIR) -> zero items, raw undefined, readError:true", async () => {
    const dir = await makeTempDir("arm-unreadable-");
    await makeUnreadableJsonEntry(dir, "panzer/germany.json"); // a directory, not a file
    mockProvider(dir, ["panzer/germany.json"]);
    const { loadArmamentsArchive } = await loadFresh();
    const archive = await loadArmamentsArchive();
    expect(archive.declaredItems.length).toBe(0);
    const entry = archive.filesOnDisk.find((f: any) => f.relPath === "panzer/germany.json");
    expect(entry.raw).toBeUndefined();
    expect(entry.readError).toBe(true);
  });

  test("5. missing declared file -> absent from filesOnDisk entirely, zero items", async () => {
    const dir = await makeTempDir("arm-missing-");
    await fs.mkdir(path.join(dir, "panzer"), { recursive: true }); // dir exists, file does not
    mockProvider(dir, ["panzer/germany.json"]);
    const { loadArmamentsArchive } = await loadFresh();
    const archive = await loadArmamentsArchive();
    expect(archive.declaredItems.length).toBe(0);
    expect(archive.filesOnDisk.find((f: any) => f.relPath === "panzer/germany.json")).toBeUndefined();
  });

  test("6. undeclared physical file -> present in filesOnDisk, contributes zero declaredItems", async () => {
    const dir = await makeTempDir("arm-undeclared-");
    await writeFile(dir, "panzer/germany.json", JSON.stringify([{ id: "tiger-i", name: "Tiger I" }]));
    await writeFile(dir, "panzer/extra.json", JSON.stringify([{ id: "extra-tank", name: "Extra Tank" }]));
    mockProvider(dir, ["panzer/germany.json"]); // extra.json never declared
    const { loadArmamentsArchive } = await loadFresh();
    const archive = await loadArmamentsArchive();
    expect(archive.declaredItems.length).toBe(1);
    expect(archive.declaredItems[0].item.id).toBe("tiger-i");
    const undeclaredEntry = archive.filesOnDisk.find((f: any) => f.relPath === "panzer/extra.json");
    expect(undeclaredEntry).toBeDefined();
    expect(Array.isArray(undeclaredEntry.raw)).toBe(true); // parsed successfully, just not declared
  });

  test("7. literal null -> coerced before extractItems, zero items, no crash", async () => {
    const dir = await makeTempDir("arm-null-");
    await writeFile(dir, "panzer/germany.json", "null");
    mockProvider(dir, ["panzer/germany.json"]);
    const { loadArmamentsArchive } = await loadFresh();
    let archive: any;
    let threw = false;
    try {
      archive = await loadArmamentsArchive();
    } catch {
      threw = true;
    }
    expect(threw).toBe(false);
    expect(archive.declaredItems.length).toBe(0);
    const entry = archive.filesOnDisk.find((f: any) => f.relPath === "panzer/germany.json");
    expect(entry.raw).toBeNull(); // the loader preserves the true raw value in filesOnDisk...
    expect(entry.readError).toBeUndefined(); // ...and correctly does NOT call it a read error
  });

  test("8. valid empty array -> zero items, legitimately, no crash", async () => {
    const dir = await makeTempDir("arm-empty-");
    await writeFile(dir, "panzer/germany.json", "[]");
    mockProvider(dir, ["panzer/germany.json"]);
    const { loadArmamentsArchive } = await loadFresh();
    const archive = await loadArmamentsArchive();
    expect(archive.declaredItems.length).toBe(0);
    const entry = archive.filesOnDisk.find((f: any) => f.relPath === "panzer/germany.json");
    expect(entry.raw).toEqual([]);
  });

  test("9. bare number and bare string -> zero items, no crash, raw preserved as-is", async () => {
    const dir = await makeTempDir("arm-wrongshape-");
    await writeFile(dir, "panzer/germany.json", "42");
    await writeFile(dir, "panzer/italy.json", '"just a string"');
    mockProvider(dir, ["panzer/germany.json", "panzer/italy.json"]);
    const { loadArmamentsArchive } = await loadFresh();
    let archive: any;
    let threw = false;
    try {
      archive = await loadArmamentsArchive();
    } catch {
      threw = true;
    }
    expect(threw).toBe(false);
    expect(archive.declaredItems.length).toBe(0);
    const numberEntry = archive.filesOnDisk.find((f: any) => f.relPath === "panzer/germany.json");
    const stringEntry = archive.filesOnDisk.find((f: any) => f.relPath === "panzer/italy.json");
    expect(numberEntry.raw).toBe(42);
    expect(stringEntry.raw).toBe("just a string");
  });

  test("control: does not invent any violation/classification field — declaredItems and filesOnDisk are the only outputs", async () => {
    const dir = await makeTempDir("arm-control-");
    await writeFile(dir, "panzer/germany.json", JSON.stringify([{ id: "tiger-i", name: "Tiger I" }]));
    mockProvider(dir, ["panzer/germany.json"]);
    const { loadArmamentsArchive } = await loadFresh();
    const archive = await loadArmamentsArchive();
    expect(Object.keys(archive).sort()).toEqual(["declaredItems", "filesOnDisk"]);
  });
});

describe("Armaments archive loader (Phase C) — single-load property", () => {
  afterEach(() => {
    jest.resetModules();
    jest.dontMock("../armaments-archive-manifest-provider");
  });

  test("one call performs exactly one readdir per category and one read per discovered file", async () => {
    const dir = await makeTempDir("arm-singleload-");
    await writeFile(dir, "panzer/germany.json", JSON.stringify([{ id: "tiger-i", name: "Tiger I" }]));
    await writeFile(dir, "panzer/hungary.json", JSON.stringify({ vehicles: [{ id: "toldi-ii", name: "Toldi II" }] }));
    await writeFile(dir, "aircraft/germany.json", JSON.stringify([{ id: "bf-109", name: "Bf 109" }]));
    mockProvider(dir, ["panzer/germany.json", "panzer/hungary.json", "aircraft/germany.json"]);

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

    const { loadArmamentsArchive } = await loadFresh();
    const archive = await loadArmamentsArchive();

    expect(readdirCalls).toBe(2); // one per category folder: panzer, aircraft
    expect(readFileCalls).toBe(3); // one per discovered file
    expect(archive.declaredItems.length).toBe(3);

    (fsp.readFile as jest.Mock).mockRestore();
    (fsp.readdir as jest.Mock).mockRestore();
  });

  test("two independent calls produce independent snapshots, no caching", async () => {
    const dir = await makeTempDir("arm-nocache-");
    await writeFile(dir, "panzer/germany.json", JSON.stringify([{ id: "tiger-i", name: "Tiger I" }]));
    mockProvider(dir, ["panzer/germany.json"]);
    const { loadArmamentsArchive } = await loadFresh();

    const first = await loadArmamentsArchive();
    expect(first.declaredItems[0].item.id).toBe("tiger-i");

    await writeFile(dir, "panzer/germany.json", JSON.stringify([{ id: "CHANGED", name: "Changed" }]));

    const second = await loadArmamentsArchive();
    expect(second.declaredItems[0].item.id).toBe("CHANGED");
    expect(second).not.toBe(first);
  });
});
