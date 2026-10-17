import path from "path";

/**
 * One implementation of "turn an untrusted relative path into a real path
 * underneath a root I control."
 *
 * Two separate incidents motivated this. Snapshot manifests written on
 * Windows recorded their keys with backslashes, which are not separators on
 * Linux, so a naive join looked for a single file literally named
 * "naval\germany.json". And several modules each hand-rolled their own
 * containment check, with slightly different holes in each.
 *
 * Both separators are accepted interchangeably; the canonical stored form is
 * always POSIX so that a path written on one platform resolves on the other.
 */

/**
 * Splits a relative path into safe segments, rejecting anything that could
 * address a file outside its intended root. Accepts "/" and "\"
 * interchangeably and tolerates repeated separators.
 */
export function splitRelativePath(input: string, label = "path"): string[] {
  if (typeof input !== "string" || input.trim() === "") {
    throw new Error(`Invalid ${label}: must be a non-empty string`);
  }
  // Absolute in either convention: "/x", "\x", "C:/x", "C:\x".
  if (/^([A-Za-z]:)?[\\/]/.test(input)) {
    throw new Error(`Invalid ${label}: absolute paths are not permitted ("${input}")`);
  }
  const segments = input.split(/[\\/]+/).filter((s) => s !== "" && s !== ".");
  if (segments.length === 0) {
    throw new Error(`Invalid ${label}: resolves to no path ("${input}")`);
  }
  if (segments.includes("..")) {
    throw new Error(`Invalid ${label}: path traversal is not permitted ("${input}")`);
  }
  return segments;
}

/** Portable storage form: POSIX separators, no redundant segments. */
export function normalizeRelativePath(input: string, label = "path"): string {
  return splitRelativePath(input, label).join("/");
}

/**
 * Resolves a relative path against a root using the host's own separator,
 * with a final containment check as defence in depth — the result may only
 * ever be the root itself or something inside it.
 */
export function resolveWithin(root: string, input: string, label = "path"): string {
  const resolvedRoot = path.resolve(root);
  const full = path.resolve(resolvedRoot, ...splitRelativePath(input, label));
  if (full !== resolvedRoot && !full.startsWith(resolvedRoot + path.sep)) {
    throw new Error(`Invalid ${label}: escapes its root ("${input}")`);
  }
  return full;
}
