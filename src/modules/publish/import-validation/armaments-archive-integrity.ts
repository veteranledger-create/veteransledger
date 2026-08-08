import { ArchiveIntegrityReport, ArchiveIntegrityViolation, ArchiveIntegrityValidator } from "./archive-integrity-validator";
import { armamentArchiveManifestProvider, ArmamentArchiveManifestObsoleteEntry } from "./armaments-archive-manifest-provider";
import { loadArmamentsArchive, LoadedArmamentsArchive } from "./armaments-archive-loader";
import { extractItems, assignIds, slugify, WRAPPER_KEY_BY_CATEGORY, AssignedArmament } from "./armament-record-mapper";

// Armaments' implementation of the generic archive-integrity framework
// (archive-integrity-validator.ts), analogous to
// campaigns-archive-integrity.ts but adapted to a genuinely different data
// model: an Armaments file holds an ARRAY of records (flat or
// wrapper-keyed), not one record per file, so duplicate detection and
// "does this file's content still exist somewhere" both operate over
// extracted items, never over files 1:1.
//
// This file never reads the filesystem itself — every fact it needs (the
// manifest, the declared active files, per-file raw content) comes from
// armamentArchiveManifestProvider and the LoadedArmamentsArchive Phase C's
// loadArmamentsArchive() already produced, either passed in by a caller
// that already loaded it, or loaded fresh here when called standalone.
//
// Record-shape validation (does a given extracted item have a usable
// id/title/summary) is NOT this module's job — that boundary belongs to
// armaments.conformance.ts's checkArmamentRecord(), unchanged, exactly as
// it already is for the currently-wired loadAllArmaments() path. This
// module is not wired into the importer yet (Phase E).

export type ArmamentIntegrityViolationKind =
  | "manifest_missing_or_unreadable"
  | "missing_declared_file"
  | "unreadable_declared_file"
  | "malformed_declared_file"
  | "wrong_shape_declared_file"
  | "undeclared_file"
  | "duplicate_id"
  | "duplicate_record_id"
  | "duplicate_slug"
  | "manifest_active_mismatch"
  | "manifest_duplicate_active"
  | "manifest_obsolete_also_active"
  | "duplicate_declared_filename"
  | "obsolete_source_missing"
  | "obsolete_replacement_missing"
  | "obsolete_replacement_incomplete";

export interface ArmamentArchiveIntegrityViolation extends ArchiveIntegrityViolation {
  kind: ArmamentIntegrityViolationKind;
}

export interface DuplicateGroup {
  value: string;
  /** Occurrence descriptors, "<relPath> (<name>)" — plain file paths alone
   *  can't disambiguate two colliding records living in the same file,
   *  which Campaigns' one-record-per-file model never had to represent. */
  files: string[];
}

export interface ReplacementMappingEntry {
  obsolete: string;
  replacement: string;
}

export interface ArmamentObsoleteFileInfo {
  relPath: string;
  replacedBy: string;
  reason: string;
  date?: string;
  notes?: string;
  sourceExists: boolean;
  replacementExists: boolean;
  /** Assigned ids of every record found in the obsolete source file. */
  sourceItemIds: string[];
  /** Assigned ids of every record found in the declared replacement file. */
  replacementItemIds: string[];
  /** Source item ids with no matching id among the replacement's items —
   *  the Armaments analog of Campaigns' single-id "sameLogicalRecord"
   *  check, generalized to a whole file's worth of records at once. */
  uncoveredSourceItems: string[];
  valid: boolean;
}

export interface ArmamentArchiveIntegrityReport extends ArchiveIntegrityReport {
  filesScanned: number;
  declaredFiles: number;
  activeFiles: string[];
  /**
   * Total records across every declared file — necessary because, unlike
   * Campaigns (one file = one record, so declaredFiles already answers
   * "how many records"), an Armaments file holds an array, so file count
   * and record count are genuinely different numbers a report consumer
   * needs both of.
   */
  totalDeclaredItems: number;
  obsoleteFiles: ArmamentObsoleteFileInfo[];
  replacementMapping: ReplacementMappingEntry[];
  duplicateIds: DuplicateGroup[];
  duplicateRecordIds: DuplicateGroup[];
  duplicateSlugs: DuplicateGroup[];
  undeclaredFiles: string[];
  missingDeclaredFiles: string[];
  unreadableDeclaredFiles: string[];
  malformedDeclaredFiles: string[];
  /**
   * Declared files that parsed as valid JSON but match neither container
   * shape extractItems() understands (not a flat array, not an object
   * holding the category's wrapper key as an array). Necessary because,
   * for Armaments specifically, extractItems() safely degrades this case
   * to zero items with no exception — and with zero items extracted,
   * conformance never runs on anything for that file either, unlike
   * Campaigns where even a malformed single "record" still reached
   * checkCampaignRecord() as a placeholder. Without this check, a
   * wrong-shape declared file would silently drop out of the archive with
   * passed:true and no signal anywhere — the same class of bug
   * malformed_declared_file/unreadable_declared_file were added to close.
   */
  wrongShapeDeclaredFiles: string[];
  violations: ArmamentArchiveIntegrityViolation[];
}

function idsFromRaw(raw: unknown, category: string): string[] {
  const { items } = extractItems(raw === null ? [] : raw, category);
  return items.map((item) => (typeof item.id === "string" ? item.id : slugify(item.name)));
}

function isRecognizedContainerShape(raw: unknown, category: string): boolean {
  // null is deliberately excluded from "wrong shape" — it is already its
  // own, explicitly handled case (the loader coerces it to [] before
  // extractItems(), the same minimal strategy Campaigns uses), not a
  // genuinely-unrecognized shape with no other story. Campaigns' own
  // integrity layer never flags null as a violation either — a null (or
  // property-less) record silently degrades to "no id, no title" there,
  // consistently. Bare numbers/strings/wrapper-key-less objects have no
  // such explicit handling anywhere else, which is exactly why they still
  // need to be flagged here.
  if (raw === null) return true;
  if (Array.isArray(raw)) return true;
  if (typeof raw !== "object") return false;
  const wrapperKey = WRAPPER_KEY_BY_CATEGORY[category];
  return Array.isArray((raw as Record<string, unknown>)[wrapperKey]);
}

// Verifies a manifest obsolete-entry's claim rather than trusting it: the
// source file itself must exist, its declared replacement must exist, and
// every record found in the source must have a matching id somewhere
// among the replacement's records. No real Armaments obsolete entry
// exists yet (Phase A's manifest declares zero), so this logic has no
// production precedent to calibrate against — it is a deliberately lean,
// documented, testable adaptation of Campaigns' equivalent check, ready
// for whenever a real entry is added.
function verifyObsoleteEntry(
  entry: ArmamentArchiveManifestObsoleteEntry,
  onDiskIndex: Map<string, unknown>,
): { info: ArmamentObsoleteFileInfo; violations: ArmamentArchiveIntegrityViolation[] } {
  const violations: ArmamentArchiveIntegrityViolation[] = [];

  const sourceExists = onDiskIndex.has(entry.file);
  if (!sourceExists) {
    violations.push({
      kind: "obsolete_source_missing",
      message: `armaments.archive.json lists "${entry.file}" as obsolete, but that file does not exist on disk.`,
    });
  }
  const replacementExists = onDiskIndex.has(entry.replacedBy);
  if (!replacementExists) {
    violations.push({
      kind: "obsolete_replacement_missing",
      message: `armaments.archive.json declares "${entry.file}" replaced by "${entry.replacedBy}", but "${entry.replacedBy}" does not exist on disk.`,
    });
  }

  const sourceCategory = entry.file.slice(0, entry.file.indexOf("/"));
  const replacementCategory = entry.replacedBy.slice(0, entry.replacedBy.indexOf("/"));
  const sourceItemIds = sourceExists ? idsFromRaw(onDiskIndex.get(entry.file), sourceCategory) : [];
  const replacementItemIds = replacementExists ? idsFromRaw(onDiskIndex.get(entry.replacedBy), replacementCategory) : [];
  const uncoveredSourceItems = sourceItemIds.filter((id) => !replacementItemIds.includes(id));

  if (sourceExists && replacementExists && uncoveredSourceItems.length > 0) {
    violations.push({
      kind: "obsolete_replacement_incomplete",
      message: `"${entry.file}" has record(s) (${uncoveredSourceItems.join(", ")}) not found among "${entry.replacedBy}"'s records — the declared replacement does not fully cover the obsolete file's content.`,
    });
  }

  const valid = sourceExists && replacementExists && uncoveredSourceItems.length === 0;
  return {
    info: {
      relPath: entry.file,
      replacedBy: entry.replacedBy,
      reason: entry.reason,
      date: entry.date,
      notes: entry.notes,
      sourceExists,
      replacementExists,
      sourceItemIds,
      replacementItemIds,
      uncoveredSourceItems,
      valid,
    },
    violations,
  };
}

// Pure — reads the filesystem only via loadArmamentsArchive(), never
// touches Prisma. Safe to call at any time, including from preview/dry-run
// paths that must never have DB side effects.
export async function validateArmamentArchiveIntegrity(preloaded?: LoadedArmamentsArchive): Promise<ArmamentArchiveIntegrityReport> {
  const violations: ArmamentArchiveIntegrityViolation[] = [];
  const archive = preloaded ?? await loadArmamentsArchive();

  const onDiskIndex = new Map<string, unknown>();
  const readErrorPaths = new Set<string>();
  for (const entry of archive.filesOnDisk) {
    onDiskIndex.set(entry.relPath, entry.raw);
    if (entry.readError) readErrorPaths.add(entry.relPath);
  }

  const loadError = armamentArchiveManifestProvider.getLoadError();
  if (loadError) {
    violations.push({ kind: "manifest_missing_or_unreadable", message: loadError });
  }
  const manifest = armamentArchiveManifestProvider.getManifest();
  const manifestActive = manifest.active;
  const manifestObsolete = manifest.obsolete;
  const armamentFiles = armamentArchiveManifestProvider.getArmamentFiles();

  // ── Manifest self-consistency ───────────────────────────────────────
  const manifestActiveSeen = new Set<string>();
  for (const relPath of manifestActive) {
    if (manifestActiveSeen.has(relPath)) {
      violations.push({ kind: "manifest_duplicate_active", message: `armaments.archive.json lists "${relPath}" in "active" more than once.` });
    }
    manifestActiveSeen.add(relPath);
  }

  const obsoleteFileSet = new Set(manifestObsolete.map((o) => o.file));
  for (const relPath of manifestActive) {
    if (obsoleteFileSet.has(relPath)) {
      violations.push({ kind: "manifest_obsolete_also_active", message: `armaments.archive.json lists "${relPath}" in both "active" and "obsolete" — a file cannot be both.` });
    }
  }

  const declaredFlat = Object.entries(armamentFiles).flatMap(([category, filenames]) => filenames.map((f) => `${category}/${f}`));
  const declaredFlatSet = new Set(declaredFlat);
  const manifestActiveSet = new Set(manifestActive);
  for (const relPath of declaredFlat) {
    if (!manifestActiveSet.has(relPath)) {
      violations.push({ kind: "manifest_active_mismatch", message: `"${relPath}" is in getArmamentFiles() but is missing from armaments.archive.json's "active" list.` });
    }
  }
  for (const relPath of manifestActive) {
    if (!declaredFlatSet.has(relPath)) {
      violations.push({ kind: "manifest_active_mismatch", message: `"${relPath}" is listed in armaments.archive.json's "active" list but is not in getArmamentFiles().` });
    }
  }

  for (const [category, filenames] of Object.entries(armamentFiles)) {
    const seen = new Set<string>();
    for (const filename of filenames) {
      if (seen.has(filename)) {
        violations.push({ kind: "duplicate_declared_filename", message: `armaments.archive.json's "active" list references "${category}/${filename}" more than once.` });
      }
      seen.add(filename);
    }
  }

  // ── Build the declared-file list, verifying existence, readability,
  //    and container shape ────────────────────────────────────────────
  const missingDeclaredFiles: string[] = [];
  const unreadableDeclaredFiles: string[] = [];
  const malformedDeclaredFiles: string[] = [];
  const wrongShapeDeclaredFiles: string[] = [];
  const activeFiles: string[] = [];
  let declaredFilesCount = 0;

  for (const [category, filenames] of Object.entries(armamentFiles)) {
    for (const filename of filenames) {
      declaredFilesCount++;
      const relPath = `${category}/${filename}`;
      const exists = onDiskIndex.has(relPath);
      if (!exists) {
        missingDeclaredFiles.push(relPath);
        violations.push({ kind: "missing_declared_file", message: `Declared source "${relPath}" does not exist on disk.` });
        continue;
      }

      const raw = onDiskIndex.get(relPath);
      if (raw === undefined) {
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
        continue;
      }

      activeFiles.push(relPath);

      if (!isRecognizedContainerShape(raw, category)) {
        const wrapperKey = WRAPPER_KEY_BY_CATEGORY[category];
        wrongShapeDeclaredFiles.push(relPath);
        violations.push({
          kind: "wrong_shape_declared_file",
          message: `Declared source "${relPath}" parsed as valid JSON but is neither a flat array nor an object with a "${wrapperKey}" array — it will silently contribute zero records unless this is resolved.`,
        });
      }
    }
  }

  // ── Verify every manifest obsolete entry ────────────────────────────
  const obsoleteFiles: ArmamentObsoleteFileInfo[] = [];
  const replacementMapping: ReplacementMappingEntry[] = [];
  for (const entry of manifestObsolete) {
    const { info, violations: entryViolations } = verifyObsoleteEntry(entry, onDiskIndex);
    obsoleteFiles.push(info);
    violations.push(...entryViolations);
    replacementMapping.push({ obsolete: entry.file, replacement: entry.replacedBy });
  }

  // ── Scan every file on disk, per declared category, for anything the
  //    manifest doesn't account for ───────────────────────────────────
  const undeclaredFiles: string[] = [];
  let filesScanned = 0;
  for (const category of Object.keys(armamentFiles)) {
    const declaredSet = new Set(armamentFiles[category]);
    const onDisk = archive.filesOnDisk.filter((f) => f.category === category);
    for (const { fileNation, relPath } of onDisk) {
      filesScanned++;
      const filename = `${fileNation}.json`;
      if (declaredSet.has(filename)) continue;
      if (obsoleteFileSet.has(relPath)) continue; // classified via manifest, already verified above

      undeclaredFiles.push(relPath);
      violations.push({
        kind: "undeclared_file",
        message: `"${relPath}" exists on disk but is not in armaments.archive.json's "active" list and is not listed in its "obsolete" entries — it is unaccounted for. If it represents real armament records, add it to the manifest's "active" list; if it is a stale/replaced copy, add an entry for it under the manifest's "obsolete" array.`,
      });
    }
  }

  // ── Duplicate detection across every extracted item from declared
  //    files — an Armaments file can hold many records, so two colliding
  //    ids can live in the same file, not just across files. ──────────
  const assigned: AssignedArmament[] = assignIds(archive.declaredItems);

  function findDuplicates(keyFn: (a: AssignedArmament) => string | undefined): DuplicateGroup[] {
    const byKey = new Map<string, { relPath: string; name: string }[]>();
    for (const a of assigned) {
      const key = keyFn(a);
      if (!key) continue;
      const relPath = `${a.category}/${a.fileNation}.json`;
      const list = byKey.get(key) ?? [];
      list.push({ relPath, name: a.item.name });
      byKey.set(key, list);
    }
    return [...byKey.entries()]
      .filter(([, occurrences]) => occurrences.length > 1)
      .map(([value, occurrences]) => ({ value, files: occurrences.map((o) => `${o.relPath} (${o.name})`) }));
  }

  const duplicateIds = findDuplicates((a) => a.id);
  const duplicateRecordIds = findDuplicates((a) => (typeof a.item.recordId === "string" ? a.item.recordId : undefined));
  // Record.slug is always set from the assigned id (toRecordCreateInput:
  // slug: id) — same underlying check as duplicateIds, same convention
  // Campaigns uses for its own duplicateSlugs field.
  const duplicateSlugs = duplicateIds;

  for (const group of duplicateIds) {
    violations.push({
      kind: "duplicate_id",
      message: `Multiple records represent the same logical id "${group.value}": ${group.files.join(", ")}. Refusing to guess which is canonical.`,
    });
  }
  for (const group of duplicateRecordIds) {
    violations.push({
      kind: "duplicate_record_id",
      message: `Multiple records carry the same recordId "${group.value}": ${group.files.join(", ")}. This must never happen — a recordId identifies exactly one database row.`,
    });
  }

  const passed = violations.length === 0;

  return {
    generatedAt: new Date().toISOString(),
    filesScanned,
    declaredFiles: declaredFilesCount,
    activeFiles,
    totalDeclaredItems: archive.declaredItems.length,
    obsoleteFiles,
    replacementMapping,
    duplicateIds,
    duplicateRecordIds,
    duplicateSlugs,
    undeclaredFiles,
    missingDeclaredFiles,
    unreadableDeclaredFiles,
    malformedDeclaredFiles,
    wrongShapeDeclaredFiles,
    violations,
    passed,
  };
}

/**
 * Armaments' implementation of the generic ArchiveIntegrityValidator
 * framework interface (archive-integrity-validator.ts). Thin wrapper only
 * — validate() calls the exact same validateArmamentArchiveIntegrity()
 * function above, verbatim. All the armaments-specific rules live in that
 * function, not here and not in the generic framework.
 */
export class ArmamentArchiveIntegrityValidator implements ArchiveIntegrityValidator<ArmamentArchiveIntegrityReport> {
  validate(): Promise<ArmamentArchiveIntegrityReport> {
    return validateArmamentArchiveIntegrity();
  }
}

export const armamentArchiveIntegrityValidator = new ArmamentArchiveIntegrityValidator();
