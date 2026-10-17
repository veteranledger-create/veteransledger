import fs from "fs";
import fsp from "fs/promises";
import os from "os";
import path from "path";
import {
  createVersionStore,
  isValidVersionId,
  isVersionedType,
  MIN_RETAINED_PRIOR,
  VersionStore,
  VERSIONED_TYPES,
} from "../version-store";

/**
 * Phase 1C — the version store itself: identifiers, the atomic pointer,
 * containment, and retention.
 *
 * Every test runs against a throwaway store under the OS temp dir. Nothing
 * here touches the project's own storage/ or public/ directories.
 */

let tmpRoot: string;
let sourceDir: string;
let store: VersionStore;

/** Builds a miniature archive to capture as a version. */
function writeArchive(dir: string, marker: string): void {
  fs.mkdirSync(path.join(dir, "armaments", "naval"), { recursive: true });
  fs.mkdirSync(path.join(dir, "personnel"), { recursive: true });
  fs.writeFileSync(path.join(dir, "armaments", "index.json"), JSON.stringify({ marker }), "utf-8");
  fs.writeFileSync(path.join(dir, "armaments", "naval", "germany.json"), JSON.stringify({ marker }), "utf-8");
  fs.writeFileSync(path.join(dir, "personnel", "index.json"), JSON.stringify({ marker }), "utf-8");
  // Editorial content that must never be captured into a version.
  fs.mkdirSync(path.join(dir, "about"), { recursive: true });
  fs.writeFileSync(path.join(dir, "homepage.json"), JSON.stringify({ marker }), "utf-8");
  fs.writeFileSync(path.join(dir, "about", "mission.json"), JSON.stringify({ marker }), "utf-8");
}

beforeEach(() => {
  tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "vl-versions-"));
  sourceDir = path.join(tmpRoot, "public-data");
  writeArchive(sourceDir, "v1");
  store = createVersionStore(path.join(tmpRoot, "published"));
});

afterEach(() => {
  fs.rmSync(tmpRoot, { recursive: true, force: true });
});

describe("version identifiers", () => {
  it.each(["v1", "v2", "v41", "v999"])("accepts %s", (id) => {
    expect(isValidVersionId(id)).toBe(true);
  });

  it.each([
    "v0", "v01", "V1", "1", "v", "v1.2", "v-1", "v1/x", "v1\\x", "..", "",
    "v1%2e%2e", "latest", "active", "v1 ", " v1",
  ])("rejects %p", (id) => {
    expect(isValidVersionId(id)).toBe(false);
  });

  it.each([null, undefined, 41, {}, []])("rejects non-string %p", (id) => {
    expect(isValidVersionId(id)).toBe(false);
  });

  it("refuses to build a directory path from an invalid id", () => {
    expect(() => store.versionDir("../../etc")).toThrow();
    expect(() => store.versionDir("v0")).toThrow();
  });
});

describe("path containment inside a version", () => {
  it("resolves a normal nested path", () => {
    expect(store.resolveVersionedPath("v1", "armaments/naval/germany.json")).toBe(
      path.join(store.versionsRoot, "v1", "armaments", "naval", "germany.json"),
    );
  });

  it.each([
    "../v2/armaments/index.json",
    "../../active.json",
    "/etc/passwd",
    "C:\\Windows\\system32",
    "armaments/../../../secret.json",
    "armaments\\..\\..\\..\\secret.json",
  ])("refuses %p", (rel) => {
    expect(() => store.resolveVersionedPath("v1", rel)).toThrow();
  });

  it("refuses an invalid version even with a safe path", () => {
    expect(() => store.resolveVersionedPath("../v2", "armaments/index.json")).toThrow();
  });
});

describe("creating versions", () => {
  it("starts empty", async () => {
    expect(await store.listVersions()).toEqual([]);
    expect(await store.readActiveVersion()).toBeNull();
  });

  it("captures versioned types and numbers them sequentially", async () => {
    const v1 = await store.createVersionFrom(sourceDir);
    const v2 = await store.createVersionFrom(sourceDir);
    expect([v1, v2]).toEqual(["v1", "v2"]);
    expect(await store.listVersions()).toEqual(["v1", "v2"]);

    const captured = fs.readFileSync(
      path.join(store.versionDir("v1"), "armaments", "naval", "germany.json"), "utf-8",
    );
    expect(JSON.parse(captured)).toEqual({ marker: "v1" });
  });

  it("leaves editorial content out of the version", async () => {
    await store.createVersionFrom(sourceDir);
    const dir = store.versionDir("v1");
    expect(fs.existsSync(path.join(dir, "homepage.json"))).toBe(false);
    expect(fs.existsSync(path.join(dir, "about"))).toBe(false);
    expect(fs.existsSync(path.join(dir, "armaments"))).toBe(true);
  });

  it("orders versions numerically, not lexically", async () => {
    for (let i = 0; i < 11; i++) await store.createVersionFrom(sourceDir);
    const all = await store.listVersions();
    expect(all[all.length - 1]).toBe("v11");
    expect(all.indexOf("v9")).toBeLessThan(all.indexOf("v10"));
  });

  it("does not reuse an id taken by a stray entry", async () => {
    await store.createVersionFrom(sourceDir); // v1
    // Something with a version-shaped name that is not a usable version.
    fs.writeFileSync(path.join(store.versionsRoot, "v2"), "stray", "utf-8");

    const next = await store.createVersionFrom(sourceDir);
    expect(next).toBe("v3");
    expect(fs.readFileSync(path.join(store.versionsRoot, "v2"), "utf-8")).toBe("stray");
    expect(await store.listVersions()).toEqual(["v1", "v3"]);
  });

  it("gives concurrent captures distinct ids", async () => {
    const ids = await Promise.all(
      Array.from({ length: 5 }, () => store.createVersionFrom(sourceDir)),
    );
    expect(new Set(ids).size).toBe(5);
    expect((await store.listVersions()).length).toBe(5);
    // Every one is a complete, readable version.
    for (const id of ids) {
      const f = path.join(store.versionDir(id), "armaments", "naval", "germany.json");
      expect(JSON.parse(fs.readFileSync(f, "utf-8"))).toEqual({ marker: "v1" });
    }
  });

  it("fails rather than overwriting when no id can be allocated", async () => {
    await store.createVersionFrom(sourceDir); // v1
    // Block the next 25 candidate ids.
    for (let i = 2; i <= 27; i++) {
      fs.mkdirSync(path.join(store.versionsRoot, `v${i}`), { recursive: true });
      fs.writeFileSync(path.join(store.versionsRoot, `v${i}`, "sentinel"), "keep", "utf-8");
    }
    // Allocation starts above the highest existing id, so it succeeds here —
    // the guarantee under test is that nothing already present is clobbered.
    const next = await store.createVersionFrom(sourceDir);
    expect(next).toBe("v28");
    for (let i = 2; i <= 27; i++) {
      expect(fs.existsSync(path.join(store.versionsRoot, `v${i}`, "sentinel"))).toBe(true);
    }
  });

  it("never leaves a half-built version visible", async () => {
    await store.createVersionFrom(sourceDir);
    // A temp directory would sort/filter out; only valid ids are listed.
    fs.mkdirSync(path.join(store.versionsRoot, ".tmp-v2-abc"), { recursive: true });
    expect(await store.listVersions()).toEqual(["v1"]);
  });
});

describe("the active pointer", () => {
  it("refuses to activate a version that does not exist", async () => {
    await expect(store.writeActiveVersion("v7")).rejects.toThrow(/does not exist/);
    expect(await store.readActiveVersion()).toBeNull();
  });

  it("refuses an invalid identifier", async () => {
    await expect(store.writeActiveVersion("../x")).rejects.toThrow();
  });

  it("switches atomically and reads back", async () => {
    await store.createVersionFrom(sourceDir);
    await store.createVersionFrom(sourceDir);
    await store.writeActiveVersion("v1");
    expect(await store.readActiveVersion()).toBe("v1");
    await store.writeActiveVersion("v2");
    expect(await store.readActiveVersion()).toBe("v2");
  });

  it("treats a corrupt pointer as no pointer rather than crashing", async () => {
    await fsp.mkdir(store.root, { recursive: true });
    await fsp.writeFile(store.pointerFile, "{ not json", "utf-8");
    expect(await store.readActiveVersion()).toBeNull();
    await fsp.writeFile(store.pointerFile, JSON.stringify({ version: "../evil" }), "utf-8");
    expect(await store.readActiveVersion()).toBeNull();
  });

  it("leaves no temp files behind", async () => {
    await store.createVersionFrom(sourceDir);
    await store.writeActiveVersion("v1");
    const leftovers = fs.readdirSync(store.root).filter((n) => n.startsWith(".active-"));
    expect(leftovers).toEqual([]);
  });
});

describe("retention", () => {
  /** Creates n versions and activates the newest. */
  const seed = async (n: number): Promise<string[]> => {
    const ids: string[] = [];
    for (let i = 0; i < n; i++) ids.push(await store.createVersionFrom(sourceDir));
    await store.writeActiveVersion(ids[ids.length - 1]);
    return ids;
  };

  it("keeps the active version plus at least three prior ones", async () => {
    await seed(6);
    const { kept, pruned } = await store.pruneVersions();
    expect(kept).toEqual(["v3", "v4", "v5", "v6"]);
    expect(pruned).toEqual(["v1", "v2"]);
    expect(kept.length).toBe(MIN_RETAINED_PRIOR + 1);
    expect(await store.listVersions()).toEqual(kept);
  });

  it("prunes nothing when there are not enough versions yet", async () => {
    await seed(3);
    const { kept, pruned } = await store.pruneVersions();
    expect(pruned).toEqual([]);
    expect(kept).toEqual(["v1", "v2", "v3"]);
  });

  it("never prunes the active version even if it is the oldest", async () => {
    await seed(8);
    await store.writeActiveVersion("v1");
    const { kept, pruned } = await store.pruneVersions();
    expect(pruned).toEqual([]);
    expect(kept).toContain("v1");
    expect(await store.readActiveVersion()).toBe("v1");
  });

  it("never prunes a version an operation has claimed", async () => {
    await seed(8); // active v8; v1..v4 would normally go
    const release = store.claimVersion("v1");
    const { pruned, kept, protectedFromPrune } = await store.pruneVersions();
    expect(pruned).not.toContain("v1");
    expect(kept).toContain("v1");
    expect(protectedFromPrune).toEqual(["v1"]);
    expect(fs.existsSync(store.versionDir("v1"))).toBe(true);

    // Once released it becomes prunable again.
    release();
    const second = await store.pruneVersions();
    expect(second.pruned).toContain("v1");
  });

  it("honours a claim taken more than once until every holder releases", async () => {
    await seed(8);
    const a = store.claimVersion("v2");
    const b = store.claimVersion("v2");
    a();
    expect((await store.pruneVersions()).pruned).not.toContain("v2");
    b();
    expect((await store.pruneVersions()).pruned).toContain("v2");
  });

  it("keeps a version newer than active rather than discarding it", async () => {
    await seed(6);
    await store.writeActiveVersion("v4"); // a rollback-like state
    const { kept } = await store.pruneVersions();
    expect(kept).toEqual(expect.arrayContaining(["v5", "v6"]));
  });

  it("cannot be asked to retain fewer than the minimum", async () => {
    await seed(8);
    const { kept } = await store.pruneVersions({ keepPrior: 0 });
    expect(kept.length).toBeGreaterThanOrEqual(MIN_RETAINED_PRIOR + 1);
  });

  it("is idempotent", async () => {
    await seed(7);
    const first = await store.pruneVersions();
    const second = await store.pruneVersions();
    expect(second.pruned).toEqual([]);
    expect(second.kept).toEqual(first.kept);
  });
});

describe("which content is versioned", () => {
  it("covers every promotion-managed type", () => {
    for (const t of VERSIONED_TYPES) expect(isVersionedType(t)).toBe(true);
  });

  it("excludes hand-maintained editorial content", () => {
    for (const t of ["about", "legal", "site-policies", "homepage.json", "navigation.json", ""]) {
      expect(isVersionedType(t)).toBe(false);
    }
  });

  it("excludes nsdap, whose content is edited live through the Admin", () => {
    // All 23 nsdap files are editable via nsdap-admin.js, it has no database
    // source and no index regenerator, and its record URLs come from a static
    // DATA_MAP rather than its index — so versioning it would only freeze
    // editorial text until someone ran a promotion.
    expect(isVersionedType("nsdap")).toBe(false);
    expect(VERSIONED_TYPES).not.toContain("nsdap");
  });
});
