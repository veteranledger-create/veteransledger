import fs from "fs";
import fsp from "fs/promises";
import os from "os";
import path from "path";
import { BaseArchiveManifestLoader } from "../archive-manifest-loader";
import { ArmamentArchiveManifest, ArmamentArchiveManifestLoader } from "../armaments-archive-manifest-loader";
import { ArmamentArchiveManifestProvider } from "../armaments-archive-manifest-provider";

// Real, actual category counts for the Phase A manifest — verified
// directly against public/data/armaments/**/*.json during Phase A, not
// assumed here. equipment is 6, not 5: czechoslovakia-germany-captured,
// germany, hungary-romania-bulgaria, italy, japan, romania.
const EXPECTED_CATEGORY_COUNTS: Record<string, number> = {
  aircraft: 4,
  equipment: 6,
  missiles: 4,
  naval: 4,
  panzer: 5,
  wunderwaffen: 5,
};
const EXPECTED_TOTAL = 28;

// Exercises the exact same getEmptyManifest()/isValidManifestShape() hooks
// as ArmamentArchiveManifestLoader, but pointed at a temp directory —
// ArmamentArchiveManifestLoader's own constructor hardcodes the real
// public/data/armaments path (matching CampaignArchiveManifestLoader's
// established pattern), so this is how the shape-validation/fallback
// behavior is tested without ever touching real archive data.
class TestArmamentManifestLoader extends BaseArchiveManifestLoader<ArmamentArchiveManifest> {
  protected getEmptyManifest(): ArmamentArchiveManifest {
    return { active: [], obsolete: [] };
  }
  protected isValidManifestShape(parsed: unknown): parsed is ArmamentArchiveManifest {
    const obj = parsed as Record<string, unknown> | null;
    return !!obj && Array.isArray(obj.active) && Array.isArray(obj.obsolete);
  }
}

describe("Armaments manifest loader + provider (Phase B)", () => {
  test("valid manifest loads: the real Phase A manifest loads without a loadError", () => {
    const provider = new ArmamentArchiveManifestProvider();
    expect(provider.getLoadError()).toBeUndefined();
    const manifest = provider.getManifest();
    expect(Array.isArray(manifest.active)).toBe(true);
    expect(Array.isArray(manifest.obsolete)).toBe(true);
  });

  test("all 28 active entries are exposed, obsolete is empty", () => {
    const provider = new ArmamentArchiveManifestProvider();
    const manifest = provider.getManifest();
    expect(manifest.active.length).toBe(EXPECTED_TOTAL);
    expect(manifest.obsolete).toEqual([]);
  });

  test("category grouping matches the real archive exactly", () => {
    const provider = new ArmamentArchiveManifestProvider();
    const files = provider.getArmamentFiles();
    const actualCounts = Object.fromEntries(
      Object.entries(files).map(([category, list]) => [category, list.length]),
    );
    expect(actualCounts).toEqual(EXPECTED_CATEGORY_COUNTS);
    const total = Object.values(files).reduce((sum, list) => sum + list.length, 0);
    expect(total).toBe(EXPECTED_TOTAL);
  });

  test("compound fileNation labels remain intact, not split or truncated", () => {
    const provider = new ArmamentArchiveManifestProvider();
    const files = provider.getArmamentFiles();
    expect(files.equipment).toContain("hungary-romania-bulgaria.json");
    expect(files.equipment).toContain("czechoslovakia-germany-captured.json");
    expect(files.panzer).toContain("hungary.json");
    expect(files.panzer).toContain("romania.json");
    // No NATIONS-grid leftovers: "other-axis" does not exist anywhere.
    for (const list of Object.values(files)) {
      expect(list).not.toContain("other-axis.json");
    }
  });

  test("getArmamentsDirectory() points at public/data/armaments", () => {
    const provider = new ArmamentArchiveManifestProvider();
    expect(provider.getArmamentsDirectory()).toBe(provider.getArchiveDirectory());
    expect(provider.getArmamentsDirectory().replace(/\\/g, "/")).toMatch(/public\/data\/armaments$/);
  });

  test("no stale caching between independent provider instances", () => {
    const providerA = new ArmamentArchiveManifestProvider();
    const providerB = new ArmamentArchiveManifestProvider(new ArmamentArchiveManifestLoader());
    const filesA = providerA.getArmamentFiles();
    const filesB = providerB.getArmamentFiles();
    expect(filesA).toEqual(filesB); // same real data, independently loaded
    expect(filesA).not.toBe(filesB); // but not the same cached object instance

    // Within one instance, the derived view IS memoized (by design) — but
    // invalidate() must correctly clear both the base cache and this
    // provider's own derived-view cache slot, matching
    // CampaignArchiveManifestProvider's contract.
    const before = providerA.getArmamentFiles();
    expect(providerA.getArmamentFiles()).toBe(before); // same instance = memoized
    providerA.invalidate();
    const after = providerA.getArmamentFiles();
    expect(after).toEqual(before); // same real data
    expect(after).not.toBe(before); // but recomputed, not stale
  });

  test("invalid manifest shape falls back to an empty manifest with a loadError, never throws (generic framework's established behavior)", async () => {
    const dir = await fsp.mkdtemp(path.join(os.tmpdir(), "armaments-manifest-invalid-"));
    fs.writeFileSync(path.join(dir, "armaments.archive.json"), JSON.stringify({ active: "not-an-array", obsolete: [] }));
    const loader = new TestArmamentManifestLoader(dir, "armaments.archive.json");

    let result: ReturnType<typeof loader.load>;
    expect(() => { result = loader.load(); }).not.toThrow();
    expect(result!.manifest).toEqual({ active: [], obsolete: [] });
    expect(result!.loadError).toBeDefined();
    expect(result!.loadError).toMatch(/malformed/i);
  });

  test("missing manifest file falls back to an empty manifest with a loadError, never throws", async () => {
    const dir = await fsp.mkdtemp(path.join(os.tmpdir(), "armaments-manifest-missing-"));
    const loader = new TestArmamentManifestLoader(dir, "armaments.archive.json");

    let result: ReturnType<typeof loader.load>;
    expect(() => { result = loader.load(); }).not.toThrow();
    expect(result!.manifest).toEqual({ active: [], obsolete: [] });
    expect(result!.loadError).toBeDefined();
  });

  test("malformed JSON in the manifest itself falls back to an empty manifest with a loadError, never throws", async () => {
    const dir = await fsp.mkdtemp(path.join(os.tmpdir(), "armaments-manifest-badjson-"));
    fs.writeFileSync(path.join(dir, "armaments.archive.json"), "{ not valid json");
    const loader = new TestArmamentManifestLoader(dir, "armaments.archive.json");

    let result: ReturnType<typeof loader.load>;
    expect(() => { result = loader.load(); }).not.toThrow();
    expect(result!.manifest).toEqual({ active: [], obsolete: [] });
    expect(result!.loadError).toBeDefined();
    expect(result!.loadError).toMatch(/not valid JSON/);
  });
});
