/**
 * Root-level files under public/data/<type>/ that are importer INPUTS rather
 * than published records.
 *
 * This exists because promotion prunes stale files. For campaigns and
 * articles it removes every root-level .json except index.json, on the
 * reasoning that the current pipeline only ever writes into
 * {theater|category}/ subdirectories — so anything left at the root is an
 * aggregate from the old pipeline. That reasoning missed the archive
 * manifests, which also sit at the root and which the importers read:
 *
 *   public/data/campaigns/campaigns.archive.json   (read by CampaignArchiveManifestLoader)
 *   public/data/articles/articles.archive.json     (read by ArticleArchiveManifestLoader)
 *
 * A campaigns or articles promotion would have deleted its own input. It has
 * never happened, because PROMOTION_ENABLED is false.
 *
 * The declaration is deliberately an explicit list, not a filename pattern:
 * a pattern would quietly protect anything that happened to match, whereas
 * this can be read and checked. importer-inputs.test cross-checks it against
 * what every loader actually asks for, so adding a loader without declaring
 * its input fails the suite instead of losing a file in production.
 */

export const IMPORTER_INPUT_FILES: Readonly<Record<string, readonly string[]>> = {
  armaments: ["armaments.archive.json"],
  articles: ["articles.archive.json"],
  campaigns: ["campaigns.archive.json"],
};

/** The section index is regenerated in place and is never an orphan. */
const ALWAYS_PROTECTED = ["index.json"] as const;

export function isImporterInput(type: string, filename: string): boolean {
  return (IMPORTER_INPUT_FILES[type] ?? []).includes(filename);
}

/**
 * Root-level filenames a prune must never remove for this type.
 *
 * Returned rather than checked inline so a caller can log or report exactly
 * what it chose to leave alone.
 */
export function protectedRootFiles(type: string): readonly string[] {
  return [...ALWAYS_PROTECTED, ...(IMPORTER_INPUT_FILES[type] ?? [])];
}

export function isProtectedRootFile(type: string, filename: string): boolean {
  return protectedRootFiles(type).includes(filename);
}
