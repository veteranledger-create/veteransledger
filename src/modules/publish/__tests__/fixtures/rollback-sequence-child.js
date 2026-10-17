/*
 * Runs the rollback sequence in a REAL child process and dies at a chosen
 * point with process.exit, so an interruption test observes an actual
 * process death rather than a thrown exception the parent could catch.
 *
 * This is the only way to test what survives interruption: in-process
 * fault injection always unwinds through finally blocks and compensating
 * handlers, which is precisely the machinery that is absent when a process
 * is killed. A test that only throws proves nothing about durability.
 *
 * It drives the same real units rollbackLocked drives, in the same order,
 * against a throwaway directory. promote() and rollback() are not called —
 * PROMOTION_ENABLED stays false and is never consulted here.
 *
 *   node rollback-sequence-child.js <tmpDir> <phase> [dieAfterRenames]
 *
 * Phases: before-recovery, after-recovery, after-marker, mid-files,
 *         after-files, after-activation, none
 */
const PROJECT = require("path").resolve(__dirname, "../../../../..");
require(`${PROJECT}/node_modules/ts-node`).register({
  project: `${PROJECT}/tsconfig.json`,
  compilerOptions: { module: "commonjs" },
  transpileOnly: true,
});

const fsp = require("fs/promises");
const path = require("path");

const PA = require(`${PROJECT}/src/modules/publish/promote-atomic.ts`);
const SM = require(`${PROJECT}/src/modules/publish/snapshot-manifest.ts`);
const RR = require(`${PROJECT}/src/modules/publish/rollback-recovery.ts`);
const VS = require(`${PROJECT}/src/modules/publish/version-store.ts`);

const [tmpDir, phase, dieAfterRenamesRaw, runIdArg] = process.argv.slice(2);
const dieAfterRenames = Number(dieAfterRenamesRaw ?? 1);

const TYPE = "armaments";
const TARGET_RUN = "target-run";
// Each rollback gets its own run directory, as rollbackLocked does with a
// fresh randomUUID — which is what lets a retry's capture sit beside the
// interrupted attempt's rather than overwrite it.
const ROLLBACK_RUN = runIdArg || "rollback-run";

const contentDir = path.join(tmpDir, "public-data", TYPE);
const snapshotsRoot = path.join(tmpDir, "snapshots");
const runDir = path.join(snapshotsRoot, TYPE, ROLLBACK_RUN);
const targetManifest = path.join(snapshotsRoot, TYPE, TARGET_RUN, "manifest.json");

/** A hard death: no unwinding, no finally, no flush. */
function die(at) {
  process.stdout.write(`DIED_AT:${at}\n`);
  process.exit(9);
}

async function main() {
  // 1. target manifest, validated
  const { snapshot: target } = await SM.readSnapshotManifest(targetManifest);
  if (phase === "before-manifest") die(phase);

  // 2. capture the live state — the same read rule captureCurrentState uses
  const before = {};
  for (const key of Object.keys(target)) {
    const normalized = PA.normalizeSnapshotKey(key);
    before[normalized] = await PA.readForSnapshot(PA.resolveSnapshotPath(contentDir, key), normalized);
  }
  if (phase === "before-recovery") die(phase);

  // 3. durable recovery point
  const store = VS.createVersionStore(path.join(tmpDir, "published"));
  const activeVersionAtCapture = await store.readActiveVersion();
  const { checksum } = await RR.writeRecoveryPoint(
    RR.recoveryPointPath(runDir),
    { type: TYPE, runId: ROLLBACK_RUN, restoredFromRunId: TARGET_RUN, activeVersionAtCapture },
    before,
  );
  if (phase === "after-recovery") die(phase);

  // 4. write-start marker
  await RR.writeWriteMarker(RR.writeMarkerPath(runDir), {
    type: TYPE, runId: ROLLBACK_RUN, restoredFromRunId: TARGET_RUN,
    recoveryChecksum: checksum, fileCount: Object.keys(before).length,
  });
  if (phase === "after-marker") die(phase);

  // 5. destructive writes. For mid-files the process is killed from inside
  //    the real restore, between two renames — an interruption no catch
  //    block can see.
  if (phase === "mid-files") {
    const realRename = fsp.rename;
    let seen = 0;
    fsp.rename = async (from, to) => {
      const result = await realRename(from, to);
      if (!path.basename(String(to)).startsWith(".tmp-")) {
        seen++;
        if (seen >= dieAfterRenames) die(`${phase}:${seen}`);
      }
      return result;
    };
  }
  await PA.restoreFromSnapshot(contentDir, target);
  if (phase === "after-files") die(phase);

  // 6. activation
  const version = await store.createVersionFrom(path.join(tmpDir, "public-data"));
  await store.writeActiveVersion(version);
  if (phase === "after-activation") die(phase);

  // 7. completion record, last
  await RR.writeCompletion(RR.completionPath(runDir), {
    type: TYPE, runId: ROLLBACK_RUN, restoredFromRunId: TARGET_RUN,
    activatedVersion: version, filesRestored: Object.keys(target).length,
  });
  process.stdout.write("COMPLETED\n");
  process.exit(0);
}

main().catch((err) => {
  process.stdout.write(`ERROR:${err && err.name}:${err && err.message}\n`);
  process.exit(1);
});
