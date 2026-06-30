/**
 * Single source of truth for all record-type → URL-path mappings.
 *
 * Rule: every new record type that has public record pages MUST get an entry
 * in ROUTE_MAP before anything else. TypeScript enforces this automatically:
 *   - `CanonicalType` is derived as `keyof typeof ROUTE_MAP`
 *   - `TYPE_ALIASES` values are typed as `CanonicalType`
 *   → Adding an alias that maps to a non-existent key is a compile error.
 *
 * After adding a route, regenerate the client-side resolver:
 *   npm run generate:routes
 */

// Primary mapping: canonical type name → URL path prefix.
// Keys define the complete set of routable record types.
export const ROUTE_MAP = {
  Campaign:         "/campaigns",
  Personnel:        "/personnel",
  Armament:         "/armaments",
  Formation:        "/formations",
  Article:          "/articles",
  Letter:           "/letters",
  Award:            "/awards",
  Map:              "/maps",
  PoliticalDocument:"/political-documents",
} as const;

// Derived types — never list these separately; always derive from ROUTE_MAP.
export type CanonicalType = keyof typeof ROUTE_MAP;
export type RoutePath     = (typeof ROUTE_MAP)[CanonicalType];

// All non-canonical forms that must resolve to a canonical type.
// Values are typed as CanonicalType → adding a value not in ROUTE_MAP fails at compile time.
export const TYPE_ALIASES: Record<string, CanonicalType> = {
  // DB enum uppercase values
  CAMPAIGN:          "Campaign",
  PERSON:            "Personnel",
  ARMAMENT:          "Armament",
  FORMATION:         "Formation",
  ARTICLE:           "Article",
  LETTER:            "Letter",
  AWARD:             "Award",
  MAP:               "Map",
  POLITICAL_DOCUMENT:"PoliticalDocument",

  // Letter collection name strings from legacy imported data
  "German Collection":     "Letter",
  "Italian Collection":    "Letter",
  "Japanese Collection":   "Letter",
  "British Collection":    "Letter",
  "Polish Collection":     "Letter",
  "Volunteers Collection": "Letter",
};
