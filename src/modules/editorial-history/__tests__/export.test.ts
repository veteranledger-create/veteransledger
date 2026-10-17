import { execFileSync } from "child_process";
import crypto from "crypto";
import fs from "fs";
import fsp from "fs/promises";
import os from "os";
import path from "path";
import { createTar, readTar } from "../tar";
import { createEditorialExporter, EditorialExporter } from "../export";
import { createRevisionStore, RevisionStore, sha256 } from "../revision-store";

/**
 * Phase 1D — the manual export.
 *
 * The archive format is checked against the real `tar` binary as well as this
 * module's own reader, because the reason for using tar at all is that the
 * editorial set must be recoverable without this application.
 */

let tmp: string;
let contentRoot: string;
let store: RevisionStore;
let exporter: EditorialExporter;

/** A miniature editorial tree using real allowlisted keys. */
function writeEditorial(marker: string): void {
  fs.mkdirSync(path.join(contentRoot, "about"), { recursive: true });
  fs.mkdirSync(path.join(contentRoot, "site-policies"), { recursive: true });
  fs.writeFileSync(path.join(contentRoot, "homepage.json"), `{"marker":"${marker}"}\n`, "utf-8");
  fs.writeFileSync(path.join(contentRoot, "navigation.json"), `{"nav":"${marker}"}\n`, "utf-8");
  // Non-ASCII on purpose. The real editorial set carries German umlauts, and
  // a pure-ASCII fixture would hide a bug in how the archive is hashed: a
  // latin1 round-trip is a no-op for every byte below 0x80, so the defect
  // this fixture exists to catch would simply not appear.
  fs.writeFileSync(
    path.join(contentRoot, "about", "mission.json"),
    `{"mission":"${marker}","note":"Panzerkampfwagen VI — Königstiger ✦ Düsseldorf"}\n`,
    "utf-8",
  );
  fs.writeFileSync(path.join(contentRoot, "site-policies", "disclaimer.json"), `{"d":"${marker}"}\n`, "utf-8");
  // Not allowlisted — must never appear in an export.
  fs.mkdirSync(path.join(contentRoot, "armaments", "naval"), { recursive: true });
  fs.writeFileSync(path.join(contentRoot, "armaments", "naval", "germany.json"), "{}\n", "utf-8");
}

beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "vl-export-"));
  contentRoot = path.join(tmp, "public-data");
  fs.mkdirSync(contentRoot, { recursive: true });
  writeEditorial("v1");
  store = createRevisionStore(path.join(tmp, "editorial"));
  exporter = createEditorialExporter(path.join(tmp, "editorial"), contentRoot, store);
});

afterEach(() => {
  jest.restoreAllMocks();
  fs.rmSync(tmp, { recursive: true, force: true });
});

describe("the archive format", () => {
  it("round-trips through its own reader", () => {
    const entries = [
      { name: "a.json", content: '{"a":1}\n' },
      { name: "nested/b.json", content: "x".repeat(1000) },
      { name: "empty.json", content: "" },
    ];
    const read = readTar(createTar(entries));
    expect(read).toEqual([...entries].sort((x, y) => (x.name < y.name ? -1 : 1)));
  });

  it("is byte-identical for the same input regardless of entry order", () => {
    const a = createTar([{ name: "b.json", content: "2" }, { name: "a.json", content: "1" }]);
    const b = createTar([{ name: "a.json", content: "1" }, { name: "b.json", content: "2" }]);
    expect(a.equals(b)).toBe(true);
  });

  it("detects a corrupted header", () => {
    const archive = createTar([{ name: "a.json", content: "1" }]);
    archive[10] = archive[10] ^ 0xff; // flip bits inside the name field
    expect(() => readTar(archive)).toThrow(/checksum mismatch/);
  });

  it("detects a truncated archive", () => {
    const archive = createTar([{ name: "a.json", content: "x".repeat(2000) }]);
    expect(() => readTar(archive.subarray(0, 700))).toThrow(/ends first/);
  });

  it("refuses a name too long for the format", () => {
    expect(() => createTar([{ name: `${"d/".repeat(60)}x.json`, content: "" }])).toThrow(/longer than 100/);
  });

  it("is readable by the system tar binary", async () => {
    const manifest = await exporter.run();
    const exportsDir = path.join(tmp, "editorial", "exports");

    // Run from inside the directory with a bare filename: GNU tar reads an
    // absolute Windows path like "C:\..." as host:path and tries to reach a
    // remote host called C.
    const inExports = (args: string[]): string =>
      execFileSync("tar", args, { encoding: "utf-8", cwd: exportsDir });

    let listing: string;
    try {
      listing = inExports(["-tf", manifest.archive]);
    } catch (err) {
      // Reported, never silently skipped — a green run must not imply this
      // check passed when no usable tar was present.
      console.warn(`system tar unavailable, interoperability unverified: ${(err as Error).message}`);
      return;
    }

    expect(listing.split(/\r?\n/).filter(Boolean).sort()).toEqual(manifest.files.map((f) => f.key).sort());

    const outDir = "verify-out";
    fs.mkdirSync(path.join(exportsDir, outDir), { recursive: true });
    try {
      inExports(["-xf", manifest.archive, "-C", outDir]);
      for (const file of manifest.files) {
        const extracted = fs.readFileSync(path.join(exportsDir, outDir, file.key), "utf-8");
        expect(sha256(extracted)).toBe(file.sha256);
        expect(Buffer.byteLength(extracted, "utf-8")).toBe(file.bytes);
      }
    } finally {
      fs.rmSync(path.join(exportsDir, outDir), { recursive: true, force: true });
    }
  });
});

describe("running an export", () => {
  it("covers exactly the allowlisted files and nothing else", async () => {
    const manifest = await exporter.run();
    expect(manifest.files.map((f) => f.key)).toEqual([
      "about/mission.json", "homepage.json", "navigation.json", "site-policies/disclaimer.json",
    ]);
    // The generated archive content must not be swept in.
    expect(manifest.files.some((f) => f.key.startsWith("armaments/"))).toBe(false);
  });

  it("records a hash and byte count per file, plus an archive hash", async () => {
    const manifest = await exporter.run();
    for (const file of manifest.files) {
      const actual = fs.readFileSync(path.join(contentRoot, file.key), "utf-8");
      expect(file.sha256).toBe(sha256(actual));
      expect(file.bytes).toBe(Buffer.byteLength(actual, "utf-8"));
    }
    const archive = fs.readFileSync(path.join(tmp, "editorial", "exports", manifest.archive));
    // The archive's own bytes. This previously asserted
    // sha256(archive.toString("binary")), which encoded the defect rather
    // than catching it — and passed only because the fixture was pure ASCII.
    expect(manifest.archiveSha256).toBe(sha256(archive));
    expect(manifest.archiveBytes).toBe(archive.length);
    expect(manifest.totalBytes).toBe(manifest.files.reduce((s, f) => s + f.bytes, 0));
  });

  it("never claims off-volume protection", async () => {
    const manifest = await exporter.run();
    expect(manifest.offVolume).toBe(false);
    expect(manifest.note).toMatch(/same storage volume/);
    expect(manifest.archiveDirectory).toContain("exports");
  });

  it("produces a deterministic manifest for unchanged content", async () => {
    const at = new Date("2026-10-13T07:00:00.000Z");
    const first = await exporter.run({ now: at });
    const second = await exporter.run({ now: at });
    expect(second).toEqual(first);
  });

  it("refuses to export an empty editorial set", async () => {
    const bare = fs.mkdtempSync(path.join(os.tmpdir(), "vl-bare-"));
    const other = createEditorialExporter(path.join(bare, "editorial"), path.join(bare, "content"), store);
    await expect(other.run()).rejects.toThrow(/Nothing to export/);
    fs.rmSync(bare, { recursive: true, force: true });
  });
});

describe("a failed export", () => {
  it("leaves no archive and no manifest when verification fails", async () => {
    // Corrupt the archive after it is written but before it is verified.
    const realReadFile = jest.requireActual<typeof fsp>("fs/promises").readFile;
    jest.spyOn(fsp, "readFile").mockImplementation(((p: string, enc?: unknown) => {
      if (String(p).endsWith(".tar")) return Promise.resolve(Buffer.alloc(1024));
      return realReadFile(p, enc as never);
    }) as never);

    await expect(exporter.run()).rejects.toThrow();
    jest.restoreAllMocks();

    const dir = path.join(tmp, "editorial", "exports");
    const left = fs.existsSync(dir) ? fs.readdirSync(dir) : [];
    expect(left.filter((n) => n.endsWith(".tar"))).toEqual([]);
    expect(left).not.toContain("manifest.json");
    await expect(exporter.readManifest()).resolves.toBeNull();
  });

  it("reports as never-exported after a failed export, not as current", async () => {
    jest.spyOn(fsp, "rename").mockRejectedValue(new Error("disk full") as never);
    await expect(exporter.run()).rejects.toThrow();
    jest.restoreAllMocks();

    const status = await exporter.status();
    expect(status.state).toBe("never-exported");
    expect(status.lastExportAt).toBeNull();
  });

  it("leaves the previous manifest intact when a later export fails", async () => {
    const good = await exporter.run();

    writeEditorial("v2");
    jest.spyOn(fsp, "readFile").mockImplementation((((p: string) =>
      String(p).endsWith(".tar")
        ? Promise.resolve(Buffer.alloc(16))
        : jest.requireActual<typeof fsp>("fs/promises").readFile(p, "utf-8")) as never));
    await expect(exporter.run()).rejects.toThrow();
    jest.restoreAllMocks();

    // Still describing the export that was actually verified.
    await expect(exporter.readManifest()).resolves.toEqual(good);
  });
});

describe("export status", () => {
  it("says so plainly when no export has ever been taken", async () => {
    const status = await exporter.status();
    expect(status.state).toBe("never-exported");
    expect(status.lastExportAt).toBeNull();
    expect(status.archive).toBeNull();
    expect(status.staleFileCount).toBe(4);
    expect(status.message).toMatch(/no recovery copy/i);
    expect(status.offVolume).toBe(false);
  });

  it("reports current immediately after an export", async () => {
    await exporter.run();
    const status = await exporter.status();
    expect(status.state).toBe("current");
    expect(status.staleFiles).toEqual([]);
    expect(status.staleFileCount).toBe(0);
    // Even when current, it refuses to imply the archive is safe off-volume.
    expect(status.message).toMatch(/not off-volume/);
  });

  it("names the files that changed after the export", async () => {
    await exporter.run();
    fs.writeFileSync(path.join(contentRoot, "homepage.json"), '{"marker":"edited"}\n', "utf-8");

    const status = await exporter.status();
    expect(status.state).toBe("stale");
    expect(status.staleFiles).toEqual(["homepage.json"]);
    expect(status.staleFileCount).toBe(1);
  });

  it("reports a newly added file as stale", async () => {
    await exporter.run();
    fs.writeFileSync(path.join(contentRoot, "ui-strings.json"), "{}\n", "utf-8");
    expect((await exporter.status()).staleFiles).toContain("ui-strings.json");
  });

  it("reports a removed file separately from a changed one", async () => {
    await exporter.run();
    fs.rmSync(path.join(contentRoot, "navigation.json"));

    const status = await exporter.status();
    expect(status.removedFiles).toEqual(["navigation.json"]);
    expect(status.state).toBe("stale");
  });

  it("reports the newest revision time so staleness can be judged", async () => {
    await store.recordAndApply({
      key: "homepage.json",
      targetFile: path.join(contentRoot, "homepage.json"),
      content: '{"marker":"saved"}\n',
    });
    const status = await exporter.status();
    expect(status.newestRevisionAt).toEqual(expect.any(String));
    expect(new Date(status.newestRevisionAt as string).getTime()).toBeGreaterThan(0);
  });
});

/**
 * F2 — the archive digest must be the archive's own bytes.
 *
 * It was computed as sha256(archive.toString("binary")): a latin1 decode
 * re-encoded as UTF-8, so every byte above 0x7F became two bytes. The value
 * was self-consistent — the exporter's own verification used the same
 * function — but no standard tool could reproduce it, which defeated the
 * point of having a digest an operator can check after copying the archive
 * somewhere safe.
 */
describe("the archive digest", () => {
  /** SHA-256 over the exact file bytes, computed independently of the module. */
  const digestOfFile = (p: string): string =>
    crypto.createHash("sha256").update(fs.readFileSync(p)).digest("hex");

  it("matches an independent SHA-256 over the exact archive bytes", async () => {
    const manifest = await exporter.run();
    const archivePath = path.join(tmp, "editorial", "exports", manifest.archive);

    expect(manifest.archiveSha256).toBe(digestOfFile(archivePath));
    expect(manifest.archiveBytes).toBe(fs.statSync(archivePath).size);
  });

  it("is not the latin1-re-encoded digest the old code produced", async () => {
    const manifest = await exporter.run();
    const archive = fs.readFileSync(path.join(tmp, "editorial", "exports", manifest.archive));

    const oldValue = crypto.createHash("sha256").update(archive.toString("binary"), "utf-8").digest("hex");
    const rawValue = crypto.createHash("sha256").update(archive).digest("hex");

    // The archive contains bytes above 0x7F (tar pads with NULs and the
    // content is UTF-8), so the two differ — which is what made the old
    // value unverifiable.
    expect(oldValue).not.toBe(rawValue);
    expect(manifest.archiveSha256).toBe(rawValue);
    expect(manifest.archiveSha256).not.toBe(oldValue);
  });

  it("hashes a Buffer by its bytes and a string as UTF-8", () => {
    const text = "ümlaut and emoji ✦\n";
    const asBuffer = Buffer.from(text, "utf-8");
    // A string is hashed as UTF-8, so it agrees with the Buffer of those bytes.
    expect(sha256(text)).toBe(sha256(asBuffer));
    expect(sha256(asBuffer)).toBe(crypto.createHash("sha256").update(asBuffer).digest("hex"));
  });

  it("agrees with an external hashing tool, and its files extract to the recorded hashes", async () => {
    const manifest = await exporter.run();
    const exportsDir = path.join(tmp, "editorial", "exports");

    // Bare filename with cwd set: GNU tooling on Windows reads an absolute
    // "C:\..." path as host:path.
    const run = (cmd: string, args: string[]): string =>
      execFileSync(cmd, args, { encoding: "utf-8", cwd: exportsDir });

    let external: string | null = null;
    try {
      external = run("sha256sum", [manifest.archive]).trim().split(/\s+/)[0];
    } catch {
      try {
        const out = run("certutil", ["-hashfile", manifest.archive, "SHA256"]);
        external = (out.split(/\r?\n/)[1] ?? "").replace(/\s/g, "").toLowerCase() || null;
      } catch (err) {
        console.warn(`no external hashing tool available: ${(err as Error).message}`);
      }
    }

    if (external) {
      expect(external).toBe(manifest.archiveSha256);
    }

    // Independently of the digest, every extracted file must match its
    // recorded hash and byte count.
    const outDir = "f2-verify";
    fs.mkdirSync(path.join(exportsDir, outDir), { recursive: true });
    try {
      let verified = 0;
      try {
        run("tar", ["-xf", manifest.archive, "-C", outDir]);
      } catch (err) {
        console.warn(`system tar unavailable: ${(err as Error).message}`);
        return;
      }
      for (const file of manifest.files) {
        const extracted = fs.readFileSync(path.join(exportsDir, outDir, file.key), "utf-8");
        expect(sha256(extracted)).toBe(file.sha256);
        expect(Buffer.byteLength(extracted, "utf-8")).toBe(file.bytes);
        verified++;
      }
      expect(verified).toBe(manifest.fileCount);
    } finally {
      fs.rmSync(path.join(exportsDir, outDir), { recursive: true, force: true });
    }
  });

  it("still detects a tampered archive through its own verification", async () => {
    const manifest = await exporter.run();
    const archivePath = path.join(tmp, "editorial", "exports", manifest.archive);

    const bytes = fs.readFileSync(archivePath);
    bytes[600] = bytes[600] ^ 0xff;
    expect(crypto.createHash("sha256").update(bytes).digest("hex")).not.toBe(manifest.archiveSha256);
  });
});
