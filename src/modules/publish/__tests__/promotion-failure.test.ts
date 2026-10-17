import fs from "fs";
import fsp from "fs/promises";
import os from "os";
import path from "path";
import {
  PromotionAbortedError,
  abortBeforeActivation,
  abortBeforeAnyWrite,
  completeAfterActivation,
  restoreAndVerify,
} from "../promotion.service";
import { AtomicApplyError, applyFileChangesAtomically, PromotionSnapshot } from "../promote-atomic";

/**
 * R1 and R2 — promotion reliability.
 *
 * R1: the compensating restore used to be `.catch(() => undefined)`, so a
 * failed restore was invisible. The caller saw only the original error and
 * would reasonably conclude nothing had changed, while public/data could be
 * left part-promoted.
 *
 * R2: the snapshot manifest — the only thing that makes a promotion
 * reversible — used to be written *after* the active-version pointer flipped.
 * A failure there left content live and permanently unrollbackable while the
 * caller was handed an error and would assume the promotion had failed.
 *
 * Everything here runs against throwaway directories with injected faults.
 * PROMOTION_ENABLED stays false and no promotion is performed.
 */

let tmp: string;

beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "vl-promo-fail-"));
});
afterEach(() => {
  jest.restoreAllMocks();
  fs.rmSync(tmp, { recursive: true, force: true });
});

const write = (rel: string, content: string): void => {
  const p = path.join(tmp, rel);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, content, "utf-8");
};
const read = (rel: string): string | null => {
  try { return fs.readFileSync(path.join(tmp, rel), "utf-8"); } catch { return null; }
};

/** Makes the rename that completes a restore a silent no-op. */
function breakRestoreSilently(match: string): void {
  const realRename = jest.requireActual<typeof fsp>("fs/promises").rename;
  jest.spyOn(fsp, "rename").mockImplementation(((from: string, to: string) => {
    if (String(to).includes(match)) return Promise.resolve(); // pretends to work
    return realRename(from, to);
  }) as never);
}

describe("R1 — restoration is verified, not assumed", () => {
  it("reports verified when every file really is back", async () => {
    write("a.json", "ORIGINAL A");
    write("b.json", "ORIGINAL B");
    const snapshot: PromotionSnapshot = { "a.json": "ORIGINAL A", "b.json": "ORIGINAL B" };

    // Simulate a promotion having overwritten both.
    write("a.json", "PROMOTED A");
    write("b.json", "PROMOTED B");

    const result = await restoreAndVerify(tmp, snapshot);
    expect(result.outcome).toBe("verified");
    expect(result.mismatched).toEqual([]);
    expect(read("a.json")).toBe("ORIGINAL A");
    expect(read("b.json")).toBe("ORIGINAL B");
  });

  it("verifies a null entry by the file being absent again", async () => {
    // null means "did not exist before", so restoring it means deleting it.
    const snapshot: PromotionSnapshot = { "new.json": null };
    write("new.json", "CREATED BY THE PROMOTION");

    const result = await restoreAndVerify(tmp, snapshot);
    expect(result.outcome).toBe("verified");
    expect(read("new.json")).toBeNull();
  });

  it("reports failed, with the error, when the restore itself throws", async () => {
    write("a.json", "PROMOTED");
    jest.spyOn(fsp, "rename").mockRejectedValue(new Error("disk went away") as never);

    const result = await restoreAndVerify(tmp, { "a.json": "ORIGINAL" });
    expect(result.outcome).toBe("failed");
    // The complete message: the write failure, plus the reversal summary F2
    // adds on the way out through restoreFromSnapshot. Nothing was applied
    // before the failure, so there was nothing to reverse.
    expect(result.error?.message).toBe(
      "disk went away — All 0 change(s) already applied were reversed.",
    );
    // And it did not pretend the file was restored.
    expect(read("a.json")).toBe("PROMOTED");
  });

  it("reports failed when a restore claims success but the bytes disagree", async () => {
    write("a.json", "ORIGINAL");
    write("b.json", "ORIGINAL");
    const snapshot: PromotionSnapshot = { "a.json": "ORIGINAL", "b.json": "ORIGINAL" };
    write("a.json", "PROMOTED");
    write("b.json", "PROMOTED");

    // The restore completes without error but silently does nothing to a.json.
    breakRestoreSilently("a.json");

    const result = await restoreAndVerify(tmp, snapshot);
    expect(result.outcome).toBe("failed");
    expect(result.error).toBeUndefined(); // nothing threw — that is the point
    expect(result.mismatched).toEqual(["a.json"]);
    expect(read("a.json")).toBe("PROMOTED"); // genuinely still wrong
    expect(read("b.json")).toBe("ORIGINAL");
  });

  it("detects a null entry that was not actually deleted", async () => {
    write("new.json", "STILL HERE");
    // A null entry is restored by deleting the file, so the silent no-op has
    // to be injected on rm rather than on rename.
    jest.spyOn(fsp, "rm").mockResolvedValue(undefined as never);

    const result = await restoreAndVerify(tmp, { "new.json": null });
    expect(result.outcome).toBe("failed");
    expect(result.mismatched).toEqual(["new.json"]);
    expect(read("new.json")).toBe("STILL HERE"); // genuinely still present
  });
});

describe("R1 — both errors stay observable", () => {
  const original = new Error("index regeneration blew up");

  it("preserves the original error and says restoration was verified", async () => {
    write("a.json", "ORIGINAL");
    write("a.json", "PROMOTED");

    const err: unknown = await abortBeforeActivation("index", original, tmp, { "a.json": "ORIGINAL" })
      .catch((e) => e);

    expect(err).toBeInstanceOf(PromotionAbortedError);
    const aborted = err as PromotionAbortedError;
    expect(aborted.stage).toBe("index");
    expect(aborted.originalError).toBe(original);
    expect(aborted.restoration).toBe("verified");
    expect(aborted.restorationError).toBeUndefined();
    expect(aborted.requiresManualVerification).toBe(false);
    // Both facts are legible in the message.
    expect(aborted.message).toContain("index regeneration blew up");
    expect(aborted.message).toMatch(/restored\s+and verified/);
    expect(aborted.message).not.toMatch(/MANUAL VERIFICATION/);
  });

  it("keeps both errors when the restore throws, and demands manual checking", async () => {
    write("a.json", "PROMOTED");
    jest.spyOn(fsp, "rename").mockRejectedValue(new Error("EIO on restore") as never);

    const err: unknown = await abortBeforeActivation("activation", original, tmp, { "a.json": "ORIGINAL" })
      .catch((e) => e);

    const aborted = err as PromotionAbortedError;
    expect(aborted.stage).toBe("activation");
    // (a) the original failure
    expect(aborted.originalError).toBe(original);
    expect(aborted.message).toContain("index regeneration blew up");
    // (b)/(c) restoration failed, and that is stated
    expect(aborted.restoration).toBe("failed");
    expect(aborted.restorationError?.message).toBe(
      "EIO on restore — All 0 change(s) already applied were reversed.",
    );
    expect(aborted.message).toContain("EIO on restore");
    expect(aborted.message).toMatch(/RESTORATION ALSO FAILED/);
    expect(aborted.message).toMatch(/REQUIRES\s+MANUAL VERIFICATION/);
    expect(aborted.requiresManualVerification).toBe(true);
  });

  it("names the unverified files when a restore silently does nothing", async () => {
    write("a.json", "ORIGINAL");
    write("a.json", "PROMOTED");
    breakRestoreSilently("a.json");

    const err: unknown = await abortBeforeActivation("recovery-metadata", original, tmp, { "a.json": "ORIGINAL" })
      .catch((e) => e);

    const aborted = err as PromotionAbortedError;
    expect(aborted.restoration).toBe("failed");
    expect(aborted.unverifiedPaths).toEqual(["a.json"]);
    expect(aborted.message).toMatch(/RESTORATION COULD NOT BE VERIFIED/);
    expect(aborted.message).toContain("a.json");
    expect(aborted.message).toMatch(/REQUIRES\s+MANUAL VERIFICATION/);
    expect(aborted.requiresManualVerification).toBe(true);
  });

  it("never claims restoration succeeded when it did not", async () => {
    write("a.json", "PROMOTED");
    breakRestoreSilently("a.json");

    const err: unknown = await abortBeforeActivation("content", original, tmp, { "a.json": "ORIGINAL" })
      .catch((e) => e);
    const message = (err as PromotionAbortedError).message;

    // The reassuring wording must be absent entirely.
    expect(message).not.toMatch(/restored\s+and verified/);
    expect(message).not.toMatch(/as it was before/);
  });

  it.each(["content", "index", "recovery-metadata", "activation"] as const)(
    "records the %s stage it aborted at", async (stage) => {
      write("a.json", "ORIGINAL");
      const err: unknown = await abortBeforeActivation(stage, original, tmp, { "a.json": "ORIGINAL" })
        .catch((e) => e);
      expect((err as PromotionAbortedError).stage).toBe(stage);
      expect((err as PromotionAbortedError).message).toContain(stage);
    });

  it("always throws — it is never a silent compensation", async () => {
    write("a.json", "ORIGINAL");
    await expect(
      abortBeforeActivation("index", original, tmp, { "a.json": "ORIGINAL" }),
    ).rejects.toBeInstanceOf(PromotionAbortedError);
  });
});

describe("R2 — failures after activation do not deny the activation", () => {
  const ok = () => Promise.resolve();
  const boom = (m: string) => () => Promise.reject(new Error(m));

  it("reports a clean success when both housekeeping steps work", async () => {
    const out = await completeAfterActivation({ runId: "r1", recoveryMetadata: "persisted", prune: ok, recordHistory: ok });
    expect(out.status).toBe("success");
    expect(out.warnings).toEqual([]);
    expect(out.steps).toEqual({
      contentApplied: true,
      recoveryMetadata: "persisted",
      activation: "activated",
      history: "recorded",
      cleanup: "completed",
    });
  });

  it("still reports the content as active when pruning fails", async () => {
    const out = await completeAfterActivation({ runId: "r1", recoveryMetadata: "persisted", prune: boom("prune exploded"), recordHistory: ok });

    expect(out.status).toBe("activated-with-warnings");
    expect(out.steps.activation).toBe("activated");
    expect(out.steps.contentApplied).toBe(true);
    expect(out.steps.cleanup).toBe("failed");
    expect(out.steps.history).toBe("recorded");
    expect(out.warnings).toHaveLength(1);
    expect(out.warnings[0]).toContain("prune exploded");
    expect(out.warnings[0]).toMatch(/content is live/);
  });

  it("still reports the content as active when history logging fails, and says where the snapshot is", async () => {
    const out = await completeAfterActivation({
      runId: "run-abc", recoveryMetadata: "persisted", prune: ok, recordHistory: boom("audit row rejected"),
    });

    expect(out.status).toBe("activated-with-warnings");
    expect(out.steps.activation).toBe("activated");
    expect(out.steps.history).toBe("failed");
    expect(out.steps.cleanup).toBe("completed");
    expect(out.warnings[0]).toContain("audit row rejected");
    // Recovery is still possible, and the caller is told how.
    expect(out.warnings[0]).toContain("run-abc");
    expect(out.warnings[0]).toMatch(/rollback snapshot/);
  });

  it("reports both failures rather than stopping at the first", async () => {
    const out = await completeAfterActivation({
      runId: "r1", recoveryMetadata: "persisted", prune: boom("prune exploded"), recordHistory: boom("history exploded"),
    });

    expect(out.warnings).toHaveLength(2);
    expect(out.warnings.join(" ")).toContain("prune exploded");
    expect(out.warnings.join(" ")).toContain("history exploded");
    expect(out.steps.cleanup).toBe("failed");
    expect(out.steps.history).toBe("failed");
    // The activation itself is still reported truthfully.
    expect(out.steps.activation).toBe("activated");
    expect(out.status).toBe("activated-with-warnings");
  });

  it("never throws, however badly housekeeping fails", async () => {
    await expect(
      completeAfterActivation({ runId: "r1", recoveryMetadata: "persisted", prune: boom("a"), recordHistory: boom("b") }),
    ).resolves.toBeDefined();
  });

  it("never reports a bare success when anything went wrong", async () => {
    for (const [prune, history] of [
      [boom("x"), ok], [ok, boom("y")], [boom("x"), boom("y")],
    ] as const) {
      const out = await completeAfterActivation({ runId: "r1", recoveryMetadata: "persisted", prune, recordHistory: history });
      expect(out.status).not.toBe("success");
      expect(out.warnings.length).toBeGreaterThan(0);
    }
  });
});

describe("R2 — ordering guarantees in the promotion source", () => {
  // A source-order guard rather than a behavioural one: promote() cannot be
  // executed while PROMOTION_ENABLED is false, and this is precisely the
  // ordering defect R2 describes, so it is worth a regression test of its own.
  const source = fs.readFileSync(path.resolve(__dirname, "../promotion.service.ts"), "utf-8");
  const promoteBody = source.slice(
    source.indexOf("async promote("),
    source.indexOf("async rollback("),
  );

  it("isolates promote() for inspection", () => {
    expect(promoteBody).toContain("persistSnapshotManifest");
    expect(promoteBody).toContain("captureAndActivateVersion");
  });

  it("persists the rollback snapshot BEFORE activating", () => {
    const manifestAt = promoteBody.indexOf("persistSnapshotManifest(type, runId");
    const activateAt = promoteBody.indexOf("captureAndActivateVersion()");
    expect(manifestAt).toBeGreaterThan(-1);
    expect(activateAt).toBeGreaterThan(-1);
    expect(manifestAt).toBeLessThan(activateAt);
  });

  it("does housekeeping only after activation", () => {
    const activateAt = promoteBody.indexOf("captureAndActivateVersion()");
    expect(promoteBody.indexOf("completeAfterActivation")).toBeGreaterThan(activateAt);
  });

  it("no longer swallows any restoration failure anywhere in the module", () => {
    expect(source).not.toContain("restoreFromSnapshot(targetDir, fullSnapshot).catch(() => undefined)");
    expect(source).not.toContain("restoreFromSnapshot(targetDir, beforeRollback).catch(() => undefined)");
    // Every compensation now goes through the reporting path.
    expect(source.match(/abortBeforeActivation\(/g)?.length).toBeGreaterThanOrEqual(5);
  });

  it("leaves PROMOTION_ENABLED false", () => {
    expect(source).toContain("const PROMOTION_ENABLED = false;");
  });
});

describe("F4 — recoveryMetadata tells the truth per operation", () => {
  const ok = () => Promise.resolve();
  const boom = (m: string) => () => Promise.reject(new Error(m));

  it("reports persisted for a promotion, which writes its own snapshot", async () => {
    const out = await completeAfterActivation({
      runId: "r1", recoveryMetadata: "persisted", prune: ok, recordHistory: ok,
    });
    expect(out.steps.recoveryMetadata).toBe("persisted");
  });

  it("reports not-applicable for a rollback, which writes none", async () => {
    // A rollback restores FROM an existing manifest. Calling that "persisted"
    // would describe a source snapshot as a newly written rollback snapshot.
    const out = await completeAfterActivation({
      runId: "r1", recoveryMetadata: "not-applicable", prune: ok, recordHistory: ok,
    });
    expect(out.steps.recoveryMetadata).toBe("not-applicable");
    expect(out.status).toBe("success"); // not-applicable is not a failure
  });

  it("does not promise a rollback snapshot in the history warning when there is none", async () => {
    const promoted = await completeAfterActivation({
      runId: "run-1", recoveryMetadata: "persisted", prune: ok, recordHistory: boom("db down"),
    });
    expect(promoted.warnings[0]).toContain("rollback snapshot is stored under runId run-1");

    const rolledBack = await completeAfterActivation({
      runId: "run-2", recoveryMetadata: "not-applicable", prune: ok, recordHistory: boom("db down"),
    });
    expect(rolledBack.warnings[0]).not.toContain("rollback snapshot is stored");
    expect(rolledBack.warnings[0]).toContain("wrote no rollback snapshot of its own");
  });

  it("passes the value through unchanged when housekeeping fails", async () => {
    const out = await completeAfterActivation({
      runId: "r1", recoveryMetadata: "not-applicable", prune: boom("x"), recordHistory: boom("y"),
    });
    expect(out.steps.recoveryMetadata).toBe("not-applicable");
    expect(out.status).toBe("activated-with-warnings");
  });

  it("the service passes persisted for both, because both now write one", () => {
    // Source-level, because neither method can be executed while
    // PROMOTION_ENABLED is false.
    //
    // CHANGED BY R8 STAGE 3. Until then a rollback genuinely wrote no
    // snapshot of its own and "not-applicable" was the truthful answer. It
    // now writes a durable, checksummed pre-rollback recovery point before
    // its first destructive write, under its own runId. Reporting "none
    // written" would tell an operator recovery is impossible while the
    // artefact to recover from sits on disk — which is the same class of
    // false report F4 was raised to fix, in the opposite direction.
    const source = fs.readFileSync(path.resolve(__dirname, "../promotion.service.ts"), "utf-8");
    const promoteBody = source.slice(source.indexOf("async promote("), source.indexOf("async rollback("));
    const rollbackBody = source.slice(source.indexOf("async rollback("));

    expect(promoteBody).toContain('recoveryMetadata: "persisted"');
    expect(promoteBody).not.toContain('recoveryMetadata: "not-applicable"');
    expect(rollbackBody).toContain('recoveryMetadata: "persisted"');
    expect(rollbackBody).not.toContain('recoveryMetadata: "not-applicable"');

    // And the claim is earned: the rollback really does persist one, before
    // it writes anything.
    expect(rollbackBody.indexOf("writeRecoveryPoint"))
      .toBeLessThan(rollbackBody.indexOf("restoreFromSnapshot"));
  });

  it("completeAfterActivation still honours not-applicable if it is given it", () => {
    // The value stays part of the contract even though no caller passes it
    // today, so the renderer and the type keep meaning what they say.
    return completeAfterActivation({
      runId: "r1", recoveryMetadata: "not-applicable", prune: ok, recordHistory: ok,
    }).then((out) => {
      expect(out.steps.recoveryMetadata).toBe("not-applicable");
    });
  });
});

describe("F1 — the file-application boundary is guarded", () => {
  it("routes an AtomicApplyError through the structured failure path", () => {
    const source = fs.readFileSync(path.resolve(__dirname, "../promotion.service.ts"), "utf-8");
    const promoteBody = source.slice(source.indexOf("async promote("), source.indexOf("async rollback("));

    // promoteFilesAtomically is inside a try that aborts on the content stage.
    const applyAt = promoteBody.indexOf("promoteFilesAtomically(targetDir, staged)");
    const abortAt = promoteBody.indexOf('abortBeforeActivation(\n          "content"');
    expect(applyAt).toBeGreaterThan(-1);
    expect(promoteBody.slice(applyAt)).toContain("AtomicApplyError");
    expect(abortAt === -1 ? promoteBody.indexOf('"content"') : abortAt).toBeGreaterThan(applyAt);
  });

  it("never verifies an empty snapshot as proof the directory is intact", () => {
    // D1: the no-write case is now its own named abort, reporting
    // not-attempted without inventing a verification it could not perform —
    // and without the manual-verification demand it does not warrant.
    const source = fs.readFileSync(path.resolve(__dirname, "../promotion.service.ts"), "utf-8");
    const helper = source.slice(source.indexOf("export function abortBeforeAnyWrite("));
    expect(helper).toContain('"not-attempted"');
    expect(helper).not.toMatch(/REQUIRES\s+MANUAL VERIFICATION/);
  });

  it("carries inner reversal failures into the abort error and its message", async () => {
    write("a.json", "ORIGINAL");
    const inner = [{ path: "a.json", message: "EBUSY on reverse" }];

    const err: unknown = await abortBeforeActivation(
      "content", new Error("write failed"), tmp, { "a.json": "ORIGINAL" }, inner,
    ).catch((e) => e);

    const aborted = err as PromotionAbortedError;
    expect(aborted.reversalFailures).toEqual(inner);
    expect(aborted.message).toContain("write failed");
    expect(aborted.message).toContain("a.json");
    expect(aborted.message).toMatch(/own reversal had already failed/);
  });

  it("defaults reversalFailures to empty when there were none", async () => {
    write("a.json", "ORIGINAL");
    const err: unknown = await abortBeforeActivation("index", new Error("x"), tmp, { "a.json": "ORIGINAL" })
      .catch((e) => e);
    expect((err as PromotionAbortedError).reversalFailures).toEqual([]);
    expect((err as PromotionAbortedError).message).not.toMatch(/own reversal/);
  });
});

/**
 * D1 — a failure before the first write is not a reason to go looking.
 *
 * applyFileChangesAtomically validates keys and reads the snapshot before it
 * opens its try block, so a throw from that phase escapes unwrapped having
 * touched nothing. Demanding manual verification of a provably untouched
 * directory spends the operator's trust on a false alarm.
 */
describe("D1 — aborting before any write", () => {
  it("reports that nothing was written and asks for no checking", () => {
    const err: unknown = (() => {
      try {
        abortBeforeAnyWrite("content", new Error("Invalid snapshot key"), tmp);
      } catch (e) { return e; }
    })();

    const aborted = err as PromotionAbortedError;
    expect(aborted).toBeInstanceOf(PromotionAbortedError);
    expect(aborted.stage).toBe("content");
    expect(aborted.restoration).toBe("not-attempted");
    expect(aborted.message).toContain("Invalid snapshot key");
    expect(aborted.message).toMatch(/before any file was written/);
    expect(aborted.message).toMatch(/unchanged and needs no checking/);
    // The false alarm is gone.
    expect(aborted.message).not.toMatch(/MANUAL VERIFICATION/);
  });

  it("still flags manual verification when writes may have happened", async () => {
    // The contrast case: anything routed through abortBeforeActivation whose
    // restoration cannot be verified keeps the loud warning.
    write("a.json", "PROMOTED");
    jest.spyOn(fsp, "rename").mockRejectedValue(new Error("EIO") as never);

    const err: unknown = await abortBeforeActivation("content", new Error("boom"), tmp, { "a.json": "ORIGINAL" })
      .catch((e) => e);
    jest.restoreAllMocks();

    expect((err as PromotionAbortedError).message).toMatch(/REQUIRES\s+MANUAL VERIFICATION/);
  });

  it("the pre-write failure really does leave the directory untouched", async () => {
    // The production seam: an unsafe key is rejected during validation, which
    // happens before the try block that does any writing.
    write("existing.json", "UNTOUCHED");
    const before = fs.readdirSync(tmp).sort();

    const err: unknown = await applyFileChangesAtomically(
      tmp,
      new Map<string, string | null>([["safe.json", "NEW"], ["../escape.json", "BAD"]]),
    ).catch((e) => e);

    // Not an AtomicApplyError — which is exactly what routes promote() to
    // abortBeforeAnyWrite.
    expect(err).toBeInstanceOf(Error);
    expect(err).not.toBeInstanceOf(AtomicApplyError);

    // And nothing was written: no new file, no change to the existing one.
    expect(fs.readdirSync(tmp).sort()).toEqual(before);
    expect(read("existing.json")).toBe("UNTOUCHED");
    expect(read("safe.json")).toBeNull();
  });

  it("promote() routes a non-AtomicApplyError to the no-write abort", () => {
    const source = fs.readFileSync(path.resolve(__dirname, "../promotion.service.ts"), "utf-8");
    const promoteBody = source.slice(source.indexOf("async promote("), source.indexOf("async rollback("));
    expect(promoteBody).toContain("abortBeforeAnyWrite(\"content\"");
    // And the old wording is gone.
    expect(promoteBody).not.toContain("No pre-promotion snapshot was available");
  });
});

/**
 * D2 — appendHistory writes the history file first and the audit row second,
 * so a failure cannot be reported as "this run will not appear in the
 * publish history": whenever only the database write failed, it will.
 */
describe("D2 — the history warning matches what was actually written", () => {
  it("does not claim the run is absent when only the audit row failed", async () => {
    // Faithful simulation of appendHistory's real order, against a temp file
    // rather than storage/publish-history.
    const historyFile = path.join(tmp, "publish-history.json");
    const recordHistory = async () => {
      fs.writeFileSync(historyFile, JSON.stringify([{ runId: "run-9", action: "promote" }]), "utf-8");
      throw new Error("audit row rejected: database unreachable");
    };

    const out = await completeAfterActivation({
      runId: "run-9", recoveryMetadata: "persisted", prune: () => Promise.resolve(), recordHistory,
    });

    // The file really was written, so the old claim would have been false.
    expect(JSON.parse(fs.readFileSync(historyFile, "utf-8"))[0].runId).toBe("run-9");
    expect(out.warnings[0]).not.toMatch(/will not appear in the publish history/);
    expect(out.warnings[0]).toMatch(/part or all of its history and audit record may be missing/);
    expect(out.warnings[0]).toContain("audit row rejected");
    expect(out.steps.history).toBe("failed");
    expect(out.status).toBe("activated-with-warnings");
  });

  it("uses the same accurate wording when the file write is what failed", async () => {
    const out = await completeAfterActivation({
      runId: "run-9", recoveryMetadata: "persisted",
      prune: () => Promise.resolve(),
      recordHistory: () => Promise.reject(new Error("ENOSPC writing history file")),
    });
    expect(out.warnings[0]).toMatch(/part or all of its history and audit record may be missing/);
    expect(out.warnings[0]).not.toMatch(/will not appear/);
  });

  it("appendHistory still writes the file before the audit row", () => {
    // The premise of the wording: ordering unchanged by this fix.
    const source = fs.readFileSync(path.resolve(__dirname, "../promotion.service.ts"), "utf-8");
    const body = source.slice(source.indexOf("async function appendHistory("));
    expect(body.indexOf("fs.writeFile(historyFile")).toBeLessThan(body.indexOf("prisma.auditLog.create"));
  });
});

/**
 * Gap 3 — the real inner-reversal-failure to outer-restoration flow.
 *
 * Driven through the same two calls promote() makes at its content
 * boundary, with a genuine AtomicApplyError produced by a real partial
 * apply. No test-only abstraction, and promote() itself is never run.
 */
describe("combined: a real inner reversal failure, then outer restoration", () => {
  /** Produces a genuine AtomicApplyError whose reversal of a.json failed. */
  async function partialApplyWithFailedReversal(): Promise<AtomicApplyError> {
    write("a.json", "BEFORE");

    const realRename = jest.requireActual<typeof fsp>("fs/promises").rename;
    let seenA = 0;
    jest.spyOn(fsp, "rename").mockImplementation(((from: string, to: string) => {
      const dest = String(to);
      // The second write fails outright.
      if (dest.endsWith("b.json")) return Promise.reject(new Error("EIO writing b.json"));
      // a.json writes fine, but its reversal does not.
      if (dest.endsWith("a.json")) {
        seenA++;
        if (seenA > 1) return Promise.reject(new Error("EBUSY on reverse"));
      }
      return realRename(from, dest);
    }) as never);

    const err: unknown = await applyFileChangesAtomically(
      tmp, new Map<string, string | null>([["a.json", "AFTER"], ["b.json", "X"]]),
    ).catch((e) => e);

    jest.restoreAllMocks();
    return err as AtomicApplyError;
  }

  it("the outer restore repairs what the inner reversal could not, and says verified", async () => {
    const inner = await partialApplyWithFailedReversal();

    // Real inner failure, and the file is genuinely left wrong.
    expect(inner).toBeInstanceOf(AtomicApplyError);
    expect(inner.reversalFailures.map((f) => f.path)).toEqual(["a.json"]);
    expect(read("a.json")).toBe("AFTER");

    // Exactly what promote() does at its content boundary.
    const err: unknown = await abortBeforeActivation(
      "content", inner.originalError, tmp, inner.snapshot, inner.reversalFailures,
    ).catch((e) => e);

    const aborted = err as PromotionAbortedError;
    expect(aborted.restoration).toBe("verified");
    expect(aborted.requiresManualVerification).toBe(false);
    expect(aborted.unverifiedPaths).toEqual([]);
    // The diagnostic survives even though it is no longer an open problem.
    expect(aborted.reversalFailures.map((f) => f.path)).toEqual(["a.json"]);
    expect(aborted.message).toMatch(/own reversal had already failed/);
    // And the filesystem really is back.
    expect(read("a.json")).toBe("BEFORE");
  });

  it("reports failed when the outer restore cannot repair it either", async () => {
    const inner = await partialApplyWithFailedReversal();
    expect(read("a.json")).toBe("AFTER");

    // Now the outer restore fails too.
    jest.spyOn(fsp, "rename").mockRejectedValue(new Error("EIO on outer restore") as never);
    const err: unknown = await abortBeforeActivation(
      "content", inner.originalError, tmp, inner.snapshot, inner.reversalFailures,
    ).catch((e) => e);
    jest.restoreAllMocks();

    const aborted = err as PromotionAbortedError;
    expect(aborted.restoration).toBe("failed");
    expect(aborted.requiresManualVerification).toBe(true);
    expect(aborted.restorationError?.message).toContain("EIO on outer restore");
    expect(aborted.message).toMatch(/REQUIRES\s+MANUAL VERIFICATION/);
    expect(aborted.reversalFailures.map((f) => f.path)).toEqual(["a.json"]);
    // Still wrong on disk, which is why the warning is loud.
    expect(read("a.json")).toBe("AFTER");
  });
});
