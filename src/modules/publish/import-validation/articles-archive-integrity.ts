import { ArchiveIntegrityReport, ArchiveIntegrityViolation, ArchiveIntegrityValidator } from "./archive-integrity-validator";
import { articleArchiveManifestProvider, ArticleArchiveManifestObsoleteEntry } from "./articles-archive-manifest-provider";
import { loadArticlesArchive, LoadedArticlesArchive } from "./articles-archive-loader";

// Articles' implementation of the generic archive-integrity framework
// (archive-integrity-validator.ts), following campaigns-archive-integrity.ts
// closely — Articles, like Campaigns, is one record per file, so
// duplicate detection and obsolete/replacement verification both compare
// single records file-to-file, with none of Armaments' multi-record-per-
// file extraction complexity.
//
// This file never reads the filesystem itself — every fact it needs (the
// manifest, the declared active files, per-file raw content) comes from
// articleArchiveManifestProvider and the LoadedArticlesArchive Phase C's
// loadArticlesArchive() already produced, either passed in by a caller
// that already loaded it, or loaded fresh here when called standalone.
//
// Record-shape validation (does a given article have a usable
// id/title/summary/body) is NOT this module's job — that boundary
// belongs to articles.conformance.ts's checkArticleRecord(), unchanged.
// Unlike Armaments, this module does NOT add a "wrong shape JSON"
// violation kind: because Articles is one-record-per-file, a
// wrong-shape declared file (a bare number, a bare array, an object
// missing every known field) still produces exactly one "record" that
// safely reaches conformance downstream — property access on any
// non-null JS value returns undefined rather than throwing, so
// checkArticleRecord()'s existing "Record id is missing"/"must have a
// title" checks already catch it there, the same boundary Campaigns
// established and never needed to duplicate. Armaments needed the extra
// check only because its extractItems() step can silently yield zero
// records for a wrong-shape file, meaning conformance never runs on
// anything at all in that case — a failure mode that structurally
// cannot happen here.
//
// This module is not wired into the importer yet (Phase E).

export type ArticleIntegrityViolationKind =
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

export interface ArticleArchiveIntegrityViolation extends ArchiveIntegrityViolation {
  kind: ArticleIntegrityViolationKind;
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

export interface ArticleArchiveIntegrityReport extends ArchiveIntegrityReport {
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
  violations: ArticleArchiveIntegrityViolation[];
}

interface FileEntry {
  category: string;
  filename: string;
  relPath: string;
  declared: boolean;
  exists: boolean;
  id?: string;
  recordId?: string;
}

// raw is `unknown` here (Phase C's loader is deliberately permissive about
// top-level shape, unlike Campaigns' Record<string,unknown>|undefined) —
// this is the one small, necessary adaptation: a typed field reader that
// never throws regardless of raw's actual shape (null, a primitive, an
// array, or a proper object), instead of Campaigns' inline `data?.field`
// optional-chaining (which relied on a narrower loader type).
function readStringField(raw: unknown, field: string): string | undefined {
  if (raw === null || typeof raw !== "object") return undefined;
  const value = (raw as Record<string, unknown>)[field];
  return typeof value === "string" ? value : undefined;
}

// Verifies a manifest obsolete-entry's claim rather than trusting it: the
// source file itself must exist, its declared replacement must exist,
// both must represent the same logical record (same in-file id), and the
// replacement must carry the canonical recordId the obsolete copy lacks.
// No real Articles obsolete entry exists yet (Phase A's manifest declares
// zero), so this logic has no production precedent to calibrate against
// — it mirrors Campaigns' equivalent check exactly, since both archives
// share the identical one-record-per-file model.
function verifyObsoleteEntry(entry: ArticleArchiveManifestObsoleteEntry, onDiskIndex: Map<string, unknown>): { info: ObsoleteFileInfo; violations: ArticleArchiveIntegrityViolation[] } {
  const violations: ArticleArchiveIntegrityViolation[] = [];

  const sourceExists = onDiskIndex.has(entry.file);
  if (!sourceExists) {
    violations.push({
      kind: "obsolete_source_missing",
      message: `articles.archive.json lists "${entry.file}" as obsolete, but that file does not exist on disk.`,
    });
  }
  const sourceData = sourceExists ? onDiskIndex.get(entry.file) : undefined;
  const id = readStringField(sourceData, "id");

  const replacementExists = onDiskIndex.has(entry.replacedBy);
  if (!replacementExists) {
    violations.push({
      kind: "obsolete_replacement_missing",
      message: `articles.archive.json declares "${entry.file}" replaced by "${entry.replacedBy}", but "${entry.replacedBy}" does not exist on disk.`,
    });
  }
  const replacementData = replacementExists ? onDiskIndex.get(entry.replacedBy) : undefined;
  const replacementId = readStringField(replacementData, "id");
  const replacementRecordId = readStringField(replacementData, "recordId");

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

// Pure — reads the filesystem only via loadArticlesArchive(), never
// touches Prisma. Safe to call at any time, including from preview/dry-run
// paths that must never have DB side effects.
export async function validateArticleArchiveIntegrity(preloaded?: LoadedArticlesArchive): Promise<ArticleArchiveIntegrityReport> {
  const violations: ArticleArchiveIntegrityViolation[] = [];
  const archive = preloaded ?? await loadArticlesArchive();

  const onDiskIndex = new Map<string, unknown>();
  const readErrorPaths = new Set<string>();
  for (const entry of archive.filesOnDisk) {
    onDiskIndex.set(entry.relPath, entry.raw);
    if (entry.readError) readErrorPaths.add(entry.relPath);
  }

  const loadError = articleArchiveManifestProvider.getLoadError();
  if (loadError) {
    violations.push({ kind: "manifest_missing_or_unreadable", message: loadError });
  }
  const manifest = articleArchiveManifestProvider.getManifest();
  const manifestActive = manifest.active;
  const manifestObsolete = manifest.obsolete;
  const articleFiles = articleArchiveManifestProvider.getArticleFiles();

  // ── Manifest self-consistency ───────────────────────────────────────
  const manifestActiveSeen = new Set<string>();
  for (const relPath of manifestActive) {
    if (manifestActiveSeen.has(relPath)) {
      violations.push({ kind: "manifest_duplicate_active", message: `articles.archive.json lists "${relPath}" in "active" more than once.` });
    }
    manifestActiveSeen.add(relPath);
  }

  const obsoleteFileSet = new Set(manifestObsolete.map((o) => o.file));
  for (const relPath of manifestActive) {
    if (obsoleteFileSet.has(relPath)) {
      violations.push({ kind: "manifest_obsolete_also_active", message: `articles.archive.json lists "${relPath}" in both "active" and "obsolete" — a file cannot be both.` });
    }
  }

  const declaredFlat = Object.entries(articleFiles).flatMap(([category, filenames]) => filenames.map((f) => `${category}/${f}`));
  const declaredFlatSet = new Set(declaredFlat);
  const manifestActiveSet = new Set(manifestActive);
  for (const relPath of declaredFlat) {
    if (!manifestActiveSet.has(relPath)) {
      violations.push({ kind: "manifest_active_mismatch", message: `"${relPath}" is in getArticleFiles() but is missing from articles.archive.json's "active" list.` });
    }
  }
  for (const relPath of manifestActive) {
    if (!declaredFlatSet.has(relPath)) {
      violations.push({ kind: "manifest_active_mismatch", message: `"${relPath}" is listed in articles.archive.json's "active" list but is not in getArticleFiles().` });
    }
  }

  for (const [category, filenames] of Object.entries(articleFiles)) {
    const seen = new Set<string>();
    for (const filename of filenames) {
      if (seen.has(filename)) {
        violations.push({ kind: "duplicate_declared_filename", message: `articles.archive.json's "active" list references "${category}/${filename}" more than once.` });
      }
      seen.add(filename);
    }
  }

  // ── Build the declared-file entry list, verifying existence ───────────
  const entries: FileEntry[] = [];
  const missingDeclaredFiles: string[] = [];
  const unreadableDeclaredFiles: string[] = [];
  const malformedDeclaredFiles: string[] = [];

  for (const [category, filenames] of Object.entries(articleFiles)) {
    for (const filename of filenames) {
      const relPath = `${category}/${filename}`;
      const exists = onDiskIndex.has(relPath);
      if (!exists) {
        missingDeclaredFiles.push(relPath);
        violations.push({ kind: "missing_declared_file", message: `Declared source "${relPath}" does not exist on disk.` });
        entries.push({ category, filename, relPath, declared: true, exists: false });
        continue;
      }

      const data = onDiskIndex.get(relPath);
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
        entries.push({ category, filename, relPath, declared: true, exists: true });
        continue;
      }

      const id = readStringField(data, "id");
      const recordId = readStringField(data, "recordId");

      const expectedId = filename.replace(/\.json$/, "");
      if (id !== undefined && id !== expectedId) {
        violations.push({
          kind: "filename_id_mismatch",
          message: `Declared source "${relPath}" has in-file id "${id}", which does not match its expected logical record "${expectedId}" (derived from the filename) — the file may be misfiled, or a stale/renamed copy.`,
        });
      }

      entries.push({ category, filename, relPath, declared: true, exists: true, id, recordId });
    }
  }

  // ── Verify every manifest obsolete entry ────────────────────────────
  const obsoleteFiles: ObsoleteFileInfo[] = [];
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
  for (const category of Object.keys(articleFiles)) {
    const declaredSet = new Set(articleFiles[category]);
    const onDisk = archive.filesOnDisk.filter((f) => f.category === category);
    for (const { relPath } of onDisk) {
      filesScanned++;
      const filename = relPath.slice(relPath.indexOf("/") + 1);
      if (declaredSet.has(filename)) continue;
      if (obsoleteFileSet.has(relPath)) continue; // classified via manifest, already verified above

      undeclaredFiles.push(relPath);
      const raw = onDiskIndex.get(relPath);
      const id = readStringField(raw, "id");
      const recordId = readStringField(raw, "recordId");
      entries.push({ category, filename, relPath, declared: false, exists: true, id, recordId });

      violations.push({
        kind: "undeclared_file",
        message: `"${relPath}" exists on disk but is not in articles.archive.json's "active" list and is not listed in its "obsolete" entries — it is unaccounted for. If it represents a real article, add it to the manifest's "active" list; if it is a stale/replaced copy, add an entry for it under the manifest's "obsolete" array.`,
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
  // Record.slug is always set from the in-file id (toRecordCreateInput:
  // slug: article.id) — same underlying check as duplicateIds, same
  // convention Campaigns' and Armaments' reports both use.
  const duplicateSlugs = duplicateIds;

  for (const group of duplicateIds) {
    violations.push({
      kind: "duplicate_id",
      message: `Multiple source files represent the same logical record (id "${group.value}"): ${group.files.join(", ")}. Neither is listed as obsolete in articles.archive.json — refusing to guess which is canonical.`,
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
 * Articles' implementation of the generic ArchiveIntegrityValidator
 * framework interface (archive-integrity-validator.ts). Thin wrapper only
 * — validate() calls the exact same validateArticleArchiveIntegrity()
 * function above, verbatim. All the articles-specific rules live in that
 * function, not here and not in the generic framework.
 */
export class ArticleArchiveIntegrityValidator implements ArchiveIntegrityValidator<ArticleArchiveIntegrityReport> {
  validate(): Promise<ArticleArchiveIntegrityReport> {
    return validateArticleArchiveIntegrity();
  }
}

export const articleArchiveIntegrityValidator = new ArticleArchiveIntegrityValidator();
