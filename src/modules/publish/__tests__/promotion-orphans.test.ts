import fs from "fs";
import os from "os";
import path from "path";
import { findOrphanedRootJsonFiles } from "../promotion.service";
import {
  IMPORTER_INPUT_FILES,
  isImporterInput,
  isProtectedRootFile,
  protectedRootFiles,
} from "../import-validation/importer-inputs";
import { ArmamentArchiveManifestLoader } from "../import-validation/armaments-archive-manifest-loader";
import { ArticleArchiveManifestLoader } from "../import-validation/articles-archive-manifest-loader";
import { CampaignArchiveManifestLoader } from "../import-validation/campaigns-archive-manifest-loader";

/**
 * F1 — a promotion must not delete its own importer input.
 *
 * findOrphanedRootJsonFiles swept every root-level .json except index.json,
 * which would have removed campaigns.archive.json and articles.archive.json
 * on the next campaigns or articles promotion. Those are the files the
 * archive-manifest loaders read.
 *
 * Everything here runs against temporary fixture directories. No promotion is
 * performed, nothing under public/data is read or written, and
 * PROMOTION_ENABLED is untouched.
 */

let tmp: string;

/** A fixture shaped like a promoted campaigns/articles directory. */
function fixture(type: string, extraRootFiles: string[] = []): string {
  const dir = path.join(tmp, type);
  fs.mkdirSync(path.join(dir, "africa"), { recursive: true });
  fs.writeFileSync(path.join(dir, "index.json"), '{"theaters":[]}\n', "utf-8");
  fs.writeFileSync(path.join(dir, "africa", "tobruk.json"), '{"id":"tobruk"}\n', "utf-8");
  // The genuine legacy aggregates this prune exists to remove.
  fs.writeFileSync(path.join(dir, "eastern-front.json"), "[]\n", "utf-8");
  fs.writeFileSync(path.join(dir, "military.json"), "[]\n", "utf-8");
  for (const name of [...(IMPORTER_INPUT_FILES[type] ?? []), ...extraRootFiles]) {
    fs.writeFileSync(path.join(dir, name), '{"active":[],"obsolete":[]}\n', "utf-8");
  }
  return dir;
}

beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "vl-orphans-"));
});
afterEach(() => fs.rmSync(tmp, { recursive: true, force: true }));

describe("the importer-input declaration", () => {
  it("covers the manifest every archive loader actually reads", () => {
    // Derived from the loaders themselves, so declaring a new loader's input
    // cannot be forgotten without this failing.
    const loaders: Array<[string, { getManifestPath(): string }]> = [
      ["armaments", new ArmamentArchiveManifestLoader()],
      ["articles", new ArticleArchiveManifestLoader()],
      ["campaigns", new CampaignArchiveManifestLoader()],
    ];

    for (const [type, loader] of loaders) {
      const filename = path.basename(loader.getManifestPath());
      expect(isImporterInput(type, filename)).toBe(true);
      expect(isProtectedRootFile(type, filename)).toBe(true);
    }
  });

  it("places each loader's manifest in that type's own directory", () => {
    const cases: Array<[string, { getManifestPath(): string }]> = [
      ["armaments", new ArmamentArchiveManifestLoader()],
      ["articles", new ArticleArchiveManifestLoader()],
      ["campaigns", new CampaignArchiveManifestLoader()],
    ];
    for (const [type, loader] of cases) {
      // The prune is scoped per type, so a manifest filed under another
      // type's directory would not be protected by that type's declaration.
      expect(path.basename(path.dirname(loader.getManifestPath()))).toBe(type);
    }
  });

  it("always protects index.json, for every type", () => {
    for (const type of ["campaigns", "articles", "armaments", "awards", "maps", "political-docs", "unknown"]) {
      expect(isProtectedRootFile(type, "index.json")).toBe(true);
      expect(protectedRootFiles(type)).toContain("index.json");
    }
  });

  it("protects nothing extra for a type with no declared inputs", () => {
    expect(protectedRootFiles("awards")).toEqual(["index.json"]);
    expect(isImporterInput("awards", "awards.archive.json")).toBe(false);
  });

  it("does not protect a file merely because it looks like a manifest", () => {
    // The mechanism is an explicit list, not a filename pattern.
    expect(isProtectedRootFile("campaigns", "letters.archive.json")).toBe(false);
    expect(isProtectedRootFile("campaigns", "something.archive.json")).toBe(false);
  });
});

describe("campaigns promotion cannot remove its archive manifest", () => {
  it("excludes campaigns.archive.json from the deletion set", async () => {
    const dir = fixture("campaigns");
    const toDelete = await findOrphanedRootJsonFiles(dir, "campaigns");

    expect([...toDelete.keys()].sort()).toEqual(["eastern-front.json", "military.json"]);
    expect(toDelete.has("campaigns.archive.json")).toBe(false);
    expect(toDelete.has("index.json")).toBe(false);
  });

  it("leaves the manifest byte-for-byte on disk after the prune is applied", async () => {
    const dir = fixture("campaigns");
    const manifestPath = path.join(dir, "campaigns.archive.json");
    const before = fs.readFileSync(manifestPath);

    // Apply exactly what the promotion would apply.
    const toDelete = await findOrphanedRootJsonFiles(dir, "campaigns");
    for (const name of toDelete.keys()) fs.rmSync(path.join(dir, name));

    expect(fs.existsSync(manifestPath)).toBe(true);
    expect(fs.readFileSync(manifestPath).equals(before)).toBe(true);
    // And the stale aggregates really were removed.
    expect(fs.existsSync(path.join(dir, "eastern-front.json"))).toBe(false);
    expect(fs.existsSync(path.join(dir, "military.json"))).toBe(false);
  });

  it("would have deleted it under the old unqualified rule", async () => {
    // Pins the defect this fix addresses: the old behaviour was "every root
    // .json except index.json", which is what this reproduces.
    const dir = fixture("campaigns");
    const oldRule = fs
      .readdirSync(dir, { withFileTypes: true })
      .filter((e) => e.isFile() && e.name.endsWith(".json") && e.name !== "index.json")
      .map((e) => e.name);

    expect(oldRule).toContain("campaigns.archive.json");
    expect([...(await findOrphanedRootJsonFiles(dir, "campaigns")).keys()]).not.toContain(
      "campaigns.archive.json",
    );
  });
});

describe("articles promotion cannot remove its archive manifest", () => {
  it("excludes articles.archive.json from the deletion set", async () => {
    const dir = fixture("articles");
    const toDelete = await findOrphanedRootJsonFiles(dir, "articles");

    expect(toDelete.has("articles.archive.json")).toBe(false);
    expect(toDelete.has("index.json")).toBe(false);
    expect([...toDelete.keys()].sort()).toEqual(["eastern-front.json", "military.json"]);
  });

  it("leaves the manifest byte-for-byte on disk after the prune is applied", async () => {
    const dir = fixture("articles");
    const manifestPath = path.join(dir, "articles.archive.json");
    const before = fs.readFileSync(manifestPath);

    for (const name of (await findOrphanedRootJsonFiles(dir, "articles")).keys()) {
      fs.rmSync(path.join(dir, name));
    }
    expect(fs.readFileSync(manifestPath).equals(before)).toBe(true);
  });
});

describe("the prune itself", () => {
  it("still removes genuine legacy aggregates", async () => {
    const dir = fixture("campaigns");
    const toDelete = await findOrphanedRootJsonFiles(dir, "campaigns");
    expect(toDelete.get("eastern-front.json")).toBeNull(); // null = delete
    expect(toDelete.size).toBe(2);
  });

  it("never touches subdirectories", async () => {
    const dir = fixture("campaigns");
    const toDelete = await findOrphanedRootJsonFiles(dir, "campaigns");
    for (const name of toDelete.keys()) expect(name).not.toContain("/");
    expect(fs.existsSync(path.join(dir, "africa", "tobruk.json"))).toBe(true);
  });

  it("ignores non-JSON files at the root", async () => {
    const dir = fixture("campaigns");
    fs.writeFileSync(path.join(dir, "NOTES.md"), "keep me\n", "utf-8");
    fs.writeFileSync(path.join(dir, "data.csv"), "a,b\n", "utf-8");

    const toDelete = await findOrphanedRootJsonFiles(dir, "campaigns");
    expect([...toDelete.keys()]).not.toContain("NOTES.md");
    expect([...toDelete.keys()]).not.toContain("data.csv");
  });

  it("returns an empty set for a directory that does not exist", async () => {
    const toDelete = await findOrphanedRootJsonFiles(path.join(tmp, "absent"), "campaigns");
    expect(toDelete.size).toBe(0);
  });

  it("protects the declared input of whichever type it is pruning", async () => {
    // Same filename set, pruned as a different type: the campaigns manifest
    // is not an articles input, so scoping is per type and not global.
    const dir = fixture("campaigns");
    const asArticles = await findOrphanedRootJsonFiles(dir, "articles");
    expect(asArticles.has("campaigns.archive.json")).toBe(true);

    const asCampaigns = await findOrphanedRootJsonFiles(dir, "campaigns");
    expect(asCampaigns.has("campaigns.archive.json")).toBe(false);
  });
});
