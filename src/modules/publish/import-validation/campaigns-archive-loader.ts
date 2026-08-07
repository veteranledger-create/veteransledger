import fs from "fs/promises";
import path from "path";
import { LegacyCampaign } from "./campaign-record-mapper";
import { campaignArchiveManifestProvider } from "./campaigns-archive-manifest-provider";

// Campaign-specific archive-record loading — deliberately NOT part of the
// generic framework (archive-manifest-loader.ts / archive-manifest-provider.ts).
// The provider remains responsible only for manifest access (getManifest,
// getCampaignFiles, getCampaignDirectory); this file is what actually reads
// the individual campaign JSON files the manifest declares, and it is the
// single place that does so.
//
// loadCampaignArchive() is what runCampaignsImport(), buildImportPreview(),
// runCampaignsImportDryRun(), and validateCampaignArchiveIntegrity() now
// share within one execution flow, so the ~35 files that make up the
// campaign archive get read and parsed once per run, not once per
// function. Nothing here is cached beyond a single call — the returned
// object is a plain, disposable snapshot scoped to whatever operation
// requested it; calling this function again always re-reads from disk.
// This is deliberately NOT a new global cache (see campaigns-archive-
// manifest-provider.ts for the one place that kind of caching belongs).

export interface CampaignArchiveFileEntry {
  theater: string;
  filename: string;
  relPath: string;
  /** Parsed JSON content, or undefined if the file could not be read or parsed. */
  raw: Record<string, unknown> | undefined;
  /**
   * Only meaningful when raw is undefined. True if the failure happened
   * reading the file itself (permission denied, removed between the
   * readdir listing and the read, other I/O error) — false/absent means
   * the read succeeded but JSON.parse failed. Kept as a plain boolean
   * flag on the same entry rather than a new type, so a caller that
   * needs to tell the two failure modes apart can, without changing what
   * this function scans or how many times it scans it.
   */
  readError?: boolean;
}

export interface LoadedCampaignArchive {
  /**
   * Every .json file physically present in every theater folder the
   * manifest's active list declares a theater for — declared or not. This
   * single scan is what both "read every declared file" and "find
   * undeclared files" are built from; a file is read from disk exactly
   * once here regardless of how many downstream checks need its content.
   */
  filesOnDisk: CampaignArchiveFileEntry[];
  /**
   * Declared files only, parsed as LegacyCampaign, grouped by theater —
   * the shape this pipeline has always worked with. A declared file that
   * is missing or fails to parse is simply absent from its theater's
   * array here (never thrown) — callers that need to know *why* a
   * declared file is missing look it up in filesOnDisk instead; this
   * mirrors the fail-safe philosophy already established by
   * BaseArchiveManifestLoader (never throw on a bad file, report it as
   * data instead).
   */
  declaredByTheater: { theater: string; campaigns: LegacyCampaign[] }[];
}

function lookupRaw(filesOnDisk: CampaignArchiveFileEntry[]): (theater: string, filename: string) => Record<string, unknown> | undefined {
  const index = new Map<string, Record<string, unknown> | undefined>();
  for (const entry of filesOnDisk) index.set(entry.relPath, entry.raw);
  return (theater, filename) => index.get(`${theater}/${filename}`);
}

export async function loadCampaignArchive(): Promise<LoadedCampaignArchive> {
  const campaignsDir = campaignArchiveManifestProvider.getCampaignDirectory();
  const campaignFiles = campaignArchiveManifestProvider.getCampaignFiles();
  const manifest = campaignArchiveManifestProvider.getManifest();

  // Scan every theater folder that's either declared-active or referenced
  // by an obsolete entry's "file"/"replacedBy" — the integrity validator's
  // obsolete/replacement verification previously did unscoped direct-path
  // checks (not limited to declared theaters), so filesOnDisk has to cover
  // the same ground or an obsolete entry pointing at an otherwise-
  // undeclared theater folder would silently stop being checked.
  const theaters = new Set<string>(Object.keys(campaignFiles));
  for (const entry of manifest.obsolete) {
    theaters.add(entry.file.slice(0, entry.file.indexOf("/")));
    theaters.add(entry.replacedBy.slice(0, entry.replacedBy.indexOf("/")));
  }

  const filesOnDisk: CampaignArchiveFileEntry[] = [];

  for (const theater of theaters) {
    const dir = path.join(campaignsDir, theater);
    let onDiskFilenames: string[];
    try {
      onDiskFilenames = (await fs.readdir(dir)).filter((f) => f.endsWith(".json"));
    } catch {
      onDiskFilenames = [];
    }

    for (const filename of onDiskFilenames) {
      const relPath = `${theater}/${filename}`;
      let raw: Record<string, unknown> | undefined;
      let readError = false;
      let content: string | undefined;
      try {
        content = await fs.readFile(path.join(dir, filename), "utf-8");
      } catch {
        readError = true;
      }
      if (content !== undefined) {
        try {
          raw = JSON.parse(content);
        } catch {
          raw = undefined;
        }
      }
      filesOnDisk.push({ theater, filename, relPath, raw, ...(readError ? { readError: true } : {}) });
    }
  }

  const findRaw = lookupRaw(filesOnDisk);
  const declaredByTheater: { theater: string; campaigns: LegacyCampaign[] }[] = [];
  for (const [theater, filenames] of Object.entries(campaignFiles)) {
    const campaigns: LegacyCampaign[] = [];
    for (const filename of filenames) {
      const raw = findRaw(theater, filename);
      if (raw === undefined) continue;
      // A declared file containing the literal JSON value `null` parses
      // successfully (raw !== undefined, so it's not "missing" or
      // "malformed" — see campaigns-archive-integrity.ts), but null has no
      // properties, and every downstream consumer (runCampaignsImportDryRun,
      // buildImportPreview, the transaction loop) immediately reads
      // campaign.id — which throws on null before ever reaching
      // campaigns.conformance.ts's checkCampaignRecord(). Substituting {}
      // keeps this file on the exact same path every other malformed-shape
      // declared file already takes (a bare number, an array, an object
      // missing id/title): checkCampaignRecord()'s existing "Record id is
      // missing" / "must have a title" checks reject it there. This is not
      // a new shape-validation rule — it routes null into the one that
      // already exists and already owns this policy.
      campaigns.push((raw === null ? {} : raw) as unknown as LegacyCampaign);
    }
    declaredByTheater.push({ theater, campaigns });
  }

  return { filesOnDisk, declaredByTheater };
}
