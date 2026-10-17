import fs from "fs";
import fsp from "fs/promises";
import os from "os";
import path from "path";
import { BaselineError, establishBaseline } from "../publish-baseline";
import { createVersionStore, VersionStore, VERSIONED_TYPES } from "../../modules/publish/version-store";

/**
 * R3c — the baseline command.
 *
 * The version resolver only takes over a request once an active version
 * exists; until then every request falls through to express.static. That
 * makes versioning safe to deploy unused, and it also means the very first
 * promotion is served straight from public/data while it is still writing
 * files one rename at a time — the partially-applied state versioning exists
 * to prevent, at the one moment there is no baseline to fall back on.
 *
 * Everything here runs against a throwaway store and a throwaway source
 * directory. The command is never run against the project's own public/data,
 * and importing it must never capture anything — which is itself asserted.
 */

let tmp: string;
let src: string;
let store: VersionStore;

const writeFile = (rel: string, content: string): void => {
  const p = path.join(src, rel);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, content, "utf-8");
};

beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "vl-baseline-"));
  src = path.join(tmp, "public-data");
  fs.mkdirSync(src, { recursive: true });
  writeFile("armaments/index.json", '{"categories":[]}');
  writeFile("armaments/naval/germany.json", '{"records":[]}');
  writeFile("campaigns/index.json", '{"theaters":[]}');
  writeFile("nsdap/overview.json", '{"title":"editorial"}');
  writeFile("homepage.json", '{"hero":"editorial"}');
  store = createVersionStore(path.join(tmp, "published"));
});

afterEach(() => {
  jest.restoreAllMocks();
  fs.rmSync(tmp, { recursive: true, force: true });
});

describe("creating the first baseline", () => {
  it("captures public/data as v1 and activates it", async () => {
    const result = await establishBaseline(store, src);

    expect(result.outcome).toBe("created");
    expect(result.version).toBe("v1");
    expect(await store.readActiveVersion()).toBe("v1");
    expect(await store.listVersions()).toEqual(["v1"]);
  });

  it("copies the versioned types, and only those", async () => {
    await establishBaseline(store, src);
    const captured = fs.readdirSync(store.versionDir("v1")).sort();

    expect(captured).toEqual(["armaments", "campaigns"]);
    // Editorial content is served live and is deliberately not frozen.
    expect(captured).not.toContain("nsdap");
    expect(fs.existsSync(path.join(store.versionDir("v1"), "homepage.json"))).toBe(false);
    for (const type of captured) expect(VERSIONED_TYPES as readonly string[]).toContain(type);
  });

  it("captures the files byte-for-byte", async () => {
    await establishBaseline(store, src);
    expect(fs.readFileSync(path.join(store.versionDir("v1"), "armaments", "naval", "germany.json"), "utf-8"))
      .toBe('{"records":[]}');
  });

  it("leaves the source directory untouched", async () => {
    const before = fs.readdirSync(src).sort();
    const naval = fs.readFileSync(path.join(src, "armaments", "naval", "germany.json"), "utf-8");

    await establishBaseline(store, src);

    expect(fs.readdirSync(src).sort()).toEqual(before);
    expect(fs.readFileSync(path.join(src, "armaments", "naval", "germany.json"), "utf-8")).toBe(naval);
  });

  it("says what changed about serving, including the part that is a trade-off", async () => {
    const { message } = await establishBaseline(store, src);
    expect(message).toContain("v1");
    expect(message).toMatch(/public\/data is unchanged/);
    // The consequence an operator has to know before running it.
    expect(message).toMatch(/only after the next promotion/);
  });
});

describe("an existing baseline", () => {
  it("is reported and left exactly as it was", async () => {
    await establishBaseline(store, src);
    const pointerBefore = fs.readFileSync(store.pointerFile, "utf-8");

    const second = await establishBaseline(store, src);

    expect(second.outcome).toBe("already-exists");
    expect(second.version).toBe("v1");
    expect(fs.readFileSync(store.pointerFile, "utf-8")).toBe(pointerBefore);
  });

  it("captures nothing on a repeat run, even when the content has changed", async () => {
    await establishBaseline(store, src);
    writeFile("armaments/naval/italy.json", '{"records":["new"]}');

    await establishBaseline(store, src);

    expect(await store.listVersions()).toEqual(["v1"]);
    expect(fs.existsSync(path.join(store.versionDir("v1"), "armaments", "naval", "italy.json"))).toBe(false);
  });

  it("is idempotent across repeated runs", async () => {
    const first = await establishBaseline(store, src);
    for (let i = 0; i < 3; i++) {
      const again = await establishBaseline(store, src);
      expect(again.outcome).toBe("already-exists");
      expect(again.version).toBe(first.version);
    }
    expect(await store.listVersions()).toEqual(["v1"]);
  });

  it("recognises a baseline created by anything else, not just by itself", async () => {
    // A promotion may have created the first version. The command must not
    // treat that as "no baseline" and build a second one beside it.
    const existing = await store.createVersionFrom(src);
    await store.writeActiveVersion(existing);

    const result = await establishBaseline(store, src);
    expect(result).toMatchObject({ outcome: "already-exists", version: existing });
    expect(await store.listVersions()).toEqual([existing]);
  });

  it("treats an unreadable pointer as no baseline and proceeds", async () => {
    // readActiveVersion already returns null for a corrupt pointer; this
    // pins the resulting behaviour rather than leaving it to inference.
    await fsp.mkdir(path.dirname(store.pointerFile), { recursive: true });
    await fsp.writeFile(store.pointerFile, "{ not json", "utf-8");

    const result = await establishBaseline(store, src);
    expect(result.outcome).toBe("created");
    expect(await store.readActiveVersion()).toBe(result.version);
  });
});

describe("a failed capture", () => {
  it("writes no pointer and reports that serving is unchanged", async () => {
    jest.spyOn(store, "createVersionFrom").mockRejectedValue(new Error("ENOSPC copying armaments"));

    const err = await establishBaseline(store, src).catch((e: unknown) => e);

    expect(err).toBeInstanceOf(BaselineError);
    expect((err as BaselineError).stage).toBe("capture");
    expect((err as BaselineError).originalError.message).toBe("ENOSPC copying armaments");
    expect((err as BaselineError).orphanedVersion).toBeUndefined();
    expect((err as BaselineError).message).toContain("ENOSPC copying armaments");
    expect((err as BaselineError).message).toMatch(/serving is unchanged/);

    expect(fs.existsSync(store.pointerFile)).toBe(false);
    expect(await store.readActiveVersion()).toBeNull();
  });

  it("leaves no version behind", async () => {
    // createVersionFrom assembles under a temp name and removes it on
    // failure, so a real capture failure leaves the versions root clean.
    const realCp = jest.requireActual<typeof fsp>("fs/promises").cp;
    jest.spyOn(fsp, "cp").mockImplementation((async (from: string, to: string, opts: unknown) => {
      if (String(from).endsWith("campaigns")) throw new Error("EIO mid-copy");
      return realCp(from, to, opts as Parameters<typeof realCp>[2]);
    }) as never);

    await expect(establishBaseline(store, src)).rejects.toBeInstanceOf(BaselineError);

    expect(await store.listVersions()).toEqual([]);
    expect(fs.existsSync(store.versionsRoot) ? fs.readdirSync(store.versionsRoot) : []).toEqual([]);
  });

  it("can be retried cleanly once the cause is fixed", async () => {
    const failing = jest.spyOn(store, "createVersionFrom").mockRejectedValueOnce(new Error("transient"));
    await expect(establishBaseline(store, src)).rejects.toBeInstanceOf(BaselineError);
    failing.mockRestore();

    const result = await establishBaseline(store, src);
    expect(result.outcome).toBe("created");
    expect(result.version).toBe("v1");
  });
});

describe("a failed activation", () => {
  const breakActivation = (): void => {
    jest.spyOn(store, "writeActiveVersion").mockRejectedValue(new Error("EROFS writing active.json"));
  };

  it("reports the stage, the cause, and that nothing is being served from it", async () => {
    breakActivation();
    const err = await establishBaseline(store, src).catch((e: unknown) => e) as BaselineError;

    expect(err).toBeInstanceOf(BaselineError);
    expect(err.stage).toBe("activation");
    expect(err.originalError.message).toBe("EROFS writing active.json");
    expect(err.message).toMatch(/pointer was NOT written/);
    expect(err.message).toMatch(/serving is unchanged/);
  });

  it("names the unreferenced directory rather than leaving it to be found later", async () => {
    breakActivation();
    const err = await establishBaseline(store, src).catch((e: unknown) => e) as BaselineError;

    expect(err.orphanedVersion).toBe("v1");
    expect(err.message).toContain(store.versionDir("v1"));
    // It really is on disk, and really is unreferenced.
    expect(fs.existsSync(store.versionDir("v1"))).toBe(true);
    expect(await store.readActiveVersion()).toBeNull();
  });

  it("does not activate a half-written pointer", async () => {
    breakActivation();
    await expect(establishBaseline(store, src)).rejects.toBeInstanceOf(BaselineError);
    expect(fs.existsSync(store.pointerFile)).toBe(false);
  });

  it("a retry after the orphan is cleared produces a clean baseline", async () => {
    breakActivation();
    await expect(establishBaseline(store, src)).rejects.toBeInstanceOf(BaselineError);
    jest.restoreAllMocks();

    fs.rmSync(store.versionDir("v1"), { recursive: true, force: true });
    const result = await establishBaseline(store, src);

    expect(result.outcome).toBe("created");
    expect(await store.readActiveVersion()).toBe(result.version);
    expect(await store.listVersions()).toEqual([result.version]);
  });

  it("a retry without clearing the orphan allocates a fresh id beside it", async () => {
    // Stated by the error message, so it is pinned rather than assumed.
    breakActivation();
    await expect(establishBaseline(store, src)).rejects.toBeInstanceOf(BaselineError);
    jest.restoreAllMocks();

    const result = await establishBaseline(store, src);
    expect(result.version).toBe("v2");
    expect(await store.listVersions()).toEqual(["v1", "v2"]);
    expect(await store.readActiveVersion()).toBe("v2");
  });
});

describe("the command never runs on its own", () => {
  const source = fs.readFileSync(path.resolve(__dirname, "../publish-baseline.ts"), "utf-8");

  it("guards its entry point, so importing it captures nothing", () => {
    expect(source).toContain("if (require.main === module)");
    // This very suite imports the module. If the guard were missing, a
    // version would have been captured from the real public/data on import.
    expect(source.indexOf("if (require.main === module)"))
      .toBeLessThan(source.indexOf("establishBaseline()"));
  });

  it("is imported by nothing in the application", () => {
    // Nothing may pull this in at startup or from the promotion path.
    const roots = ["src/app.ts", "src/index.ts", "src/modules", "src/config"];
    const hits: string[] = [];
    const walk = (p: string): void => {
      const stat = fs.statSync(p);
      if (stat.isDirectory()) { for (const e of fs.readdirSync(p)) walk(path.join(p, e)); return; }
      if (!p.endsWith(".ts")) return;
      if (fs.readFileSync(p, "utf-8").includes("publish-baseline")) hits.push(p);
    };
    for (const r of roots) if (fs.existsSync(r)) walk(r);
    expect(hits).toEqual([]);
  });

  it("is not wired into any npm script", () => {
    const pkg = JSON.parse(fs.readFileSync("package.json", "utf-8")) as { scripts: Record<string, string> };
    for (const command of Object.values(pkg.scripts)) {
      expect(command).not.toContain("publish-baseline");
    }
  });
});
