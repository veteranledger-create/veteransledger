/**
 * Establishes the first published version from whatever is in public/data now.
 *
 * Why this is a command and not something the server does for itself:
 *
 * The version resolver only takes over a request when an active version
 * exists; with no pointer on disk every request falls through to
 * express.static, which is what makes the whole versioning system safe to
 * deploy before it is in use. The consequence is that the *first* promotion
 * is served straight from public/data while it is still writing files one
 * rename at a time — exactly the partially-applied state versioning exists to
 * prevent, at the one moment there is no baseline to fall back on.
 *
 * Capturing a baseline first closes that. But doing it automatically — at
 * startup, or lazily inside promote() — would silently change what the site
 * serves: versioned content would move from public/data to the version store
 * the instant the process restarted, and editorial edits to the eight
 * regenerated section manifests would stop appearing until the next
 * promotion. That is a deliberate operational step with a visible
 * consequence, so it is an operator command, run knowingly, once.
 *
 * Usage:   npx ts-node src/scripts/publish-baseline.ts
 *
 * Safe to run twice: an existing pointer is reported and left alone. It
 * never overwrites, never promotes, and never touches the database.
 */

import { paths } from "../config/paths";
import { versionStore, VersionStore } from "../modules/publish/version-store";

export interface BaselineResult {
  outcome: "created" | "already-exists";
  version: string;
  message: string;
}

/** A baseline that did not complete, and precisely how far it got. */
export class BaselineError extends Error {
  constructor(
    message: string,
    public readonly stage: "capture" | "activation",
    public readonly originalError: Error,
    /**
     * Set only when the capture succeeded and activation did not: the
     * version directory exists on disk but nothing points at it. Named so
     * the operator can see it rather than discover it later.
     */
    public readonly orphanedVersion?: string,
  ) {
    super(message);
    this.name = "BaselineError";
  }
}

/**
 * Captures `sourceDir` as the first version and activates it.
 *
 * Idempotent: with a pointer already on disk this reports it and returns
 * without writing anything, so re-running after a partial session or an
 * unclear shell history cannot replace a live baseline.
 *
 * The store and source directory are parameters so this can be exercised
 * against a throwaway root. That is not a test-only abstraction bolted on:
 * createVersionStore has been a factory since it was written, for exactly
 * this reason, and the defaults here are the application's own.
 */
export async function establishBaseline(
  store: VersionStore = versionStore,
  sourceDir: string = paths.published.root,
): Promise<BaselineResult> {
  const existing = await store.readActiveVersion();
  if (existing) {
    return {
      outcome: "already-exists",
      version: existing,
      message:
        `A baseline already exists: ${existing} is active. Nothing was captured ` +
        `and the pointer was not touched. Versions are created by promotion ` +
        `from here on.`,
    };
  }

  let version: string;
  try {
    version = await store.createVersionFrom(sourceDir);
  } catch (err) {
    // createVersionFrom assembles under a temp name and removes it on
    // failure, so there is nothing left behind and nothing to undo.
    throw new BaselineError(
      `Baseline capture failed: ${(err as Error).message} No version was created ` +
        `and no pointer was written, so serving is unchanged.`,
      "capture",
      err as Error,
    );
  }

  try {
    await store.writeActiveVersion(version);
  } catch (err) {
    // The capture succeeded, so a directory exists that nothing references.
    // It is reported rather than deleted: removing it here would be a
    // narrower copy of the orphan-version cleanup that belongs with the
    // promotion path (R9), and a half-applied fix in one command is worse
    // than one clearly stated fact.
    throw new BaselineError(
      `Baseline captured as ${version} but activation failed: ${(err as Error).message} ` +
        `The pointer was NOT written, so serving is unchanged and the site still ` +
        `reads public/data directly. The captured directory ${store.versionDir(version)} ` +
        `is unreferenced — remove it before retrying, or the next attempt will ` +
        `allocate a new id beside it.`,
      "activation",
      err as Error,
      version,
    );
  }

  return {
    outcome: "created",
    version,
    message:
      `Baseline ${version} captured from ${sourceDir} and activated. Versioned ` +
      `content is now served from the version store; public/data is unchanged ` +
      `and remains where promotion writes. Editorial edits to the regenerated ` +
      `section manifests will appear only after the next promotion.`,
  };
}

/**
 * Only when invoked directly. Importing this module — which the tests do, and
 * nothing in the application does — must never capture a version.
 */
if (require.main === module) {
  establishBaseline()
    .then((result) => {
      // Both outcomes are success: "already-exists" is the idempotent case,
      // not a failure, so re-running in a script does not break it.
      console.log(`[publish-baseline] ${result.outcome.toUpperCase()}  ${result.message}`);
      process.exit(0);
    })
    .catch((err: unknown) => {
      const baseline = err instanceof BaselineError ? err : null;
      console.error(`[publish-baseline] FAILED  ${(err as Error).message}`);
      if (baseline?.orphanedVersion) {
        console.error(`[publish-baseline] Unreferenced version directory: ${baseline.orphanedVersion}`);
      }
      process.exit(1);
    });
}
