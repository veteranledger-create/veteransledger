import { publishResultMarkup, headlineFor, esc, isStructuredFailure } from "../publish-result-view";

/**
 * F3 — the Admin result panel must tell the truth about a promotion.
 *
 * The old renderer derived its headline from `issues` and `invalid`, which a
 * promotion result does not carry — so `hasProblems` was always false and
 * every promotion rendered as a green "Completed successfully". It never read
 * `status`, `warnings` or `steps` at all, which meant the whole
 * partial-success model was invisible to the only person who needed it.
 *
 * These test the pure string-builder, so the real branching logic is covered
 * rather than a stand-in.
 */

const GREEN = "#60c060";
const AMBER = "#e0a060";
const RED = "#d05050";
const DIM = "var(--text-muted)";

const promoted = (over: Record<string, unknown> = {}) => ({
  runId: "run-1",
  action: "promote",
  type: "awards",
  filesAffected: ["ek1.json", "index.json"],
  status: "success",
  version: "v7",
  steps: {
    contentApplied: true,
    recoveryMetadata: "persisted",
    activation: "activated",
    history: "recorded",
    cleanup: "completed",
  },
  ...over,
});

describe("a clean promotion", () => {
  it("is green and says so", () => {
    const html = publishResultMarkup(promoted(), "promote", "awards");
    expect(html).toContain(GREEN);
    expect(html).toContain("Promotion completed successfully");
    expect(html).not.toContain(AMBER);
    expect(html).not.toContain(RED);
  });

  it("shows the version and every step", () => {
    const html = publishResultMarkup(promoted(), "promote", "awards");
    expect(html).toContain("v7");
    for (const label of ["Content", "Rollback snapshot", "Activation", "History &amp; audit", "Cleanup"]) {
      expect(html).toContain(label);
    }
    expect(html).toContain("persisted");
    expect(html).toContain("activated");
  });
});

describe("activated-with-warnings is never a clean success", () => {
  const withWarnings = promoted({
    status: "activated-with-warnings",
    steps: { ...promoted().steps, history: "failed" },
    warnings: ["History and audit logging failed after activation (db down). The content is live…"],
  });

  it("is amber, not green", () => {
    const html = publishResultMarkup(withWarnings, "promote", "awards");
    expect(html).toContain(AMBER);
    expect(html).not.toContain(`style="color:${GREEN};">Promotion completed successfully`);
  });

  it("says the content activated, and that there are warnings", () => {
    const html = publishResultMarkup(withWarnings, "promote", "awards");
    expect(html).toContain("Promotion activated — with warnings");
    // The old wording must not appear anywhere.
    expect(html).not.toContain("Completed successfully");
  });

  it("lists every warning", () => {
    const html = publishResultMarkup(
      promoted({
        status: "activated-with-warnings",
        warnings: ["prune failed", "history failed"],
      }),
      "promote", "awards",
    );
    expect(html).toContain("Warnings");
    expect(html).toContain("prune failed");
    expect(html).toContain("history failed");
  });

  it("shows which step failed while still showing activation as activated", () => {
    const html = publishResultMarkup(withWarnings, "promote", "awards");
    expect(html).toContain("failed");     // history
    expect(html).toContain("activated");  // activation
  });
});

describe("a failed promotion", () => {
  const failed = {
    status: "failed",
    action: "promote",
    type: "awards",
    stage: "index",
    error: "regeneration blew up",
    detail: "index step failed: regeneration blew up The promotion did not activate. Every file it had written was restored and verified against the snapshot.",
    restoration: "verified",
    requiresManualVerification: false,
    unverifiedPaths: [],
    reversalFailures: [],
  };

  it("is red and states nothing was activated", () => {
    const html = publishResultMarkup(failed, "promote", "awards");
    expect(html).toContain(RED);
    expect(html).toContain("Promotion failed — nothing was activated");
    expect(html).not.toContain(GREEN);
  });

  it("names the stage and the restoration outcome", () => {
    const html = publishResultMarkup(failed, "promote", "awards");
    expect(html).toContain("index");
    expect(html).toContain("verified");
    expect(html).toContain("regeneration blew up");
  });
});

describe("a failure where restoration could not be verified reads differently", () => {
  const unsafe = {
    status: "failed",
    action: "promote",
    type: "awards",
    stage: "content",
    error: "EIO writing naval/germany.json",
    detail: "content step failed: EIO… RESTORATION COULD NOT BE VERIFIED: 2 file(s) do not match the snapshot.",
    restoration: "failed",
    requiresManualVerification: true,
    unverifiedPaths: ["naval/germany.json", "index.json"],
    reversalFailures: [{ path: "naval/italy.json", message: "EBUSY on reverse" }],
  };

  it("demands manual verification in the headline", () => {
    const html = publishResultMarkup(unsafe, "promote", "awards");
    expect(html).toContain("MANUAL VERIFICATION REQUIRED");
    expect(html).toContain(RED);
    // Distinct from the ordinary failure wording.
    expect(html).not.toContain("nothing was activated");
  });

  it("lists the files needing checking and the reversals that failed", () => {
    const html = publishResultMarkup(unsafe, "promote", "awards");
    expect(html).toContain("Files needing manual verification");
    expect(html).toContain("naval/germany.json");
    expect(html).toContain("Changes that could not be reversed");
    expect(html).toContain("naval/italy.json: EBUSY on reverse");
  });
});

describe("promotion and rollback failures are distinguishable", () => {
  const base = {
    status: "failed", stage: "activation", error: "pointer write failed",
    restoration: "verified", requiresManualVerification: false,
  };

  it("names the promotion", () => {
    expect(publishResultMarkup({ ...base, action: "promote" }, "promote", "awards"))
      .toContain("Promotion failed");
  });

  it("names the rollback", () => {
    const html = publishResultMarkup({ ...base, action: "rollback" }, "rollback", "awards");
    expect(html).toContain("Rollback failed");
    expect(html).not.toContain("Promotion failed");
  });

  it("labels a successful rollback as a rollback", () => {
    const html = publishResultMarkup(
      promoted({ action: "rollback", steps: { ...promoted().steps, recoveryMetadata: "not-applicable" } }),
      "rollback", "awards",
    );
    expect(html).toContain("Rollback completed successfully");
    // F4: a rollback writes no snapshot of its own, and the panel says so.
    expect(html).toContain("none written");
    expect(html).not.toContain(">persisted<");
  });
});

describe("a disabled promotion", () => {
  it("is neither green nor red", () => {
    const html = publishResultMarkup(
      { status: "disabled", action: "promote", type: "awards", filesAffected: [], error: "Promotion is disabled (PROMOTION_ENABLED=false)." },
      "promote", "awards",
    );
    expect(html).toContain("Promotion is disabled");
    expect(html).not.toContain(GREEN);
    expect(html).not.toContain(RED);
    expect(html).toContain("PROMOTION_ENABLED=false");
  });
});

describe("validation and staging reports still render as before", () => {
  it("renders a clean validation green", () => {
    const html = publishResultMarkup(
      { recordsChecked: 10, valid: 10, invalid: 0, issues: [] }, "validate", "awards",
    );
    expect(html).toContain("Completed successfully");
    expect(html).toContain(GREEN);
    expect(html).toContain("Checked");
  });

  it("renders a validation with issues amber, listing them", () => {
    const html = publishResultMarkup(
      {
        recordsChecked: 10, valid: 8, invalid: 2,
        issues: [{ field: "title", recordId: "r1", message: "title is required" }],
      },
      "validate", "awards",
    );
    expect(html).toContain("Completed with issues");
    expect(html).toContain(AMBER);
    expect(html).toContain("title is required");
  });

  it("renders staged files, and the empty case", () => {
    expect(publishResultMarkup({ staged: ["a.json"] }, "run", "awards")).toContain("a.json");
    expect(publishResultMarkup({ staged: [] }, "run", "awards")).toContain("Nothing staged");
  });
});

describe("no stack traces or raw internals are rendered", () => {
  it("ignores fields the API never promises", () => {
    const html = publishResultMarkup(
      {
        status: "failed", action: "promote", stage: "content",
        error: "boom", detail: "content step failed: boom",
        // Things the dev error handler may add — must not be printed.
        stack: "Error: boom\n    at /srv/app/src/secret/path.ts:12:3",
        details: "DATABASE_URL=postgres://user:pa55w0rd@host/db",
      } as Record<string, unknown>,
      "promote", "awards",
    );
    expect(html).not.toContain("secret/path.ts");
    expect(html).not.toContain("pa55w0rd");
    expect(html).not.toContain("DATABASE_URL");
    expect(html).not.toMatch(/\bat \//);
  });

  it("escapes everything it does render", () => {
    const html = publishResultMarkup(
      {
        status: "failed", action: "promote", stage: "content",
        detail: '<img src=x onerror="alert(1)">',
        unverifiedPaths: ['<script>alert("x")</script>'],
      } as Record<string, unknown>,
      "promote", '<b>awards</b>',
    );
    expect(html).not.toContain("<img");
    expect(html).not.toContain("<script>");
    expect(html).toContain("&lt;img");
    expect(html).toContain("&lt;b&gt;awards&lt;/b&gt;");
  });

  it("escapes the dangerous characters", () => {
    expect(esc('<a href="x">&</a>')).toBe("&lt;a href=&quot;x&quot;&gt;&amp;&lt;/a&gt;");
    expect(esc(null)).toBe("");
    expect(esc(undefined)).toBe("");
  });
});

describe("headlineFor, directly", () => {
  it.each([
    ["success", "promote", GREEN],
    ["activated-with-warnings", "promote", AMBER],
    ["failed", "promote", RED],
    ["success", "rollback", GREEN],
    ["activated-with-warnings", "rollback", AMBER],
    ["failed", "rollback", RED],
  ])("%s on %s is %s", (status, action, colour) => {
    expect(headlineFor({ status }, action).colour).toBe(colour);
  });

  it("never returns green for anything other than a clean success", () => {
    for (const status of ["activated-with-warnings", "failed", "disabled"]) {
      expect(headlineFor({ status }, "promote").colour).not.toBe(GREEN);
    }
  });

  it("handles a missing report without throwing", () => {
    expect(publishResultMarkup(null, "promote", "awards")).toBe("");
    expect(headlineFor({}, "promote").colour).toBe(GREEN); // a bare report is a validation one
  });
});

/**
 * D3 — a reversal that failed and was then repaired is history, not an open
 * problem.
 *
 * The block rendered red whenever `reversalFailures` was non-empty, ungated
 * by `restoration`. Beside "Restoration: verified" that reads as "these
 * files are still broken", sending someone to check files the outer restore
 * has already put back and byte-verified.
 */
describe("D3 — reversal failures repaired by the outer restore", () => {
  const repaired = {
    status: "failed",
    action: "promote",
    type: "awards",
    stage: "content",
    error: "EIO writing b.json",
    detail: "content step failed: EIO writing b.json … restored and verified against the snapshot.",
    restoration: "verified",
    requiresManualVerification: false,
    unverifiedPaths: [],
    reversalFailures: [{ path: "a.json", message: "EBUSY on reverse" }],
  };

  const stillBroken = {
    ...repaired,
    detail: "content step failed: EIO … RESTORATION COULD NOT BE VERIFIED.",
    restoration: "failed",
    requiresManualVerification: true,
    unverifiedPaths: ["a.json"],
  };

  it("labels them as superseded, and keeps the diagnostic", () => {
    const html = publishResultMarkup(repaired, "promote", "awards");
    expect(html).toContain("Initial reversal failures (subsequently restored and verified)");
    // The detail survives — it is still useful evidence.
    expect(html).toContain("a.json: EBUSY on reverse");
  });

  it("does not present them as currently unreversed", () => {
    const html = publishResultMarkup(repaired, "promote", "awards");
    expect(html).not.toContain("Changes that could not be reversed");
    expect(html).not.toContain("Files needing manual verification");
    expect(html).not.toContain("MANUAL VERIFICATION REQUIRED");
  });

  it("renders them neutrally, not in red", () => {
    const html = publishResultMarkup(repaired, "promote", "awards");
    // Asserted on the block's own heading element, so a red block elsewhere
    // in the panel cannot make this pass or fail by accident.
    expect(html).toContain(
      `<p class="section-label mb-3" style="color:${DIM};">Initial reversal failures (subsequently restored and verified)</p>`,
    );
    expect(html).not.toContain(`style="color:${RED};">Initial reversal failures`);
  });

  it("still says the promotion failed, because it did", () => {
    const html = publishResultMarkup(repaired, "promote", "awards");
    expect(html).toContain("Promotion failed — nothing was activated");
    expect(html).toContain("Restoration:");
    expect(html).toContain("verified");
  });

  it("keeps the prominent warning when restoration actually failed", () => {
    const html = publishResultMarkup(stillBroken, "promote", "awards");
    // Same element-level check, the other way round.
    expect(html).toContain(
      `<p class="section-label mb-3" style="color:${RED};">Changes that could not be reversed</p>`,
    );
    expect(html).toContain("Files needing manual verification");
    expect(html).toContain("MANUAL VERIFICATION REQUIRED");
    expect(html).toContain(RED);
    expect(html).not.toContain("subsequently restored");
  });

  it("keeps the prominent warning when restoration was not attempted", () => {
    const html = publishResultMarkup(
      { ...stillBroken, restoration: "not-attempted", requiresManualVerification: true },
      "promote", "awards",
    );
    expect(html).toContain("Changes that could not be reversed");
    expect(html).not.toContain("subsequently restored");
  });
});

/**
 * Integration gap 2 — a structured aborted response must reach the result
 * renderer, not the one-line error path.
 *
 * admin.js routes on isStructuredFailure, which lives here so the branch and
 * its test share one definition rather than a copy.
 */
describe("structured non-OK responses are recognised", () => {
  it("recognises an aborted promotion", () => {
    expect(isStructuredFailure({ status: "failed", stage: "content", error: "EIO" })).toBe(true);
  });

  it("recognises an aborted rollback", () => {
    expect(isStructuredFailure({ status: "failed", stage: "activation", action: "rollback" })).toBe(true);
  });

  it.each([
    ["a plain AppError body", { error: "No staged files found for type \"awards\"." }],
    ["a generic 500", { error: "Internal server error", details: "boom", stack: "Error: boom\n at x" }],
    ["a 401", { error: "Authentication required" }],
    ["failed without a stage", { status: "failed", error: "boom" }],
    ["an empty stage", { status: "failed", stage: "" }],
    ["a successful result", { status: "success", stage: "content" }],
    ["activated with warnings", { status: "activated-with-warnings" }],
    ["null", null],
    ["undefined", undefined],
  ])("does not treat %s as structured", (_label, body) => {
    expect(isStructuredFailure(body as Record<string, unknown>)).toBe(false);
  });

  it("every body it accepts renders through the structured path", () => {
    // The two halves of the contract: recognised, and renderable as a result
    // rather than as a bare message.
    const body = {
      status: "failed", action: "rollback", type: "awards", stage: "activation",
      error: "pointer write failed", detail: "activation step failed: pointer write failed …",
      restoration: "verified", requiresManualVerification: false,
      unverifiedPaths: [], reversalFailures: [],
    };
    expect(isStructuredFailure(body)).toBe(true);

    const html = publishResultMarkup(body, "rollback", "awards");
    expect(html).toContain("Rollback failed");
    expect(html).toContain("pointer write failed");
    expect(html).toContain("activation");
  });
});

describe("admin.js routes on the shared predicate", () => {
  // The branch itself cannot be executed here: admin.js has top-level DOM
  // side effects and imports the whole Admin module graph. What is asserted
  // is that it uses this predicate rather than its own copy of the rule, so
  // the behaviour above is the behaviour it gets.
  const source = require("fs").readFileSync(
    require("path").resolve(__dirname, "../admin.js"), "utf-8",
  ) as string;

  it("imports the predicate and the renderer from this module", () => {
    expect(source).toContain('import { publishResultMarkup, isStructuredFailure } from "./publish-result-view.js";');
  });

  it("routes a recognised body to renderPublishResult inside the !res.ok branch", () => {
    const branch = source.slice(source.indexOf("if (!res.ok)"), source.indexOf("if (action === \"history\")"));
    expect(branch).toContain("isStructuredFailure(data)");
    expect(branch).toContain("renderPublishResult(data, action, type);");
    // And still falls through to the plain path for everything else.
    expect(branch).toContain("throw new Error(data.error");
  });

  it("keeps no duplicate copy of the recognition rule", () => {
    expect(source).not.toContain('data.status === "failed" && data.stage');
  });
});
