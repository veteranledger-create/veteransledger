// Narrow shape of the fields a generator/validator actually reads off a
// Prisma `Record` row. Deliberately not importing the generated `Record`
// model type — it shadows the global TS `Record<K, V>` utility type, and
// the rest of this codebase avoids that collision by typing loosely too.
export interface RecordLike {
  id: string;
  title: string;
  slug: string | null;
  summary: string | null;
  content: string | null;
  date: Date | null;
  nationality: string | null;
  tags: string[];
  metadata: Record<string, unknown> | null;
  published: boolean;
}

// Narrow shape of the fields a generator/validator actually reads off a
// Prisma `Entity` row — kept separate from RecordLike rather than merged or
// extended, since Entity's real columns (name, birthDate, deathDate,
// biography) don't correspond 1:1 to Record's (title, date, content).
// Personnel is the first content type to use this; any future Entity-typed
// content type should reuse it rather than reinventing a parallel shape.
export interface EntityLike {
  id: string;
  name: string;
  slug: string | null;
  nationality: string | null;
  birthDate: Date | null;
  deathDate: Date | null;
  summary: string | null;
  biography: string | null;
  metadata: Record<string, unknown> | null;
  tags: string[];
  published: boolean;
}

// "error" excludes a record from generation; "warning" is reported but the
// record still publishes — see letters.conformance.ts for which checks are
// which and why.
export type IssueSeverity = "error" | "warning";

export interface ValidationIssue {
  recordId: string;
  field: string;
  message: string;
  severity: IssueSeverity;
}

export interface ValidationStats {
  errorCount: number;
  warningCount: number;
  issuesByField: Record<string, number>;
}

export interface PublishReport {
  runId: string;
  type: string;
  mode: "validate" | "run";
  status: "success" | "failed";
  error?: string;
  generatedAt: string;
  recordsChecked: number;
  valid: number;
  invalid: number;
  issues: ValidationIssue[];
  stats: ValidationStats;
  staged: string[];
}
