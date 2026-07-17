// TimelineEvent is the one content type where the published JSON's "id"
// field already IS the real database primary key (toTimelineJson in
// timeline.conformance.ts writes `id: ev.id` directly, not a separate
// slug) — so recovery can preserve the original id exactly, not just a
// slug, whenever the source has one.

export interface LegacyTimelineEvent {
  id?: string;
  year?: number | null;
  date?: string | null;
  endDate?: string | null;
  category?: string | null;
  title: string;
  summary?: string | null;
  location?: string | null;
  significance?: string | null;
  sources?: unknown;
  related_records?: unknown;
}

export function toTimelineEventCreateInput(event: LegacyTimelineEvent) {
  const hasId = typeof event.id === "string" && event.id.trim().length > 0;
  return {
    ...(hasId ? { id: event.id } : {}),
    year: event.year ?? (event.date ? new Date(event.date).getFullYear() : null),
    date: event.date ? new Date(event.date) : null,
    endDate: event.endDate ? new Date(event.endDate) : null,
    title: event.title,
    summary: event.summary ?? null,
    category: event.category ?? null,
    location: event.location ?? null,
    significance: event.significance ?? null,
    published: true,
    metadata: {
      sources: event.sources ?? [],
      related_records: event.related_records ?? [],
    },
  };
}

// Natural key for events with no preserved id — mirrors the pre-existing
// scripts/import-timeline.js's own idempotency key, kept identical rather
// than inventing a different rule for the fallback path.
export function fallbackNaturalKey(event: LegacyTimelineEvent): string {
  return `${event.year ?? ""}::${event.title}`;
}
