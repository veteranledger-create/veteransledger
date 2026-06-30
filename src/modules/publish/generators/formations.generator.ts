import { RecordLike } from "../publish.types";

// Maps metadata.section to the relative file path within public/data/formations/.
// Mirrors the `file` paths in formations/index.json (minus the /public/data/formations/ prefix).
export const SECTION_TO_FILE: Record<string, string> = {
  "army-groups":  "germany/army-groups.json",
  "armies":       "germany/armies.json",
  "corps":        "germany/corps.json",
  "divisions":    "germany/divisions.json",
  "waffen-ss":    "germany/ss.json",
  "volunteers":   "volunteer-formations.json",
  "brigades":     "germany/brigades.json",
  "regiments":    "germany/regiments.json",
  "battalions":   "germany/battalions.json",
  "companies":    "germany/companies.json",
  "luftwaffe":    "germany/luftflotte.json",
  "kriegsmarine": "germany/naval.json",
  "allies":       "allies/allies.json",
};

function meta(record: RecordLike, key: string): unknown {
  return record.metadata ? record.metadata[key] : undefined;
}

function asString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0 ? value : undefined;
}

function asArray(value: unknown): unknown[] | undefined {
  return Array.isArray(value) && value.length > 0 ? value : undefined;
}

function rebuildRelatedRecords(raw: unknown): unknown[] | undefined {
  if (!Array.isArray(raw) || raw.length === 0) return undefined;
  return raw
    .filter((r): r is { id: string; title?: string; type?: string } => !!r && typeof r.id === "string")
    .map((r) => ({ id: r.id, title: r.title, type: r.type }));
}

export function toFormationJson(record: RecordLike): Record<string, unknown> {
  const result: Record<string, unknown> = {
    id:           record.slug ?? record.id,
    recordId:     record.id,
    name:         record.title,
    nation:       record.nationality ?? asString(meta(record, "nation")) ?? "Germany",
    service:      asString(meta(record, "service")),
    type:         asString(meta(record, "formation_type")),
    theater:      asString(meta(record, "theater")),
    active:       meta(record, "active") ?? undefined,
    commanders:   asArray(meta(record, "commanders")),
    peak_strength: asString(meta(record, "peak_strength")),
    summary:      record.summary ?? undefined,
    context:      asString(meta(record, "context")),
    sources:      asArray(meta(record, "sources")),
    related_records: rebuildRelatedRecords(meta(record, "related_records")),
  };

  // Preserve rich block arrays if present (imported from legacy JSON or authored via admin)
  const overviewBlocks = meta(record, "overview_blocks");
  if (Array.isArray(overviewBlocks) && overviewBlocks.length > 0) {
    result.overview_blocks = overviewBlocks;
  }
  const contextBlocks = meta(record, "context_blocks");
  if (Array.isArray(contextBlocks) && contextBlocks.length > 0) {
    result.context_blocks = contextBlocks;
  }

  // Dossier (equipment, orders, maps, field_reports, propaganda, order_of_battle, photos, insignia, gallery)
  const dossier = meta(record, "dossier");
  if (dossier && typeof dossier === "object") {
    result.dossier = dossier;
  }

  // Volunteer-formation extras
  const shield = asString(meta(record, "shield"));
  const flag   = asString(meta(record, "flag"));
  const region = asString(meta(record, "region"));
  const volunteerOrigin = asString(meta(record, "volunteer_origin"));
  if (shield) result.shield = shield;
  if (flag)   result.flag   = flag;
  if (region) result.region = region;
  if (volunteerOrigin) result.volunteer_origin = volunteerOrigin;

  // Org chart extras
  const parentFormation     = meta(record, "parent_formation");
  const constituentDivisions = meta(record, "constituent_divisions");
  const predecessor          = asString(meta(record, "predecessor"));
  const fate                 = asString(meta(record, "fate"));
  const subordinateUnits     = meta(record, "subordinate_units");
  const campaignParticipation = meta(record, "campaign_participation");
  if (parentFormation)      result.parent_formation      = parentFormation;
  if (constituentDivisions) result.constituent_divisions = constituentDivisions;
  if (predecessor)          result.predecessor           = predecessor;
  if (fate)                 result.fate                  = fate;
  if (subordinateUnits)     result.subordinate_units     = subordinateUnits;
  if (campaignParticipation) result.campaign_participation = campaignParticipation;

  // Strip undefined values so the output JSON stays clean
  for (const key of Object.keys(result)) {
    if (result[key] === undefined) delete result[key];
  }

  return result;
}
