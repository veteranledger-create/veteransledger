import { ROUTE_MAP, TYPE_ALIASES, CanonicalType } from "../../shared/route-definitions";

export function normalizeType(type: string | undefined): CanonicalType | string {
  if (!type) return "Letter";
  return TYPE_ALIASES[type] ?? type;
}

export function resolveRelatedUrl(type: string | undefined, id: string): string {
  const canonical = normalizeType(type);
  const prefix = (ROUTE_MAP as Record<string, string>)[canonical] ?? "/letters";
  return `${prefix}/${id}`;
}

// Re-export the canonical definitions so callers that need the raw map
// (e.g. tests, admin endpoints) don't need a second import.
export { ROUTE_MAP, TYPE_ALIASES };
export type { CanonicalType };
