import fs from "fs";
import fsp from "fs/promises";
import os from "os";
import path from "path";
import {
  readForSnapshot,
  UnreadableFileError,
  applyFileChangesAtomically,
  promoteFilesAtomically,
  restoreFromSnapshot,
  AtomicApplyError,
  PromotionSnapshot,
} from "../promote-atomic";
import { restoreAndVerify } from "../promotion.service";

/**
 * R8-1 — a snapshot may only say "absent" when the filesystem says ENOENT.
 *
 * In a snapshot, `null` is not "unknown". It is an instruction: this file
 * did not exist, so restoring it means deleting it. The capture used to map
 * *every* read failure to `null`, so a transient EACCES, EBUSY, EIO or
 * EMFILE against a file that was plainly there became a recorded deletion —
 * which the compensating reversal then carried out, reporting a clean,
 * fully-successful restore while the file was gone. Verification agreed,
 * because it compared `null` against a read that failed the same way.
 *
 * Everything here runs against throwaway directories. PROMOTION_ENABLED
 * stays false; promote() and rollback() are not executed.
 */

let tmp: string;

const write = (rel: string, content: string): void => {
  const p = path.join(tmp, rel);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, content, "utf-8");
};
const read = (rel: string): string | null => {
  try { return fs.readFileSync(path.join(tmp, rel), "utf-8"); } catch { return null; }
};
const exists = (rel: string): boolean => fs.existsSync(path.join(tmp, rel));

/**
 * Makes one path fail to read with a chosen errno, leaving the file itself
 * untouched on disk. This is the shape of a locked file, a permission
 * change, or a descriptor-table exhaustion part-way through a batch.
 */
function makeUnreadable(match: string, code: string, message = `${code}: simulated`): void {
  makeUnreadableAfter(match, code, 0, message);
}

/**
 * Lets the first `okReads` reads of a path succeed and fails every one
 * after. Used to put the fault *between* a restore and its verification —
 * a file locked in that window is readable when written and unreadable
 * when checked, which is the only way the verification loop sees one.
 */
function makeUnreadableAfter(
  match: string,
  code: string,
  okReads: number,
  message = `${code}: simulated`,
): void {
  const realReadFile = jest.requireActual<typeof fsp>("fs/promises").readFile;
  let seen = 0;
  jest.spyOn(fsp, "readFile").mockImplementation(((p: string, enc: unknown) => {
    if (String(p).endsWith(match)) {
      seen++;
      if (seen > okReads) {
        const err = new Error(message) as NodeJS.ErrnoException;
        err.code = code;
        return Promise.reject(err);
      }
    }
    return realReadFile(p as never, enc as never);
  }) as never);
}

beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "vl-snap-"));
});
afterEach(() => {
  jest.restoreAllMocks();
  fs.rmSync(tmp, { recursive: true, force: true });
});

describe("why null is dangerous — the premise these tests rest on", () => {
  it("a null snapshot entry really does delete a present file", () => {
    // Not a hypothetical: this is what a mis-recorded capture instructs.
    write("present.json", "REAL CONTENT");
    return restoreFromSnapshot(tmp, { "present.json": null }).then(() => {
      expect(exists("present.json")).toBe(false);
    });
  });
});

describe("readForSnapshot — only ENOENT means absent", () => {
  it("returns the content of a readable file", async () => {
    write("a.json", "CONTENT A");
    await expect(readForSnapshot(path.join(tmp, "a.json"), "a.json")).resolves.toBe("CONTENT A");
  });

  it("returns null for a file that is genuinely not there", async () => {
    await expect(readForSnapshot(path.join(tmp, "missing.json"), "missing.json")).resolves.toBeNull();
  });

  it("returns null for a file in a directory that does not exist yet", async () => {
    // The ordinary new-record case in a promotion: Node reports ENOENT for
    // any missing path component, so this must stay absent, not abort.
    await expect(readForSnapshot(path.join(tmp, "naval", "romania.json"), "naval/romania.json"))
      .resolves.toBeNull();
  });

  it.each([
    ["EACCES", "permission denied"],
    ["EBUSY", "resource busy or locked"],
    ["EIO", "i/o error"],
    ["EMFILE", "too many open files"],
    ["EPERM", "operation not permitted"],
    ["ENOTDIR", "not a directory"],
    ["EISDIR", "illegal operation on a directory"],
  ])("throws rather than returning null on %s", async (code, message) => {
    write("locked.json", "STILL HERE");
    makeUnreadable("locked.json", code, `${code}: ${message}`);

    const err = await readForSnapshot(path.join(tmp, "locked.json"), "locked.json")
      .then(() => null, (e: unknown) => e);

    expect((err as Error)?.name).toBe("UnreadableFileError");
    expect((err as UnreadableFileError).code).toBe(code);
    expect((err as UnreadableFileError).path).toBe("locked.json");
    // The original error survives for diagnosis — code and message both.
    expect((err as UnreadableFileError).originalError.message).toContain(message);
    expect((err as Error).message).toContain(code);
    expect((err as Error).message).toContain("locked.json");
  });

  it("throws for a real directory sitting at a file's path, with no mocking", async () => {
    // An unmocked, genuine filesystem condition rather than an injected code.
    fs.mkdirSync(path.join(tmp, "dir.json"));
    const err = await readForSnapshot(path.join(tmp, "dir.json"), "dir.json")
      .then(() => null, (e: unknown) => e);

    expect((err as Error)?.name).toBe("UnreadableFileError");
    expect((err as UnreadableFileError).code).toBeDefined();
  });

  it("explains why it refused, not just that it did", async () => {
    write("locked.json", "STILL HERE");
    makeUnreadable("locked.json", "EACCES");
    const err = await readForSnapshot(path.join(tmp, "locked.json"), "locked.json")
      .then(() => null, (e: unknown) => e as Error);

    expect(err?.message).toMatch(/recording a deletion of a file that may be present/);
    expect(err?.message).toMatch(/nothing was written/);
  });
});

describe("the publication write path aborts before writing anything", () => {
  it("a promotion refuses when one target is present but unreadable", async () => {
    write("naval/germany.json", "ORIGINAL GERMANY");
    write("naval/italy.json", "ORIGINAL ITALY");
    write("index.json", "ORIGINAL INDEX");
    makeUnreadable("italy.json", "EBUSY");

    const err = await promoteFilesAtomically(tmp, new Map([
      ["naval/germany.json", "NEW GERMANY"],
      ["naval/italy.json", "NEW ITALY"],
      ["index.json", "NEW INDEX"],
    ])).then(() => null, (e: unknown) => e);

    expect((err as Error)?.name).toBe("UnreadableFileError");
    // Not an AtomicApplyError: that type means "writes happened and were
    // reversed", which would be the wrong story entirely.
    expect(err).not.toBeInstanceOf(AtomicApplyError);

    // The unreadable file is still there, with its original bytes.
    jest.restoreAllMocks();
    expect(read("naval/italy.json")).toBe("ORIGINAL ITALY");
    // And nothing else moved, including the file listed before it.
    expect(read("naval/germany.json")).toBe("ORIGINAL GERMANY");
    expect(read("index.json")).toBe("ORIGINAL INDEX");
    expect(fs.readdirSync(path.join(tmp, "naval")).sort()).toEqual(["germany.json", "italy.json"]);
  });

  it("leaves no temporary files behind", async () => {
    write("a.json", "ORIGINAL A");
    makeUnreadable("a.json", "EIO");

    await expect(applyFileChangesAtomically(tmp, new Map([["a.json", "NEW A"]]))).rejects.toThrow();

    jest.restoreAllMocks();
    expect(fs.readdirSync(tmp)).toEqual(["a.json"]);
  });

  it("still promotes normally when the only unreadable path is genuinely absent", async () => {
    write("naval/germany.json", "ORIGINAL");
    const { promoted, snapshot } = await promoteFilesAtomically(tmp, new Map([
      ["naval/germany.json", "NEW"],
      ["naval/romania.json", "BRAND NEW"],
    ]));

    expect(promoted.sort()).toEqual(["naval/germany.json", "naval/romania.json"]);
    // Absence is still recorded as null — the representation is unchanged.
    expect(snapshot["naval/romania.json"]).toBeNull();
    expect(snapshot["naval/germany.json"]).toBe("ORIGINAL");
    expect(read("naval/romania.json")).toBe("BRAND NEW");
  });
});

describe("the rollback write path aborts before writing anything", () => {
  // restoreFromSnapshot is the call rollback() makes to apply a manifest;
  // exercising it directly is exercising that path, with promotion disabled.
  it("refuses when a file the manifest covers is present but unreadable", async () => {
    write("naval/germany.json", "LIVE GERMANY");
    write("naval/italy.json", "LIVE ITALY");
    makeUnreadable("germany.json", "EACCES");

    const manifest: PromotionSnapshot = {
      "naval/germany.json": "ARCHIVED GERMANY",
      "naval/italy.json": "ARCHIVED ITALY",
    };
    const err = await restoreFromSnapshot(tmp, manifest).then(() => null, (e: unknown) => e);

    expect((err as Error)?.name).toBe("UnreadableFileError");
    expect((err as UnreadableFileError).path).toBe("naval/germany.json");

    jest.restoreAllMocks();
    // Neither file was touched: the rollback did not half-apply.
    expect(read("naval/germany.json")).toBe("LIVE GERMANY");
    expect(read("naval/italy.json")).toBe("LIVE ITALY");
  });

  it("refuses a manifest whose null entry would delete an unreadable file", async () => {
    // The exact loss case: the manifest says "this did not exist before",
    // the live file is present but unreadable, and the old capture would
    // have agreed with the deletion rather than questioning it.
    write("naval/romania.json", "PRESENT AND IMPORTANT");
    makeUnreadable("romania.json", "EMFILE");

    await expect(restoreFromSnapshot(tmp, { "naval/romania.json": null })).rejects.toThrow(
      /Cannot snapshot/,
    );

    jest.restoreAllMocks();
    expect(exists("naval/romania.json")).toBe(true);
    expect(read("naval/romania.json")).toBe("PRESENT AND IMPORTANT");
  });

  it("still deletes a file the manifest says was absent, when it can read it", async () => {
    // The legitimate deletion must keep working — this is not a blanket
    // refusal to delete.
    write("naval/romania.json", "ADDED BY THE PROMOTION");
    const { restored } = await restoreFromSnapshot(tmp, { "naval/romania.json": null });

    expect(restored).toEqual(["naval/romania.json"]);
    expect(exists("naval/romania.json")).toBe(false);
  });
});

describe("restoration is never reported as verified on a read it could not make", () => {
  it("refuses outright when the file is unreadable before the restore", async () => {
    // The loudest outcome, and the right one: the restore does not run at
    // all, and the specific errno travels with the failure.
    write("gone.json", "ACTUALLY STILL HERE");
    makeUnreadable("gone.json", "EACCES", "EACCES: permission denied");

    const result = await restoreAndVerify(tmp, { "gone.json": null });

    expect(result.outcome).toBe("failed");
    expect(result.error?.name).toBe("UnreadableFileError");
    expect(result.error?.message).toContain("EACCES");
    expect(result.error?.message).toContain("gone.json");

    jest.restoreAllMocks();
    expect(read("gone.json")).toBe("ACTUALLY STILL HERE");
  });

  it("counts a file locked between the restore and the check as unverified", async () => {
    // Expected null, actual unreadable. The old comparison read
    // null === null and reported "verified" — a restoration that was never
    // established, presented as proven.
    write("gone.json", "ACTUALLY STILL HERE");
    makeUnreadableAfter("gone.json", "EBUSY", 1); // readable for the restore, not for the check

    const result = await restoreAndVerify(tmp, { "gone.json": null });

    expect(result.outcome).toBe("failed");
    expect(result.mismatched).toEqual(["gone.json"]);
    expect(result.error).toBeUndefined(); // the restore itself did not throw
  });

  it("counts it as unverified against expected content too", async () => {
    write("a.json", "EXPECTED");
    makeUnreadableAfter("a.json", "EIO", 1);

    const result = await restoreAndVerify(tmp, { "a.json": "EXPECTED" });

    expect(result.outcome).toBe("failed");
    expect(result.mismatched).toEqual(["a.json"]);
  });

  it("still verifies a genuine absence", async () => {
    const result = await restoreAndVerify(tmp, { "never-existed.json": null });
    expect(result.outcome).toBe("verified");
    expect(result.mismatched).toEqual([]);
  });

  it("still verifies a restore that genuinely landed", async () => {
    write("a.json", "ORIGINAL A");
    write("b.json", "WRONG B");

    const result = await restoreAndVerify(tmp, { "a.json": "ORIGINAL A", "b.json": "RIGHT B" });

    expect(result.outcome).toBe("verified");
    expect(result.mismatched).toEqual([]);
    expect(read("b.json")).toBe("RIGHT B");
  });

  it("still reports a genuine mismatch when the restore silently did nothing", async () => {
    write("b.json", "WRONG B");
    const realRename = jest.requireActual<typeof fsp>("fs/promises").rename;
    jest.spyOn(fsp, "rename").mockImplementation(((from: string, to: string) => {
      if (String(to).endsWith("b.json")) return Promise.resolve(); // pretends to work
      return realRename(from, String(to));
    }) as never);

    const result = await restoreAndVerify(tmp, { "b.json": "RIGHT B" });

    expect(result.outcome).toBe("failed");
    expect(result.mismatched).toEqual(["b.json"]);
    expect(result.error).toBeUndefined();
  });

  it("reports the unverified path in its portable form", async () => {
    write("naval/germany.json", "X");
    makeUnreadableAfter("germany.json", "EBUSY", 1);
    // A legacy manifest keys this with a backslash; the report must not.
    const result = await restoreAndVerify(tmp, { "naval\\germany.json": null } as PromotionSnapshot);
    expect(result.mismatched).toEqual(["naval/germany.json"]);
  });
});

describe("the capture and the rollback call site use this", () => {
  const source = fs.readFileSync(path.resolve(__dirname, "../promotion.service.ts"), "utf-8");

  it("captureCurrentState reads through the shared helper, not its own catch", () => {
    const fn = source.slice(
      source.indexOf("async function captureCurrentState("),
      source.indexOf("async function captureAndActivateVersion("),
    );
    expect(fn).toContain("await readForSnapshot(");
    // The bare catch that produced the null is gone.
    expect(fn).not.toMatch(/catch\s*\{\s*\n?\s*out\[normalized\] = null/);
  });

  it("rollback reports a capture failure as a failure before any write", () => {
    const body = source.slice(
      source.indexOf("private async rollbackLocked("),
      source.indexOf("completeAfterActivation({", source.indexOf("private async rollbackLocked(")),
    );
    expect(body).toContain("beforeRollback = await captureCurrentState(targetDir, snapshot);");
    expect(body).toContain('abortBeforeAnyWrite("content", err as Error, targetDir);');
    // The capture is attempted before the restore that is the first write.
    expect(body.indexOf("captureCurrentState")).toBeLessThan(body.indexOf("restoreFromSnapshot"));
  });

  it("verification no longer treats an unreadable file as absent", () => {
    // The comparison loop now lives in verifyAgainstSnapshot, which
    // restoreAndVerify delegates to — so the rule is asserted where it is
    // implemented, and restoreAndVerify is asserted to use it.
    const fn = source.slice(
      source.indexOf("export async function verifyAgainstSnapshot("),
      source.indexOf("export async function abortBeforeActivation("),
    );
    expect(fn).toContain("await readForSnapshot(");
    expect(fn).not.toMatch(/catch\s*\{\s*\n?\s*actual = null;/);
    expect(fn).toContain("await verifyAgainstSnapshot(baseDir, snapshot)");
  });
});
