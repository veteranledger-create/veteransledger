/**
 * Converts a string to a URL-safe slug.
 * Handles German umlauts and common diacritics.
 */
export function slugify(input: string): string {
  return input
    .toLowerCase()
    .replace(/ä/g, "ae")
    .replace(/ö/g, "oe")
    .replace(/ü/g, "ue")
    .replace(/ß/g, "ss")
    .replace(/[àáâãå]/g, "a")
    .replace(/[èéêë]/g, "e")
    .replace(/[ìíîï]/g, "i")
    .replace(/[òóôõ]/g, "o")
    .replace(/[ùúûü]/g, "u")
    .replace(/[ñ]/g, "n")
    .replace(/[^a-z0-9\s-]/g, "")
    .trim()
    .replace(/[\s_]+/g, "-")
    .replace(/-{2,}/g, "-");
}

/** Extracts a 4-digit year (1900–1950) from a date string. */
export function extractYear(dateStr: string): number | null {
  const match = dateStr.match(/\b(19[0-4]\d)\b/);
  return match ? parseInt(match[1], 10) : null;
}

/** Returns the first N words of a string as a summary excerpt. */
export function excerpt(text: string, words = 40): string {
  const parts = text.trim().split(/\s+/);
  if (parts.length <= words) return text;
  return parts.slice(0, words).join(" ") + "…";
}
