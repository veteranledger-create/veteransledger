import { ArchiveIntegrityReport, ArchiveIntegrityViolation, ArchiveIntegrityValidator } from "./archive-integrity-validator";
import {
  campaignArchiveManifestProvider,
  CampaignArchiveManifestObsoleteEntry,
} from "./campaigns-archive-manifest-provider";
import { loadCampaignArchive, LoadedCampaignArchive } from "./campaigns-archive-loader";

// Archive composition (which files are active, which are obsolete and why)
// lives entirely in campaigns.archive.json — never as metadata written into
// a historical source file. Historical archive files are preservation
// artifacts and stay byte-identical to their original content; this
// manifest is the sole record of a file's obsolete status.
//
// This file never reads campaigns.archive.json (or any path under
// public/data/campaigns/) directly — every filesystem fact it needs
// (the manifest, the declared active files, the archive directory) comes
// from campaignArchiveManifestProvider, the one component permitted to
// touch the manifest. Actual campaign-record file content comes from
// campaigns-archive-loader.ts's loadCampaignArchive() — either passed in
// by a caller that already loaded it for this run, or loaded fresh here
// when called standalone — never read directly by this file either.

export type IntegrityViolationKind =
  | "manifest_missing_or_unreadable"
  | "missing_declared_file"
  | "unreadable_declared_file"
  | "malformed_declared_file"
  | "undeclared_file"
  | "filename_id_mismatch"
  | "duplicate_id"
  | "duplicate_record_id"
  | "duplicate_slug"
  | "duplicate_declared_filename"
  | "manifest_active_mismatch"
  | "manifest_duplicate_active"
  | "manifest_obsolete_also_active"
  | "obsolete_source_missing"
  | "obsolete_replacement_missing"
  | "obsolete_replacement_mismatch"
  | "obsolete_replacement_missing_record_id";

export interface IntegrityViolation extends ArchiveIntegrityViolation {
  kind: IntegrityViolationKind;
}

export interface DuplicateGroup {
  value: string;
  files: string[];
}

export interface ObsoleteFileInfo {
  relPath: string;
  id?: string;
  replacedBy: string;
  replacementRelPath: string;
  reason: string;
  date?: string;
  notes?: string;
  sourceExists: boolean;
  replacementExists: boolean;
  sameLogicalRecord: boolean;
  replacementHasRecordId: boolean;
  valid: boolean;
}

export interface ReplacementMappingEntry {
  obsolete: string;
  replacement: string;
}

export interface CampaignArchiveIntegrityReport extends ArchiveIntegrityReport {
  filesScanned: number;
  declaredFiles: number;
  activeFiles: string[];
  obsoleteFiles: ObsoleteFileInfo[];
  replacementMapping: ReplacementMappingEntry[];
  duplicateIds: DuplicateGroup[];
  duplicateRecordIds: DuplicateGroup[];
  duplicateSlugs: DuplicateGroup[];
  undeclaredFiles: string[];
  missingDeclaredFiles: string[];
  unreadableDeclaredFiles: string[];
  malformedDeclaredFiles: string[];
  violations: IntegrityViolation[];
}

interface FileEntry {
  theater: string;
  filename: string;
  relPath: string;
  declared: boolean;
  exists: boolean;
  id?: string;
  recordId?: string;
}

// Verifies a manifest obsolete-entry's claim rather than trusting it: the
// source file itself must exist, its declared replacement must exist,
// both must represent the same logical record (same in-file id), and the
// replacement must carry the canonical recordId the obsolete copy lacks.
// Reads nothing itself — every file's content comes from onDiskIndex,
// which loadCampaignArchive() already scanned once for this run.
function verifyObsoleteEntry(entry: CampaignArchiveManifestObsoleteEntry, onDiskIndex: Map<string, Record<string, unknown> | undefined>): { info: ObsoleteFileInfo; violations: IntegrityViolation[] } {
  const violations: IntegrityViolation[] = [];

  const sourceExists = onDiskIndex.has(entry.file);
  if (!sourceExists) {
    violations.push({
      kind: "obsolete_source_missing",
      message: `campaigns.archive.json lists "${entry.file}" as obsolete, but that file does not exist on disk.`,
    });
  }
  const sourceData = sourceExists ? onDiskIndex.get(entry.file) : undefined;
  const id = typeof sourceData?.id === "string" ? sourceData.id : undefined;

  const replacementExists = onDiskIndex.has(entry.replacedBy);
  if (!replacementExists) {
    violations.push({
      kind: "obsolete_replacement_missing",
      message: `campaigns.archive.json declares "${entry.file}" replaced by "${entry.replacedBy}", but "${entry.replacedBy}" does not exist on disk.`,
    });
  }
  const replacementData = replacementExists ? onDiskIndex.get(entry.replacedBy) : undefined;
  const replacementId = typeof replacementData?.id === "string" ? replacementData.id : undefined;
  const replacementRecordId = typeof replacementData?.recordId === "string" ? replacementData.recordId : undefined;

  const sameLogicalRecord = !!id && !!replacementId && id === replacementId;
  if (sourceExists && replacementExists && !sameLogicalRecord) {
    violations.push({
      kind: "obsolete_replacement_mismatch",
      message: `"${entry.file}" (id "${id}") and its declared replacement "${entry.replacedBy}" (id "${replacementId}") do not represent the same logical record.`,
    });
  }

  const replacementHasRecordId = !!replacementRecordId;
  if (replacementExists && !replacementHasRecordId) {
    violations.push({
      kind: "obsolete_replacement_missing_record_id",
      message: `"${entry.replacedBy}" is declared as the canonical replacement for "${entry.file}" but has no recordId of its own — it cannot serve as the canonical source.`,
    });
  }

  const valid = sourceExists && replacementExists && sameLogicalRecord && replacementHasRecordId;
  return {
    info: {
      relPath: entry.file,
      id,
      replacedBy: entry.replacedBy,
      replacementRelPath: entry.replacedBy,
      reason: entry.reason,
      date: entry.date,
      notes: entry.notes,
      sourceExists,
      replacementExists,
      sameLogicalRecord,
      replacementHasRecordId,
      valid,
    },
    violations,
  };
}

// Pure — reads the filesystem (including campaigns.archive.json), never
// touches Prisma. Safe to call at any time, including from preview/dry-run
// paths that must never have DB side effects. This is the single source of
// truth both the preview builder and the real importer's startup gate
// call — they can never silently drift apart on what "valid" means.
export async function validateCampaignArchiveIntegrity(preloaded?: LoadedCampaignArchive): Promise<CampaignArchiveIntegrityReport> {
  const violations: IntegrityViolation[] = [];
  const archive = preloaded ?? await loadCampaignArchive();
  const onDiskIndex = new Map<string, Record<string, unknown> | undefined>();
  // Separate from onDiskIndex (which only carries parsed content, exactly
  // as before) so every existing onDiskIndex.get()/.has() call site below
  // is untouched — this is purely additive, read alongside onDiskIndex
  // only at the one place that needs to tell "unreadable" from "malformed".
  const readErrorPaths = new Set<string>();
  for (const entry of archive.filesOnDisk) {
    onDiskIndex.set(entry.relPath, entry.raw);
    if (entry.readError) readErrorPaths.add(entry.relPath);
  }

  const loadError = campaignArchiveManifestProvider.getLoadError();
  if (loadError) {
    violations.push({ kind: "manifest_missing_or_unreadable", message: loadError });
  }
  const manifest = campaignArchiveManifestProvider.getManifest();
  const manifestActive = manifest.active;
  const manifestObsolete = manifest.obsolete;
  const campaignFiles = campaignArchiveManifestProvider.getCampaignFiles();

  // ── Manifest self-consistency ───────────────────────────────────────
  const manifestActiveSeen = new Set<string>();
  for (const relPath of manifestActive) {
    if (manifestActiveSeen.has(relPath)) {
      violations.push({
        kind: "manifest_duplicate_active",
        message: `campaigns.archive.json lists "${relPath}" in "active" more than once.`,
      });
    }
    manifestActiveSeen.add(relPath);
  }

  const obsoleteFileSet = new Set(manifestObsolete.map((o) => o.file));
  for (const relPath of manifestActive) {
    if (obsoleteFileSet.has(relPath)) {
      violations.push({
        kind: "manifest_obsolete_also_active",
        message: `campaigns.archive.json lists "${relPath}" in both "active" and "obsolete" — a file cannot be both.`,
      });
    }
  }

  // Manifest.active must exactly match getCampaignFiles() (flattened) —
  // they're derived from the same manifest read, so a mismatch here would
  // only ever indicate a bug in that derivation, not real archive drift.
  // Kept as a cheap self-check rather than removed, since it costs nothing
  // and catches exactly that class of bug if it's ever introduced.
  const declaredFlat = Object.entries(campaignFiles).flatMap(
    ([theater, filenames]) => filenames.map((f) => `${theater}/${f}`),
  );
  const declaredFlatSet = new Set(declaredFlat);
  const manifestActiveSet = new Set(manifestActive);
  for (const relPath of declaredFlat) {
    if (!manifestActiveSet.has(relPath)) {
      violations.push({
        kind: "manifest_active_mismatch",
        message: `"${relPath}" is in getCampaignFiles() but is missing from campaigns.archive.json's "active" list.`,
      });
    }
  }
  for (const relPath of manifestActive) {
    if (!declaredFlatSet.has(relPath)) {
      violations.push({
        kind: "manifest_active_mismatch",
        message: `"${relPath}" is listed in campaigns.archive.json's "active" list but is not in getCampaignFiles().`,
      });
    }
  }

  // ── Duplicate declared filenames within the manifest's active list ────
  for (const [theater, filenames] of Object.entries(campaignFiles)) {
    const seen = new Set<string>();
    for (const filename of filenames) {
      if (seen.has(filename)) {
        violations.push({
          kind: "duplicate_declared_filename",
          message: `campaigns.archive.json's "active" list references "${theater}/${filename}" more than once.`,
        });
      }
      seen.add(filename);
    }
  }

  // ── Build the declared-file entry list, verifying existence ───────────
  const entries: FileEntry[] = [];
  const missingDeclaredFiles: string[] = [];
  const unreadableDeclaredFiles: string[] = [];
  const malformedDeclaredFiles: string[] = [];

  for (const [theater, filenames] of Object.entries(campaignFiles)) {
    for (const filename of filenames) {
      const relPath = `${theater}/${filename}`;
      const exists = onDiskIndex.has(relPath);
      if (!exists) {
        missingDeclaredFiles.push(relPath);
        violations.push({
          kind: "missing_declared_file",
          message: `Declared source "${relPath}" does not exist on disk.`,
        });
        entries.push({ theater, filename, relPath, declared: true, exists: false });
        continue;
      }

      const data = onDiskIndex.get(relPath);
      // The file exists but its content is unusable — distinct from
      // "missing": the physical file is present, so loadCampaignArchive()
      // does not (and should not) throw, but the content can't be used,
      // and must never be silently treated as "declared and present" the
      // way a genuinely healthy file would be. Without this check, a
      // corrupted or unreadable declared file would pass integrity while
      // quietly dropping out of declaredByTheater, letting an import
      // complete short by one record with no violation raised anywhere.
      //
      // Two distinct failure modes collapse to the same `data === undefined`
      // here, so readErrorPaths (sourced from loadCampaignArchive()'s own
      // readError flag) is what tells them apart — never guess "malformed
      // JSON" for a file that was never successfully read in the first
      // place (permission denied, removed between listing and reading,
      // other I/O error).
      if (data === undefined) {
        if (readErrorPaths.has(relPath)) {
          unreadableDeclaredFiles.push(relPath);
          violations.push({
            kind: "unreadable_declared_file",
            message: `Declared source "${relPath}" exists on disk but could not be read (permission denied, removed after listing, or another I/O error) — it will be silently excluded from the loaded archive unless this is resolved.`,
          });
        } else {
          malformedDeclaredFiles.push(relPath);
          violations.push({
            kind: "malformed_declared_file",
            message: `Declared source "${relPath}" exists on disk but could not be parsed as JSON — it will be silently excluded from the loaded archive unless this is resolved.`,
          });
        }
        entries.push({ theater, filename, relPath, declared: true, exists: true });
        continue;
      }

      const id = typeof data?.id === "string" ? data.id : undefined;
      const recordId = typeof data?.recordId === "string" ? data.recordId : undefined;

      const expectedId = filename.replace(/\.json$/, "");
      if (id !== undefined && id !== expectedId) {
        violations.push({
          kind: "filename_id_mismatch",
          message: `Declared source "${relPath}" has in-file id "${id}", which does not match its expected logical record "${expectedId}" (derived from the filename). This is the same class of bug that once let "uboat-campaing.json" silently shadow "uboat-campaign.json" — the file may be misfiled, or a stale/renamed copy.`,
        });
      }

      entries.push({ theater, filename, relPath, declared: true, exists: true, id, recordId });
    }
  }

  // ── Verify every manifest obsolete entry ───────────────────────────────
  const obsoleteFiles: ObsoleteFileInfo[] = [];
  const replacementMapping: ReplacementMappingEntry[] = [];
  for (const entry of manifestObsolete) {
    const { info, violations: entryViolations } = verifyObsoleteEntry(entry, onDiskIndex);
    obsoleteFiles.push(info);
    violations.push(...entryViolations);
    replacementMapping.push({ obsolete: entry.file, replacement: entry.replacedBy });
  }

  // ── Scan every file actually on disk, per declared theater, to find
  //    anything neither the manifest's active list nor its obsolete list
  //    accounts for. Sourced from archive.filesOnDisk — already scanned
  //    once by loadCampaignArchive() — rather than a fresh readdir here.
  //    Deliberately scoped to Object.keys(campaignFiles) only (not the
  //    possibly-larger set loadCampaignArchive() scanned to also cover
  //    obsolete-only theaters), matching this loop's original scope. ────
  const undeclaredFiles: string[] = [];
  let filesScanned = 0;

  for (const theater of Object.keys(campaignFiles)) {
    const declaredSet = new Set(campaignFiles[theater]);
    const onDisk = archive.filesOnDisk.filter((f) => f.theater === theater);
    for (const { filename, relPath, raw } of onDisk) {
      filesScanned++;
      if (declaredSet.has(filename)) continue;
      if (obsoleteFileSet.has(relPath)) continue; // classified via manifest, already verified above

      undeclaredFiles.push(relPath);
      const id = typeof raw?.id === "string" ? raw.id : undefined;
      const recordId = typeof raw?.recordId === "string" ? raw.recordId : undefined;
      entries.push({ theater, filename, relPath, declared: false, exists: true, id, recordId });

      violations.push({
        kind: "undeclared_file",
        message: `"${relPath}" exists on disk but is not in campaigns.archive.json's "active" list and is not listed in its "obsolete" entries — it is unaccounted for. If it represents a real campaign, add it to the manifest's "active" list; if it is a stale/replaced copy, add an entry for it under the manifest's "obsolete" array. Never leave it silently unclassified, and never edit the file itself to mark it — historical source files stay byte-identical to their original content.`,
      });
    }
  }

  // ── Duplicate detection across declared + undeclared-non-obsolete
  //    entries only — a verified manifest obsolete/replacement pair is
  //    expected to share an id and is excluded above. ───────────────────
  const existingEntries = entries.filter((e) => e.exists);

  function findDuplicates(keyFn: (e: FileEntry) => string | undefined): DuplicateGroup[] {
    const byKey = new Map<string, string[]>();
    for (const e of existingEntries) {
      const key = keyFn(e);
      if (!key) continue;
      const list = byKey.get(key) ?? [];
      list.push(e.relPath);
      byKey.set(key, list);
    }
    return [...byKey.entries()]
      .filter(([, files]) => files.length > 1)
      .map(([value, files]) => ({ value, files }));
  }

  const duplicateIds = findDuplicates((e) => e.id);
  const duplicateRecordIds = findDuplicates((e) => e.recordId);
  // For campaigns, Record.slug is always set from the in-file id (see
  // toRecordCreateInput: `slug: campaign.id`) — so "duplicate slugs" and
  // "duplicate ids" are the same underlying check, reported as its own
  // named field to match what a Record.slug uniqueness violation would
  // actually look like at the database level.
  const duplicateSlugs = duplicateIds;

  for (const group of duplicateIds) {
    const withRecordId = existingEntries.filter((e) => e.id === group.value && e.recordId);
    const withoutRecordId = existingEntries.filter((e) => e.id === group.value && !e.recordId);
    const detail = withRecordId.length && withoutRecordId.length
      ? ` "${withRecordId.map((e) => e.relPath).join(", ")}" has a recordId; "${withoutRecordId.map((e) => e.relPath).join(", ")}" does not — the copy without a recordId must never be silently chosen.`
      : "";
    violations.push({
      kind: "duplicate_id",
      message: `Multiple source files represent the same logical record (id "${group.value}"): ${group.files.join(", ")}.${detail} Neither is listed as obsolete in campaigns.archive.json — refusing to guess which is canonical.`,
    });
  }
  for (const group of duplicateRecordIds) {
    violations.push({
      kind: "duplicate_record_id",
      message: `Multiple source files carry the same recordId "${group.value}": ${group.files.join(", ")}. This must never happen — a recordId identifies exactly one database row.`,
    });
  }

  const passed = violations.length === 0;

  return {
    generatedAt: new Date().toISOString(),
    filesScanned,
    declaredFiles: entries.filter((e) => e.declared).length,
    activeFiles: entries.filter((e) => e.declared && e.exists).map((e) => e.relPath),
    obsoleteFiles,
    replacementMapping,
    duplicateIds,
    duplicateRecordIds,
    duplicateSlugs,
    undeclaredFiles,
    missingDeclaredFiles,
    unreadableDeclaredFiles,
    malformedDeclaredFiles,
    violations,
    passed,
  };
}

/**
 * Campaigns' implementation of the generic ArchiveIntegrityValidator
 * framework interface (archive-integrity-validator.ts). This is a thin
 * wrapper only — validate() calls the exact same
 * validateCampaignArchiveIntegrity() function above, verbatim, with zero
 * logic changes. All the campaign-specific rules (duplicate id/recordId/
 * slug detection, obsolete/replacement chain verification, filename
 * convention checks) live in that function, not here and not in the
 * generic framework, per the framework's own design: it defines the
 * contract, never the rules.
 */
export class CampaignArchiveIntegrityValidator implements ArchiveIntegrityValidator<CampaignArchiveIntegrityReport> {
  validate(): Promise<CampaignArchiveIntegrityReport> {
    return validateCampaignArchiveIntegrity();
  }
}

export const campaignArchiveIntegrityValidator = new CampaignArchiveIntegrityValidator();
