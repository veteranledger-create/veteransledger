import path from "path";
import { BaseArchiveManifestLoader } from "./archive-manifest-loader";

// Armaments' implementation of the generic archive-loading framework
// (archive-manifest-loader.ts). Everything mechanical — read, parse,
// never-throw fallback — lives in BaseArchiveManifestLoader; this class
// supplies only the three things that are actually specific to the
// armaments archive: where it lives, what "empty" looks like, and what
// counts as a validly-shaped armaments.archive.json.

export interface ArmamentArchiveManifestObsoleteEntry {
  file: string;
  replacedBy: string;
  reason: string;
  date?: string;
  notes?: string;
}

export interface ArmamentArchiveManifest {
  active: string[];
  obsolete: ArmamentArchiveManifestObsoleteEntry[];
}

const ARMAMENTS_DIR = path.resolve(__dirname, "../../../../public/data/armaments");

export class ArmamentArchiveManifestLoader extends BaseArchiveManifestLoader<ArmamentArchiveManifest> {
  constructor() {
    super(ARMAMENTS_DIR, "armaments.archive.json");
  }

  protected getEmptyManifest(): ArmamentArchiveManifest {
    return { active: [], obsolete: [] };
  }

  protected isValidManifestShape(parsed: unknown): parsed is ArmamentArchiveManifest {
    const obj = parsed as Record<string, unknown> | null;
    return !!obj && Array.isArray(obj.active) && Array.isArray(obj.obsolete);
  }
}
