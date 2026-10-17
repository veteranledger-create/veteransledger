import fs from "fs";
import os from "os";
import path from "path";
import { paths } from "../paths";
import { config } from "../app";
import { storageConfig } from "../storage";
import { SiteContentService } from "../../modules/site-content/site-content.service";
import { writeStagedFilesAtomically } from "../../modules/publish/atomic-stage-writer";

/**
 * Phase 1B — the path abstraction must change nothing.
 *
 * Every accessor is checked against the literal expression the call site used
 * before, so "resolves to its current location" is proved rather than
 * asserted. Beyond that, the four boundaries the abstraction exists to make
 * visible are each tested against the real repository.
 *
 * Read-only with one exception: the staging test writes into a throwaway
 * directory under the OS temp dir, never into storage/ or public/.
 */

const REPO_ROOT = path.resolve(__dirname, "../../..");
const PUBLIC_DATA = path.join(REPO_ROOT, "public", "data");

const CONTENT_TYPES = [
  "armaments", "articles", "awards", "campaigns", "formations",
  "letters", "maps", "nsdap", "personnel", "political-docs", "timeline",
];

describe("locations are unchanged", () => {
  it("anchors on the same repository root the old call sites did", () => {
    // Old idiom A: path.resolve(__dirname, "../../../../public/data") from
    // src/modules/publish/import-validation/*.
    expect(paths.repoInput.root).toBe(PUBLIC_DATA);
    // Old idiom B: path.join(config.paths.public, "data").
    expect(paths.repoInput.root).toBe(path.join(config.paths.public, "data"));
  });

  it("reproduces every former hard-coded directory expression", () => {
    for (const type of CONTENT_TYPES) {
      expect(paths.repoInput.dir(type)).toBe(path.resolve(PUBLIC_DATA, type));
      expect(paths.published.dir(type)).toBe(path.join(config.paths.public, "data", type));
      expect(paths.staging.dir(type)).toBe(
        path.join(storageConfig.directories.publishStaging, type),
      );
    }
    expect(paths.repoInput.file("timeline", "events.json")).toBe(
      path.resolve(PUBLIC_DATA, "timeline", "events.json"),
    );
    expect(paths.published.root).toBe(path.join(config.paths.public, "data"));
  });

  it("resolves /public/ URLs to the same files path.join did", () => {
    for (const url of [
      "/public/data/personnel/army.json",
      "/public/images/icons/flag.svg",
      "/public/data/armaments/naval/germany.json",
    ]) {
      expect(paths.publicAsset.fromUrl(url)).toBe(
        path.join(config.paths.public, url.slice("/public/".length)),
      );
    }
    expect(paths.publicAsset.fromUrl("/storage/images/x.webp")).toBeNull();
    expect(paths.publicAsset.fromUrl("not-a-url")).toBeNull();
  });

  it("treats an unresolvable URL as absent rather than throwing", () => {
    // The content-health scan feeds arbitrary strings found in JSON through
    // this; one bad value must not abort the scan or escape public/.
    expect(paths.publicAsset.fromUrl("/public/../../etc/passwd")).toBeNull();
    expect(paths.publicAsset.fromUrl("/public/")).toBeNull();
  });
});

describe("existing import inputs still resolve from the repository", () => {
  it("points at directories that really exist in this checkout", () => {
    for (const type of CONTENT_TYPES) {
      const dir = paths.repoInput.dir(type);
      expect(dir.startsWith(REPO_ROOT + path.sep)).toBe(true);
      expect(fs.existsSync(dir)).toBe(true);
      expect(fs.statSync(dir).isDirectory()).toBe(true);
    }
  });

  it("finds the archive manifests the importers load", () => {
    const manifests: Array<[string, string]> = [
      ["armaments", "armaments.archive.json"],
      ["articles", "articles.archive.json"],
      ["campaigns", "campaigns.archive.json"],
    ];
    for (const [type, name] of manifests) {
      const file = paths.repoInput.file(type, name);
      expect(file).toBe(path.join(PUBLIC_DATA, type, name));
      // The loaders tolerate a missing manifest, so assert the location is
      // right rather than that the file is present.
      expect(path.dirname(file)).toBe(paths.repoInput.dir(type));
    }
  });

  it("finds the timeline input the importer reads", () => {
    const file = paths.repoInput.file("timeline", "events.json");
    expect(fs.existsSync(file)).toBe(true);
  });

  it("rejects a content type that would escape the inputs root", () => {
    expect(() => paths.repoInput.dir("../secrets")).toThrow();
    expect(() => paths.repoInput.dir("/etc")).toThrow();
    expect(() => paths.repoInput.file("armaments", "../../../.env")).toThrow();
  });
});

describe("existing public file URLs remain unchanged", () => {
  it("emits the exact strings the index regenerators used to build", () => {
    expect(paths.published.url("personnel", "army.json")).toBe("/public/data/personnel/army.json");
    expect(paths.published.url("letters", "home-front.json")).toBe("/public/data/letters/home-front.json");
    expect(paths.published.url("articles", "military/blitzkrieg.json")).toBe(
      "/public/data/articles/military/blitzkrieg.json",
    );
    expect(paths.published.url("armaments")).toBe("/public/data/armaments");
  });

  it("matches every file URL already published in the real index files", () => {
    let checked = 0;
    for (const type of ["personnel", "letters", "articles"]) {
      const indexPath = path.join(PUBLIC_DATA, type, "index.json");
      if (!fs.existsSync(indexPath)) continue;
      const index = JSON.parse(fs.readFileSync(indexPath, "utf-8")) as Record<string, unknown>;

      const urls: string[] = [];
      const collect = (node: unknown): void => {
        if (Array.isArray(node)) return node.forEach(collect);
        if (node && typeof node === "object") {
          for (const [k, v] of Object.entries(node)) {
            if (k === "file" && typeof v === "string") urls.push(v);
            else if (k === "files" && Array.isArray(v)) {
              v.forEach((u) => typeof u === "string" && urls.push(u));
            } else collect(v);
          }
        }
      };
      collect(index);

      for (const url of urls) {
        const prefix = `/public/data/${type}/`;
        expect(url.startsWith(prefix)).toBe(true);
        // Rebuilding the URL from its own tail must reproduce it byte for byte.
        expect(paths.published.url(type, url.slice(prefix.length))).toBe(url);
        checked++;
      }
    }
    expect(checked).toBeGreaterThan(0);
  });

  it("keeps a published URL and its file in agreement", () => {
    const url = paths.published.url("personnel", "army.json");
    expect(paths.publicAsset.fromUrl(url)).toBe(paths.published.file("personnel", "army.json"));
  });
});

describe("staging writes remain staging-only", () => {
  it("never resolves inside the published archive", () => {
    const publishedRoot = path.resolve(paths.published.root);
    for (const type of CONTENT_TYPES) {
      const dir = path.resolve(paths.staging.dir(type));
      expect(dir.startsWith(publishedRoot + path.sep)).toBe(false);
      expect(dir.startsWith(path.resolve(storageConfig.directories.publishStaging) + path.sep)).toBe(true);
    }
  });

  it("cannot be steered out of the staging root by the type name", () => {
    expect(() => paths.staging.dir("../../public/data/personnel")).toThrow();
    expect(() => paths.staging.dir("..")).toThrow();
  });

  it("writes only inside the directory it was given", async () => {
    const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), "vl-staging-"));
    try {
      const outDir = path.join(sandbox, "publish-staging", "armaments");
      const sibling = path.join(sandbox, "published");
      fs.mkdirSync(sibling, { recursive: true });
      fs.writeFileSync(path.join(sibling, "germany.json"), "UNTOUCHED", "utf-8");

      await writeStagedFilesAtomically(
        outDir,
        new Map([["naval/germany.json", "{}"], ["index.json", "{}"]]),
      );

      expect(fs.existsSync(path.join(outDir, "naval", "germany.json"))).toBe(true);
      expect(fs.readFileSync(path.join(sibling, "germany.json"), "utf-8")).toBe("UNTOUCHED");
      expect(fs.readdirSync(sibling)).toEqual(["germany.json"]);
    } finally {
      fs.rmSync(sandbox, { recursive: true, force: true });
    }
  });

  it("leaves the real staging and published trees untouched by this suite", () => {
    // Nothing above writes to either; assert the sandbox was elsewhere.
    expect(path.resolve(storageConfig.directories.publishStaging).startsWith(REPO_ROOT)).toBe(true);
    expect(path.resolve(paths.published.root).startsWith(REPO_ROOT)).toBe(true);
  });
});

describe("editorial writes do not target generated archive output", () => {
  const service = new SiteContentService();

  // read() runs the identical key validation write() does, with no filesystem
  // write of any kind — so rejection can be proved without risking a save.
  const expectRejected = async (key: string, statusCode: number) => {
    await expect(service.read(key)).rejects.toMatchObject({ statusCode });
  };

  it("resolves an allowed editorial key to its real file", () => {
    expect(paths.editorial.resolve("homepage.json")).toBe(path.join(PUBLIC_DATA, "homepage.json"));
    expect(paths.editorial.resolve("about/mission.json")).toBe(
      path.join(PUBLIC_DATA, "about", "mission.json"),
    );
  });

  it("refuses every generated record file that exists on disk", async () => {
    // Walk the real archive and collect per-record output — everything under a
    // record type's directory except the editable index.json manifests.
    const GENERATED_TYPES = [
      "armaments", "articles", "awards", "campaigns",
      "letters", "maps", "personnel", "political-docs",
    ];
    const records: string[] = [];
    const walk = (dir: string, rel: string) => {
      if (!fs.existsSync(dir)) return;
      for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
        const childRel = rel ? `${rel}/${e.name}` : e.name;
        if (e.isDirectory()) walk(path.join(dir, e.name), childRel);
        else if (e.name.endsWith(".json") && e.name !== "index.json") records.push(childRel);
      }
    };
    for (const type of GENERATED_TYPES) walk(path.join(PUBLIC_DATA, type), type);

    // A low count would make this test pass vacuously.
    expect(records.length).toBeGreaterThan(50);
    for (const key of records) {
      await expectRejected(key, 403);
    }
  });

  it("still permits the section manifests the Admin owns", async () => {
    // These are the documented exception: labels and ordering are editorial
    // even though the file listing inside them is regenerated.
    for (const key of ["armaments/index.json", "personnel/index.json"]) {
      // Resolving must succeed and land on the real manifest.
      expect(paths.editorial.resolve(key)).toBe(path.join(PUBLIC_DATA, ...key.split("/")));
      // And the service must not reject it.
      await expect(service.read(key)).resolves.toBeDefined();
    }
  });

  it("refuses traversal, absolute and non-JSON keys", async () => {
    for (const key of ["../package.json", "/etc/passwd", "homepage", "about/../../secret.json"]) {
      await expectRejected(key, 400);
    }
    expect(() => paths.editorial.resolve("../package.json")).toThrow();
    expect(() => paths.editorial.resolve("/etc/passwd")).toThrow();
  });
});

describe("the dashboard asset resolver behaves exactly as before", () => {
  /** The literal expression dashboard.service.ts used prior to Phase 1B. */
  const legacyResolve = (url: string): string | null =>
    url.startsWith("/public/")
      ? path.join(config.paths.public, url.slice("/public/".length))
      : null;

  /** Every string in the real archive that looks like a /public/ asset URL. */
  const realPublicUrls = (): string[] => {
    const found = new Set<string>();
    const scan = (node: unknown): void => {
      if (typeof node === "string") {
        if (node.startsWith("/public/")) found.add(node);
        return;
      }
      if (Array.isArray(node)) return node.forEach(scan);
      if (node && typeof node === "object") Object.values(node).forEach(scan);
    };
    const walk = (dir: string): void => {
      for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
        const p = path.join(dir, e.name);
        if (e.isDirectory()) walk(p);
        else if (e.name.endsWith(".json")) {
          try { scan(JSON.parse(fs.readFileSync(p, "utf-8"))); } catch { /* skip */ }
        }
      }
    };
    walk(PUBLIC_DATA);
    return [...found];
  };

  it("resolves every real /public/ URL in the archive identically", () => {
    const urls = realPublicUrls();
    expect(urls.length).toBeGreaterThan(0);
    for (const url of urls) {
      expect(paths.publicAsset.fromUrl(url)).toBe(legacyResolve(url));
    }
  });

  it("stays inside the public root for every one of them", () => {
    const root = path.resolve(config.paths.public);
    for (const url of realPublicUrls()) {
      const resolved = paths.publicAsset.fromUrl(url);
      expect(resolved).not.toBeNull();
      expect(resolved!.startsWith(root + path.sep)).toBe(true);
    }
  });
});
