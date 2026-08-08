import fs from "fs";
import fsp from "fs/promises";
import os from "os";
import path from "path";
import { BaseArchiveManifestLoader } from "../archive-manifest-loader";
import { ArticleArchiveManifest, ArticleArchiveManifestLoader } from "../articles-archive-manifest-loader";
import { ArticleArchiveManifestProvider } from "../articles-archive-manifest-provider";

// Real, actual category counts for the Phase A manifest — verified
// directly against public/data/articles/**/*.json during the structural
// audit and Phase A, not assumed here. economy has zero active entries,
// so it never produces a key at all (groupActiveByCategory only creates
// keys for categories that appear in manifest.active).
const EXPECTED_CATEGORY_COUNTS: Record<string, number> = {
  military: 3,
  political: 4,
  legal: 1,
};
const EXPECTED_TOTAL = 8;

// Exercises the exact same getEmptyManifest()/isValidManifestShape() hooks
// as ArticleArchiveManifestLoader, but pointed at a temp directory —
// ArticleArchiveManifestLoader's own constructor hardcodes the real
// public/data/articles path (matching Campaigns'/Armaments' established
// pattern), so this is how the shape-validation/fallback behavior is
// tested without ever touching real archive data.
class TestArticleManifestLoader extends BaseArchiveManifestLoader<ArticleArchiveManifest> {
  protected getEmptyManifest(): ArticleArchiveManifest {
    return { active: [], obsolete: [] };
  }
  protected isValidManifestShape(parsed: unknown): parsed is ArticleArchiveManifest {
    const obj = parsed as Record<string, unknown> | null;
    return !!obj && Array.isArray(obj.active) && Array.isArray(obj.obsolete);
  }
}

describe("Articles manifest loader + provider (Phase B)", () => {
  test("valid manifest loads: the real Phase A manifest loads without a loadError", () => {
    const provider = new ArticleArchiveManifestProvider();
    expect(provider.getLoadError()).toBeUndefined();
    const manifest = provider.getManifest();
    expect(Array.isArray(manifest.active)).toBe(true);
    expect(Array.isArray(manifest.obsolete)).toBe(true);
  });

  test("all 8 active entries are exposed, obsolete is empty", () => {
    const provider = new ArticleArchiveManifestProvider();
    const manifest = provider.getManifest();
    expect(manifest.active.length).toBe(EXPECTED_TOTAL);
    expect(manifest.obsolete).toEqual([]);
  });

  test("category grouping matches the real archive exactly, including economy's absence", () => {
    const provider = new ArticleArchiveManifestProvider();
    const files = provider.getArticleFiles();
    const actualCounts = Object.fromEntries(
      Object.entries(files).map(([category, list]) => [category, list.length]),
    );
    expect(actualCounts).toEqual(EXPECTED_CATEGORY_COUNTS);
    expect(files.economy).toBeUndefined(); // zero active entries -> no key at all, not an empty array
    const total = Object.values(files).reduce((sum, list) => sum + list.length, 0);
    expect(total).toBe(EXPECTED_TOTAL);
  });

  test("paths remain intact — filenames are not split, truncated, or mangled", () => {
    const provider = new ArticleArchiveManifestProvider();
    const files = provider.getArticleFiles();
    expect(files.military).toEqual(expect.arrayContaining(["berlin-1945.json", "poland-1939.json", "rearmament.json"]));
    expect(files.political).toEqual(expect.arrayContaining(["anschluss.json", "july-20.json", "occupation.json", "rise-nsdap.json"]));
    expect(files.legal).toEqual(["nuremberg.json"]);
  });

  test("getArticlesDirectory() points at public/data/articles", () => {
    const provider = new ArticleArchiveManifestProvider();
    expect(provider.getArticlesDirectory()).toBe(provider.getArchiveDirectory());
    expect(provider.getArticlesDirectory().replace(/\\/g, "/")).toMatch(/public\/data\/articles$/);
  });

  test("no stale caching between independent provider instances", () => {
    const providerA = new ArticleArchiveManifestProvider();
    const providerB = new ArticleArchiveManifestProvider(new ArticleArchiveManifestLoader());
    const filesA = providerA.getArticleFiles();
    const filesB = providerB.getArticleFiles();
    expect(filesA).toEqual(filesB); // same real data, independently loaded
    expect(filesA).not.toBe(filesB); // but not the same cached object instance

    // Within one instance, the derived view IS memoized (by design) — but
    // invalidate() must correctly clear both the base cache and this
    // provider's own derived-view cache slot.
    const before = providerA.getArticleFiles();
    expect(providerA.getArticleFiles()).toBe(before); // same instance = memoized
    providerA.invalidate();
    const after = providerA.getArticleFiles();
    expect(after).toEqual(before); // same real data
    expect(after).not.toBe(before); // but recomputed, not stale
  });

  test("invalid manifest shape falls back to an empty manifest with a loadError, never throws (generic framework's established behavior)", async () => {
    const dir = await fsp.mkdtemp(path.join(os.tmpdir(), "articles-manifest-invalid-"));
    fs.writeFileSync(path.join(dir, "articles.archive.json"), JSON.stringify({ active: "not-an-array", obsolete: [] }));
    const loader = new TestArticleManifestLoader(dir, "articles.archive.json");

    let result: ReturnType<typeof loader.load>;
    expect(() => { result = loader.load(); }).not.toThrow();
    expect(result!.manifest).toEqual({ active: [], obsolete: [] });
    expect(result!.loadError).toBeDefined();
    expect(result!.loadError).toMatch(/malformed/i);
  });

  test("missing manifest file falls back to an empty manifest with a loadError, never throws", async () => {
    const dir = await fsp.mkdtemp(path.join(os.tmpdir(), "articles-manifest-missing-"));
    const loader = new TestArticleManifestLoader(dir, "articles.archive.json");

    let result: ReturnType<typeof loader.load>;
    expect(() => { result = loader.load(); }).not.toThrow();
    expect(result!.manifest).toEqual({ active: [], obsolete: [] });
    expect(result!.loadError).toBeDefined();
  });

  test("malformed JSON in the manifest itself falls back to an empty manifest with a loadError, never throws", async () => {
    const dir = await fsp.mkdtemp(path.join(os.tmpdir(), "articles-manifest-badjson-"));
    fs.writeFileSync(path.join(dir, "articles.archive.json"), "{ not valid json");
    const loader = new TestArticleManifestLoader(dir, "articles.archive.json");

    let result: ReturnType<typeof loader.load>;
    expect(() => { result = loader.load(); }).not.toThrow();
    expect(result!.manifest).toEqual({ active: [], obsolete: [] });
    expect(result!.loadError).toBeDefined();
    expect(result!.loadError).toMatch(/not valid JSON/);
  });
});
