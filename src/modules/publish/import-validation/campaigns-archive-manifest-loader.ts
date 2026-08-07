import path from "path";
import { BaseArchiveManifestLoader } from "./archive-manifest-loader";

// Campaigns' implementation of the generic archive-loading framework
// (archive-manifest-loader.ts). Everything mechanical — read, parse,
// never-throw fallback — lives in BaseArchiveManifestLoader; this class
// supplies only the three things that are actually specific to the
// campaign archive: where it lives, what "empty" looks like, and what
// counts as a validly-shaped campaigns.archive.json.

export interface CampaignArchiveManifestObsoleteEntry {
  file: string;
  replacedBy: string;
  reason: string;
  date?: string;
  notes?: string;
}

export interface CampaignArchiveManifest {
  active: string[];
  obsolete: CampaignArchiveManifestObsoleteEntry[];
}

const CAMPAIGNS_DIR = path.resolve(__dirname, "../../../../public/data/campaigns");

export class CampaignArchiveManifestLoader extends BaseArchiveManifestLoader<CampaignArchiveManifest> {
  constructor() {
    super(CAMPAIGNS_DIR, "campaigns.archive.json");
  }

  protected getEmptyManifest(): CampaignArchiveManifest {
    return { active: [], obsolete: [] };
  }

  protected isValidManifestShape(parsed: unknown): parsed is CampaignArchiveManifest {
    const obj = parsed as Record<string, unknown> | null;
    return !!obj && Array.isArray(obj.active) && Array.isArray(obj.obsolete);
  }
}
