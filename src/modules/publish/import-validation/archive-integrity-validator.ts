// Generic framework — the common shape every archive type's integrity
// report and validator share. Deliberately minimal: everything that's
// actually archive-specific (what counts as a duplicate, how a
// replacement is verified, filename conventions) belongs in each archive
// type's own report/validator, not here. This file defines the contract,
// not the rules.

export interface ArchiveIntegrityViolation {
  kind: string;
  message: string;
}

export interface ArchiveIntegrityReport {
  generatedAt: string;
  violations: ArchiveIntegrityViolation[];
  passed: boolean;
}

export interface ArchiveIntegrityValidator<TReport extends ArchiveIntegrityReport = ArchiveIntegrityReport> {
  validate(): Promise<TReport> | TReport;
}
