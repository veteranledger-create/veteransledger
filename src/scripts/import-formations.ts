/**
 * One-time migration: imports all existing formations JSON files into the
 * DB as FORMATION records (published=true). Safe to re-run — skips any
 * record whose slug already exists in the DB.
 *
 * Run with:  npx ts-node -e "require('./src/scripts/import-formations').run()"
 * Or:        npx ts-node src/scripts/import-formations.ts
 */

import fs from "fs/promises";
import path from "path";
import prisma from "../database/prisma";

// Maps section key to the relative path within public/data/formations/
const SECTION_FILES: Array<{ section: string; file: string }> = [
  { section: "army-groups",  file: "germany/army-groups.json"   },
  { section: "armies",       file: "germany/armies.json"        },
  { section: "corps",        file: "germany/corps.json"         },
  { section: "divisions",    file: "germany/divisions.json"     },
  { section: "waffen-ss",    file: "germany/ss.json"            },
  { section: "brigades",     file: "germany/brigades.json"      },
  { section: "regiments",    file: "germany/regiments.json"     },
  { section: "battalions",   file: "germany/battalions.json"    },
  { section: "companies",    file: "germany/companies.json"     },
  { section: "luftwaffe",    file: "germany/luftflotte.json"    },
  { section: "kriegsmarine", file: "germany/naval.json"         },
  { section: "allies",       file: "allies/allies.json"         },
  { section: "volunteers",   file: "volunteer-formations.json"  },
];

async function readFormations(filePath: string): Promise<unknown[]> {
  try {
    const raw = await fs.readFile(filePath, "utf-8");
    const data = JSON.parse(raw);
    return Array.isArray(data) ? data : [];
  } catch {
    return [];
  }
}

export async function run() {
  const baseDir = path.resolve(process.cwd(), "public", "data", "formations");
  let created = 0;
  let skipped = 0;
  let errors = 0;

  for (const { section, file } of SECTION_FILES) {
    const filePath = path.join(baseDir, file);
    const formations = await readFormations(filePath);
    if (!formations.length) {
      console.log(`  [skip] ${file} — empty or missing`);
      continue;
    }

    console.log(`\nImporting ${file} (${section}) — ${formations.length} records`);

    for (const f of formations) {
      const formation = f as Record<string, unknown>;
      const id = formation.id as string;
      const name = (formation.name as string) || "";

      if (!id || !name) {
        console.warn(`  [warn] Skipping unnamed/id-less entry in ${file}`);
        errors++;
        continue;
      }

      // Check if already imported
      const existing = await prisma.record.findFirst({ where: { slug: id, type: "FORMATION" } });
      if (existing) {
        console.log(`  [skip] ${id} — already in DB`);
        skipped++;
        continue;
      }

      try {
        const {
          id: _id, name: _name, nation, service, type: formationType,
          theater, active, commanders, peak_strength, summary, context,
          overview_blocks, context_blocks, sources, related_records, dossier,
          shield, flag, region, volunteer_origin, parent_formation,
          constituent_divisions, predecessor, fate, subordinate_units,
          campaign_participation,
          ...rest
        } = formation;

        const metadata: Record<string, unknown> = {
          section,
          formation_type: formationType ?? null,
          service: service ?? null,
          theater: theater ?? null,
          active: active ?? null,
          commanders: Array.isArray(commanders) ? commanders : [],
          peak_strength: peak_strength ?? null,
          context: context ?? null,
          overview_blocks: Array.isArray(overview_blocks) ? overview_blocks : [],
          context_blocks: Array.isArray(context_blocks) ? context_blocks : [],
          sources: Array.isArray(sources) ? sources : [],
          related_records: Array.isArray(related_records) ? related_records : [],
          dossier: dossier ?? null,
          shield: shield ?? null,
          flag: flag ?? null,
          region: region ?? null,
          volunteer_origin: volunteer_origin ?? null,
          parent_formation: parent_formation ?? null,
          constituent_divisions: constituent_divisions ?? null,
          predecessor: predecessor ?? null,
          fate: fate ?? null,
          subordinate_units: subordinate_units ?? null,
          campaign_participation: campaign_participation ?? null,
          ...rest,
        };

        // Strip explicit nulls to keep metadata lean
        for (const key of Object.keys(metadata)) {
          if (metadata[key] === null) delete metadata[key];
        }

        await prisma.record.create({
          data: {
            type: "FORMATION",
            title: name,
            slug: id,
            nationality: (nation as string) || "Germany",
            summary: (summary as string) || null,
            published: true,
            metadata: metadata as Parameters<typeof prisma.record.create>[0]["data"]["metadata"],
          },
        });
        console.log(`  [ok]   ${id} — ${name}`);
        created++;
      } catch (err) {
        console.error(`  [err]  ${id} — ${(err as Error).message}`);
        errors++;
      }
    }
  }

  console.log(`\n── Import complete ──`);
  console.log(`  Created: ${created}`);
  console.log(`  Skipped: ${skipped}`);
  console.log(`  Errors:  ${errors}`);

  await prisma.$disconnect();
}

// Allow direct execution
if (require.main === module) {
  run().catch((err) => { console.error(err); process.exit(1); });
}
