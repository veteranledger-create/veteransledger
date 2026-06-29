import { ValidationIssue } from "../publish.types";

const KNOWN_CATEGORIES = ["political", "military", "economic", "social", "diplomatic", "other"];

export interface TimelineEventRow {
  id: string;
  year: number | null;
  date: Date | null;
  endDate: Date | null;
  title: string;
  summary: string | null;
  category: string | null;
  location: string | null;
  significance: string | null;
  metadata: unknown;
  published: boolean;
}

export function toTimelineJson(ev: TimelineEventRow): Record<string, unknown> {
  const meta = (ev.metadata as Record<string, unknown> | null) ?? {};
  return {
    id: ev.id,
    year: ev.year ?? ev.date?.getFullYear() ?? null,
    date: ev.date ? ev.date.toISOString().slice(0, 10) : null,
    endDate: ev.endDate ? ev.endDate.toISOString().slice(0, 10) : null,
    category: ev.category ?? null,
    title: ev.title,
    summary: ev.summary ?? null,
    location: ev.location ?? null,
    significance: ev.significance ?? null,
    sources: (meta.sources as unknown[]) ?? [],
    related_records: (meta.related_records as unknown[]) ?? [],
  };
}

export function checkTimelineEvent(event: TimelineEventRow): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const pushError = (field: string, message: string) =>
    issues.push({ recordId: event.id, field, message, severity: "error" });
  const pushWarning = (field: string, message: string) =>
    issues.push({ recordId: event.id, field, message, severity: "warning" });

  if (!event.title?.trim()) pushError("title", "Timeline event must have a title.");

  if (!event.year && !event.date) {
    pushWarning("year", "Event has no year or date — it may not appear in year-filtered views.");
  }

  if (event.category && !KNOWN_CATEGORIES.includes(event.category)) {
    pushWarning(
      "category",
      `Unknown category "${event.category}" — it won't match standard category filters (${KNOWN_CATEGORIES.join(", ")}).`,
    );
  }

  const meta = (event.metadata as Record<string, unknown> | null) ?? {};
  const sources = meta.sources;
  if (sources !== undefined && !Array.isArray(sources)) {
    pushWarning("sources", "metadata.sources must be an array when present.");
  }

  const related = meta.related_records;
  if (related !== undefined && !Array.isArray(related)) {
    pushWarning("related_records", "metadata.related_records must be an array when present.");
  }

  return issues;
}
