import { abortedBody } from "../publish.controller";
import { PromotionAbortedError } from "../promotion.service";

/**
 * Integration gap 1 — the controller's mapping of an aborted promotion.
 *
 * PromotionAbortedError is not an AppError, so without this mapping the
 * generic error handler reduces it to "Internal server error" and, in
 * production, drops the explanation entirely — throwing away the one thing
 * the operator needs: whether the files were put back. This is the only
 * layer that carries that across the HTTP boundary, and it had no test.
 */

const verified = () =>
  new PromotionAbortedError(
    "index step failed: regeneration blew up The promotion did not activate. Every file it had written was restored and verified.",
    "index",
    new Error("regeneration blew up"),
    "verified",
    undefined,
    [],
    [],
  );

const unsafe = () =>
  new PromotionAbortedError(
    "content step failed: EIO RESTORATION COULD NOT BE VERIFIED. REQUIRES MANUAL VERIFICATION.",
    "content",
    new Error("EIO writing naval/germany.json"),
    "failed",
    new Error("EIO on restore"),
    ["naval/germany.json", "index.json"],
    [{ path: "naval/italy.json", message: "EBUSY on reverse" }],
  );

describe("abortedBody preserves every field the operator needs", () => {
  it("maps a verified-restoration abort accurately", () => {
    const body = abortedBody("promote", "awards", verified());

    expect(body).toEqual({
      status: "failed",
      action: "promote",
      type: "awards",
      stage: "index",
      error: "regeneration blew up",
      detail: expect.stringContaining("restored and verified"),
      restoration: "verified",
      requiresManualVerification: false,
      unverifiedPaths: [],
      reversalFailures: [],
    });
  });

  it("maps an unverifiable-restoration abort accurately", () => {
    const body = abortedBody("promote", "armaments", unsafe());

    expect(body.stage).toBe("content");
    expect(body.error).toBe("EIO writing naval/germany.json");
    expect(body.restoration).toBe("failed");
    expect(body.requiresManualVerification).toBe(true);
    expect(body.unverifiedPaths).toEqual(["naval/germany.json", "index.json"]);
    expect(body.reversalFailures).toEqual([{ path: "naval/italy.json", message: "EBUSY on reverse" }]);
  });

  it("carries the action through, so a rollback is not reported as a promotion", () => {
    expect(abortedBody("promote", "awards", verified()).action).toBe("promote");
    expect(abortedBody("rollback", "awards", verified()).action).toBe("rollback");
  });

  it("always reports status failed, whatever the restoration outcome", () => {
    expect(abortedBody("promote", "awards", verified()).status).toBe("failed");
    expect(abortedBody("promote", "awards", unsafe()).status).toBe("failed");
  });

  it("reflects requiresManualVerification rather than recomputing it", () => {
    // It is derived on the error from `restoration !== "verified"`, and the
    // body must not drift from that.
    for (const err of [verified(), unsafe()]) {
      expect(abortedBody("promote", "x", err).requiresManualVerification)
        .toBe(err.requiresManualVerification);
      expect(abortedBody("promote", "x", err).requiresManualVerification)
        .toBe(err.restoration !== "verified");
    }
  });

  it("passes the type through untouched", () => {
    expect(abortedBody("promote", "political-docs", verified()).type).toBe("political-docs");
  });
});

describe("abortedBody exposes no stack traces or internals", () => {
  it("emits only the ten documented fields", () => {
    expect(Object.keys(abortedBody("promote", "awards", unsafe())).sort()).toEqual([
      "action", "detail", "error", "requiresManualVerification", "restoration",
      "reversalFailures", "stage", "status", "type", "unverifiedPaths",
    ]);
  });

  it("carries no stack, however the error was raised", () => {
    const err = unsafe();
    expect(err.stack).toBeDefined();           // the error really has one
    expect(err.originalError.stack).toBeDefined();

    const serialised = JSON.stringify(abortedBody("promote", "awards", err));
    expect(serialised).not.toContain("at Object");
    expect(serialised).not.toContain(".ts:");
    expect(serialised).not.toContain("node_modules");
    expect(serialised).not.toMatch(/\bat \S+ \(/);
  });

  it("emits only its documented fields even when the error carries extras", () => {
    // The real risk is a mapping that spreads the error instead of picking
    // fields: anything an upstream layer attached would then ride along. So
    // plant own properties, including a credential, and require that none
    // of them appear.
    const err = unsafe() as PromotionAbortedError & Record<string, unknown>;
    err.databaseUrl = "postgres://admin:pa55w0rd@db.internal:5432/veteransledger";
    err.config = { jwtSecret: "s3cr3t-signing-key", adminPassword: "hunter2" };
    err.request = { headers: { authorization: "Bearer eyJhbGciOiJIUzI1NiJ9.payload.sig" } };

    // The planted values really are own properties of the error.
    expect(Object.keys(err)).toEqual(expect.arrayContaining(["databaseUrl", "config", "request"]));

    const body = abortedBody("promote", "awards", err);
    const serialised = JSON.stringify(body);

    expect(Object.keys(body).sort()).toEqual([
      "action", "detail", "error", "requiresManualVerification", "restoration",
      "reversalFailures", "stage", "status", "type", "unverifiedPaths",
    ]);
    for (const leaked of [
      "databaseUrl", "pa55w0rd", "postgres://", "jwtSecret", "s3cr3t-signing-key",
      "adminPassword", "hunter2", "authorization", "Bearer", "eyJhbGciOiJIUzI1NiJ9",
    ]) {
      expect(serialised).not.toContain(leaked);
    }

    // The reversalFailures entries stay {path, message} only — never an Error.
    for (const f of body.reversalFailures) {
      expect(Object.keys(f).sort()).toEqual(["message", "path"]);
    }
  });

  it("serialises to JSON without throwing or carrying Error instances", () => {
    const body = abortedBody("promote", "awards", unsafe());
    const round = JSON.parse(JSON.stringify(body));
    expect(round.error).toBe("EIO writing naval/germany.json");
    // An Error instance would have serialised to {} and lost the message.
    expect(typeof round.error).toBe("string");
    expect(typeof round.detail).toBe("string");
  });
});

describe("the controller routes aborts to this mapping", () => {
  const source = require("fs").readFileSync(
    require("path").resolve(__dirname, "../publish.controller.ts"), "utf-8",
  ) as string;

  it("catches PromotionAbortedError in both promote and rollback", () => {
    expect(source.match(/err instanceof PromotionAbortedError/g)).toHaveLength(2);
    expect(source).toContain('abortedBody("promote", req.params.type, err)');
    expect(source).toContain('abortedBody("rollback", req.params.type, err)');
  });

  it("returns 500 with the body rather than deferring to the generic handler", () => {
    expect(source).toContain("res.status(500).json(abortedBody(");
    // next(err) remains for everything that is not an abort.
    expect(source).toContain("next(err);");
  });
});
