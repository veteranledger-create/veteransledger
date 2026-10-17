import fs from "fs";
import os from "os";
import path from "path";
import { SiteContentService } from "../site-content.service";
import { ALLOWED_PREFIXES, isAllowedKey, listEditorialKeys } from "../editable-keys";
import { createRevisionStore, RevisionStore } from "../../editorial-history/revision-store";

/**
 * Phase 1D — the editorial API end to end: validation, history, restore.
 *
 * The service is pointed at a throwaway content root, so nothing here reads
 * or writes the project's real public/data.
 */

let tmp: string;
let contentRoot: string;
let store: RevisionStore;
let service: SiteContentService;

const read = (key: string): string => fs.readFileSync(path.join(contentRoot, key), "utf-8");

beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "vl-sc-"));
  contentRoot = path.join(tmp, "public-data");
  fs.mkdirSync(path.join(contentRoot, "about"), { recursive: true });
  fs.mkdirSync(path.join(contentRoot, "armaments"), { recursive: true });
  fs.writeFileSync(path.join(contentRoot, "homepage.json"), '{"hero":"original"}\n', "utf-8");
  fs.writeFileSync(path.join(contentRoot, "about", "mission.json"), '{"body":"original"}\n', "utf-8");
  fs.writeFileSync(
    path.join(contentRoot, "armaments", "index.json"),
    `${JSON.stringify({ categories: [{ id: "naval", label: "Naval", nations: ["germany"] }] }, null, 2)}\n`,
    "utf-8",
  );
  store = createRevisionStore(path.join(tmp, "editorial"));
  service = new SiteContentService(store, contentRoot);
});

afterEach(() => fs.rmSync(tmp, { recursive: true, force: true }));

describe("the allowlist", () => {
  it("no longer carries a bare formations prefix", () => {
    expect(ALLOWED_PREFIXES).not.toContain("formations");
    expect(isAllowedKey("formations/germany/divisions.json")).toBe(false);
    expect(isAllowedKey("formations/index.json")).toBe(false);
  });

  it("still allows everything the Admin actually edits", () => {
    for (const key of [
      "homepage.json", "navigation.json", "page-content.json", "site-settings.json", "ui-strings.json",
      "about/mission.json", "legal/privacy-policy.json", "site-policies/disclaimer.json",
      "nsdap/overview.json", "nsdap/index.json", "nsdap/party/programme.json",
      "armaments/index.json", "personnel/index.json",
    ]) {
      expect(isAllowedKey(key)).toBe(true);
    }
  });

  it("still refuses generated record files", () => {
    for (const key of [
      "armaments/naval/germany.json", "personnel/army.json", "campaigns/africa/tobruk.json",
      "timeline/events.json", "articles/military/poland-1939.json",
    ]) {
      expect(isAllowedKey(key)).toBe(false);
    }
  });

  it("enumerates only allowlisted files that exist", async () => {
    expect(await listEditorialKeys(contentRoot)).toEqual([
      "about/mission.json", "armaments/index.json", "homepage.json",
    ]);
  });
});

describe("rejected keys", () => {
  it.each([
    ["traversal", "../package.json", 400],
    ["nested traversal", "about/../../secret.json", 400],
    ["absolute posix", "/etc/passwd", 400],
    ["backslash", "about\\mission.json", 400],
    ["non-json", "homepage", 400],
    ["empty", "", 400],
    ["not allowlisted", "personnel/army.json", 403],
    ["formations, now closed", "formations/germany/divisions.json", 403],
  ])("refuses %s on write", async (_label, key, status) => {
    await expect(service.write(key, { a: 1 })).rejects.toMatchObject({ statusCode: status });
  });

  it("refuses the same keys on history and restore", async () => {
    await expect(service.history("../package.json")).rejects.toMatchObject({ statusCode: 400 });
    await expect(service.restore("personnel/army.json", "x")).rejects.toMatchObject({ statusCode: 403 });
  });

  it("writes nothing when a key is refused", async () => {
    const before = read("homepage.json");
    await expect(service.write("../escape.json", { a: 1 })).rejects.toThrow();
    expect(read("homepage.json")).toBe(before);
    expect(fs.existsSync(path.join(tmp, "escape.json"))).toBe(false);
  });
});

describe("rejected content", () => {
  it("refuses a scalar body", async () => {
    await expect(service.write("homepage.json", "just text")).rejects.toMatchObject({ statusCode: 400 });
    expect(read("homepage.json")).toBe('{"hero":"original"}\n');
  });

  it("refuses dropping a top-level field", async () => {
    await service.write("homepage.json", { hero: "a", extra: "b" });
    await expect(service.write("homepage.json", { hero: "a" })).rejects.toMatchObject({ statusCode: 409 });
  });

  it("refuses a generated-field write and leaves the file alone", async () => {
    const before = read("armaments/index.json");
    await expect(
      service.write("armaments/index.json", {
        categories: [{ id: "naval", label: "Naval", nations: ["germany", "invented"] }],
      }),
    ).rejects.toMatchObject({ statusCode: 409 });
    expect(read("armaments/index.json")).toBe(before);
  });

  it("accepts a label-only edit to a section manifest", async () => {
    await service.write("armaments/index.json", {
      categories: [{ id: "naval", label: "Kriegsmarine", nations: ["germany"] }],
    });
    expect(JSON.parse(read("armaments/index.json")).categories[0].label).toBe("Kriegsmarine");
  });

  it("records no revision for a rejected save", async () => {
    await expect(service.write("homepage.json", 42)).rejects.toThrow();
    expect(await service.history("homepage.json")).toEqual([]);
  });
});

describe("saving", () => {
  it("writes the same serialisation this API always has", async () => {
    await service.write("homepage.json", { hero: "new", nested: { a: 1 } });
    expect(read("homepage.json")).toBe(`${JSON.stringify({ hero: "new", nested: { a: 1 } }, null, 2)}\n`);
  });

  it("records the actor and note on the revision", async () => {
    const revision = await service.write("homepage.json", { hero: "new" }, {
      actor: "editor@example.test", note: "tightened the strapline",
    });
    expect(revision.actor).toBe("editor@example.test");
    expect(revision.note).toBe("tightened the strapline");
    expect(revision.source).toBe("save");
  });

  it("captures the pre-existing file as its own revision", async () => {
    await service.write("homepage.json", { hero: "new" });
    const revisions = await service.history("homepage.json");
    expect(revisions.map((r) => r.source)).toEqual(["captured", "save"]);
    expect(await store.read("homepage.json", revisions[0].id)).toBe('{"hero":"original"}\n');
  });

  it("creates a file that did not exist", async () => {
    await service.write("ui-strings.json", { "nav.home": "Home" });
    expect(JSON.parse(read("ui-strings.json"))).toEqual({ "nav.home": "Home" });
  });

  it("reports a failure to record history as a failure to save", async () => {
    // A file where the history directory needs to go.
    fs.mkdirSync(path.join(tmp, "editorial", "history", "about"), { recursive: true });
    fs.writeFileSync(path.join(tmp, "editorial", "history", "about", "mission.json"), "blocked", "utf-8");

    const before = read("about/mission.json");
    await expect(service.write("about/mission.json", { body: "new" })).rejects.toMatchObject({
      statusCode: 500,
      message: expect.stringMatching(/history could not be recorded/),
    });
    expect(read("about/mission.json")).toBe(before);
  });
});

describe("restoring", () => {
  it("puts a file back and records the restore as a new revision", async () => {
    await service.write("homepage.json", { hero: "second" });
    await service.write("homepage.json", { hero: "third" });

    const revisions = await service.history("homepage.json");
    const original = revisions.find((r) => r.source === "captured")!;

    const restored = await service.restore("homepage.json", original.id, { actor: "admin@example.test" });

    expect(read("homepage.json")).toBe('{"hero":"original"}\n');
    expect(restored.source).toBe("restore");
    expect(restored.note).toContain(original.id);
    expect(restored.actor).toBe("admin@example.test");

    // Append-only: the state that was replaced is still recoverable.
    const after = await service.history("homepage.json");
    expect(after.length).toBeGreaterThan(revisions.length);
    expect(after.some((r) => r.sha256 === revisions.at(-1)!.sha256)).toBe(true);
  });

  it("restores the recorded bytes verbatim, not a re-serialisation", async () => {
    // Four-space indentation, as several real editorial files use.
    const odd = '{\n    "body": "four space indent"\n}\n';
    fs.writeFileSync(path.join(contentRoot, "about", "mission.json"), odd, "utf-8");
    await service.write("about/mission.json", { body: "replaced" });

    const captured = (await service.history("about/mission.json")).find((r) => r.source === "captured")!;
    await service.restore("about/mission.json", captured.id);

    expect(read("about/mission.json")).toBe(odd);
  });

  it("refuses a revision whose bytes no longer match their hash", async () => {
    await service.write("homepage.json", { hero: "second" });
    const target = (await service.history("homepage.json")).at(-1)!;
    fs.writeFileSync(path.join(store.historyDir("homepage.json"), `${target.id}.json`), '{"tampered":true}\n', "utf-8");

    await expect(service.restore("homepage.json", target.id)).rejects.toMatchObject({
      statusCode: 409,
      message: expect.stringMatching(/checksum|bytes/),
    });
    // And the live file is untouched by the attempt.
    expect(JSON.parse(read("homepage.json"))).toEqual({ hero: "second" });
  });

  it("refuses an unknown revision", async () => {
    await expect(
      service.restore("homepage.json", "20261013T071158123Z-deadbeef"),
    ).rejects.toMatchObject({ statusCode: 409 });
  });

  it("refuses a malformed revision id", async () => {
    await expect(service.restore("homepage.json", "../../etc/passwd")).rejects.toMatchObject({ statusCode: 409 });
  });

  it("re-runs validation, so a restore cannot reintroduce a forbidden shape", async () => {
    // Record a revision, then make the live file incompatible with it.
    await service.write("homepage.json", { hero: "a", keepMe: true });
    const withBoth = (await service.history("homepage.json")).at(-1)!;
    await service.write("homepage.json", { hero: "b", keepMe: true, andMe: 1 });

    // Restoring the earlier revision would drop "andMe" — the same rule a
    // normal save is held to, applied to a restore.
    await expect(service.restore("homepage.json", withBoth.id)).rejects.toMatchObject({
      statusCode: 409,
      message: expect.stringMatching(/Cannot restore/),
    });
  });
});

describe("reconcile through the service", () => {
  it("adopts an orphaned revision blob", async () => {
    await service.write("homepage.json", { hero: "second" });
    const dir = store.historyDir("homepage.json");
    const content = '{"hero":"orphaned"}\n';
    const hash = require("crypto").createHash("sha256").update(content, "utf-8").digest("hex");
    fs.writeFileSync(path.join(dir, `20261013T071158123Z-${hash.slice(0, 8)}.json`), content, "utf-8");

    const report = await service.reconcile("homepage.json");
    expect(report.adopted).toHaveLength(1);
    expect(report.corrupt).toEqual([]);
  });
});
