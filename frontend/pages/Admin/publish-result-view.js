/**
 * VeteransLedger · Admin — publish/promote result rendering
 *
 * Split out of admin.js and made a pure string-builder so the branch that
 * matters most can actually be tested: a promotion that activated but hit a
 * problem afterwards.
 *
 * It used to render as a green "Completed successfully". The old renderer
 * derived its headline from `issues` and `invalid`, which a promotion result
 * does not carry — so every promotion looked clean, and `status`, `warnings`
 * and `steps` were never read at all.
 *
 * Nothing here prints a stack trace or an unredacted server error object; it
 * uses only the fields the API models deliberately.
 */

const GREEN = "#60c060";
const AMBER = "#e0a060";
const RED = "#d05050";
const DIM = "var(--text-muted)";

export function esc(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

const ACTION_LABELS = {
  validate: "Validation",
  run: "Staging",
  promote: "Promotion",
  rollback: "Rollback",
};

/**
 * Whether a non-OK response body is a structured aborted promotion rather
 * than a plain error. admin.js routes on this so such a response reaches the
 * result renderer instead of the one-line error path.
 */
export function isStructuredFailure(body) {
  return Boolean(body)
    && body.status === "failed"
    && typeof body.stage === "string"
    && body.stage.length > 0;
}

/** A promotion/rollback result, as opposed to a validate/staging report. */
function isPromotionResult(report) {
  return typeof report?.status === "string"
    && ["success", "activated-with-warnings", "failed", "disabled"].includes(report.status);
}

/** Headline wording and colour. Never green unless genuinely clean. */
export function headlineFor(report, action) {
  if (!isPromotionResult(report)) {
    const hasIssues = Array.isArray(report?.issues) && report.issues.length > 0;
    const hasProblems = report?.invalid > 0 || hasIssues;
    return hasProblems
      ? { text: "Completed with issues", colour: AMBER }
      : { text: "Completed successfully", colour: GREEN };
  }

  const what = action === "rollback" ? "Rollback" : "Promotion";

  switch (report.status) {
    case "success":
      return { text: `${what} completed successfully`, colour: GREEN };

    case "activated-with-warnings":
      // The content IS live. Saying "successful" would hide the warnings;
      // saying "failed" would be false.
      return { text: `${what} activated — with warnings`, colour: AMBER };

    case "disabled":
      return { text: `${what} is disabled`, colour: DIM };

    case "failed":
    default:
      // A failure that could not put the files back is a different situation
      // from one that could, and must not read the same.
      return report.requiresManualVerification
        ? { text: `${what} failed — MANUAL VERIFICATION REQUIRED`, colour: RED }
        : { text: `${what} failed — nothing was activated`, colour: RED };
  }
}

const STEP_LABELS = {
  contentApplied: "Content",
  recoveryMetadata: "Rollback snapshot",
  activation: "Activation",
  history: "History & audit",
  cleanup: "Cleanup",
};

/** Green for good, amber for a problem, dim for "nothing to do". */
function stepColour(key, value) {
  if (value === true || value === "persisted" || value === "activated"
    || value === "recorded" || value === "completed") return GREEN;
  if (value === "not-applicable" || value === "not-attempted") return DIM;
  return AMBER;
}

function stepText(key, value) {
  if (value === true) return "applied";
  if (value === false) return "not applied";
  if (value === "not-applicable") return key === "recoveryMetadata" ? "none written" : "n/a";
  return String(value);
}

function stepsBlock(steps) {
  if (!steps || typeof steps !== "object") return "";
  const rows = Object.keys(STEP_LABELS)
    .filter((key) => key in steps)
    .map((key) => {
      const value = steps[key];
      return `<div class="result-stat-card">
        <div class="result-stat-card__value" style="color:${stepColour(key, value)};font-size:var(--text-sm);">${esc(stepText(key, value))}</div>
        <div class="result-stat-card__label">${esc(STEP_LABELS[key])}</div>
      </div>`;
    })
    .join("");
  return rows ? `<div class="result-stat-grid">${rows}</div>` : "";
}

function listBlock(label, items, colour) {
  if (!Array.isArray(items) || items.length === 0) return "";
  return `<div class="mb-6">
    <p class="section-label mb-3" ${colour ? `style="color:${colour};"` : ""}>${esc(label)}</p>
    <ul class="result-staged-list">${items.map((i) => `<li>${esc(i)}</li>`).join("")}</ul>
  </div>`;
}

/** Builds the whole result panel. Pure: same input, same string. */
export function publishResultMarkup(report, action, type) {
  if (!report) return "";

  const actionLabel = ACTION_LABELS[action] || action;
  const headline = headlineFor(report, action);

  let body = "";

  if (isPromotionResult(report)) {
    // The explanation the service composed, which for a failure states
    // whether the files were put back and verified.
    const explanation = report.detail || report.error;
    body += explanation
      ? `<p class="text-secondary text-sm mb-4">${esc(explanation)}</p>`
      : "";

    if (report.status === "failed" && report.stage) {
      body += `<p class="text-dim text-sm mb-4">Failed at the <strong>${esc(report.stage)}</strong> stage.`
        + (report.restoration ? ` Restoration: <strong>${esc(report.restoration)}</strong>.` : "")
        + `</p>`;
    }

    body += stepsBlock(report.steps);
    body += listBlock("Warnings", report.warnings, AMBER);
    body += listBlock("Files needing manual verification", report.unverifiedPaths, RED);

    // A reversal that failed and was then repaired by the outer restore is
    // history, not an outstanding problem. Showing it in red beside
    // "Restoration: verified" reads as "these files are still broken", which
    // would send someone to check files that are provably correct.
    const reversals = (report.reversalFailures || []).map((f) => `${f.path}: ${f.message}`);
    const repaired = report.restoration === "verified";
    body += listBlock(
      repaired
        ? "Initial reversal failures (subsequently restored and verified)"
        : "Changes that could not be reversed",
      reversals,
      repaired ? DIM : RED,
    );

    if (report.version) {
      body += `<p class="text-dim text-sm">Published version: <strong>${esc(report.version)}</strong></p>`;
    }
    body += listBlock("Files affected", report.filesAffected, null);
    body += listBlock("Index notes", report.indexNotes, null);
  } else {
    // Validation / staging reports, unchanged.
    const hasIssues = Array.isArray(report.issues) && report.issues.length > 0;
    const hasProblems = report.invalid > 0 || hasIssues;

    if (report.message) body += `<p class="text-secondary text-sm mb-4">${esc(report.message)}</p>`;

    if (typeof report.recordsChecked === "number") {
      body += `<div class="result-stat-grid">
        <div class="result-stat-card">
          <div class="result-stat-card__value" style="color:var(--gold);">${esc(report.recordsChecked ?? "—")}</div>
          <div class="result-stat-card__label">Checked</div>
        </div>
        <div class="result-stat-card">
          <div class="result-stat-card__value" style="color:${GREEN};">${esc(report.valid ?? "—")}</div>
          <div class="result-stat-card__label">Valid</div>
        </div>
        <div class="result-stat-card">
          <div class="result-stat-card__value" style="color:${hasProblems ? AMBER : GREEN};">${esc(report.invalid ?? "—")}</div>
          <div class="result-stat-card__label">Invalid</div>
        </div>
      </div>`;
    }

    if (hasIssues) {
      body += `<div class="mb-6">
        <p class="section-label mb-3">Issues</p>
        <div class="result-issues-list">
          ${report.issues.map((i) => `
            <div class="result-issue">
              <span class="badge">${esc(i.field || i.severity || "issue")}</span>
              <span class="result-issue__record">${esc(i.recordId || "")}</span>
              <p class="result-issue__msg">${esc(i.message)}</p>
            </div>`).join("")}
        </div>
      </div>`;
    }

    if (Array.isArray(report.staged)) {
      body += `<div>
        <p class="section-label mb-3">Staged Files</p>
        ${report.staged.length
          ? `<ul class="result-staged-list">${report.staged.map((s) => `<li>${esc(s)}</li>`).join("")}</ul>`
          : `<p class="text-dim">Nothing staged — no valid records to publish.</p>`}
      </div>`;
    }
  }

  return `
    <div class="result-header">
      <span class="badge">${esc(type)}</span>
      <span class="text-secondary text-sm">${esc(actionLabel)}</span>
      <span class="result-header__status" style="color:${headline.colour};">${esc(headline.text)}</span>
    </div>
    ${body}`;
}
