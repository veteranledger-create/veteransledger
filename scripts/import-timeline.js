/**
 * One-time import: public/data/timeline/events.json → TimelineEvent table
 *
 * Idempotent: skips any event whose title already exists in the DB
 * (matching on title + year — the events.json has no stable slug/id field).
 *
 * Run: node scripts/import-timeline.js
 */

const { PrismaClient } = require("@prisma/client");
const fs = require("fs");
const path = require("path");

const prisma = new PrismaClient();

function parseDate(dateStr) {
  if (!dateStr) return null;
  const d = new Date(dateStr);
  return isNaN(d.getTime()) ? null : d;
}

async function main() {
  const filePath = path.join(__dirname, "../public/data/timeline/events.json");
  const raw = JSON.parse(fs.readFileSync(filePath, "utf-8"));
  const events = Array.isArray(raw) ? raw : raw.events ?? [];

  console.log(`Found ${events.length} events in events.json`);

  // Build a lookup of existing events to make this idempotent
  const existing = await prisma.timelineEvent.findMany({
    select: { title: true, year: true },
  });
  const existingKeys = new Set(existing.map((e) => `${e.year}::${e.title}`));
  console.log(`Already in DB: ${existing.length} events`);

  let imported = 0;
  let skipped = 0;
  const errors = [];

  for (const event of events) {
    const key = `${event.year}::${event.title}`;
    if (existingKeys.has(key)) {
      skipped++;
      continue;
    }

    try {
      await prisma.timelineEvent.create({
        data: {
          year:         event.year     ?? null,
          date:         parseDate(event.date),
          endDate:      parseDate(event.endDate ?? event.end_date),
          title:        event.title,
          summary:      event.summary  ?? null,
          category:     event.category ?? null,
          location:     event.location ?? null,
          significance: event.significance ?? event.notes ?? null,
          published:    true,
          metadata:     event.sources || event.related_records
            ? { sources: event.sources ?? [], related_records: event.related_records ?? [] }
            : undefined,
        },
      });
      imported++;
      process.stdout.write(`  ✓ ${event.year} — ${event.title}\n`);
    } catch (err) {
      errors.push({ title: event.title, error: err.message });
      process.stdout.write(`  ✗ ${event.title}: ${err.message}\n`);
    }
  }

  console.log(`\n── Import complete ──`);
  console.log(`  Imported : ${imported}`);
  console.log(`  Skipped  : ${skipped}  (already in DB)`);
  console.log(`  Errors   : ${errors.length}`);
  if (errors.length) {
    console.log("  Error details:", JSON.stringify(errors, null, 2));
  }

  // Verify final count
  const finalCount = await prisma.timelineEvent.count();
  console.log(`  DB total : ${finalCount} timeline events`);
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("Fatal:", err.message);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
