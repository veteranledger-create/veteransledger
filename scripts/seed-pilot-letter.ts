/**
 * Phase 0 verification fixture — NOT part of the real prisma/seed.ts.
 * Creates exactly one test Record (type LETTER) mirroring the real
 * de-001 entry in public/data/letters/german.json, so the publish
 * pipeline can be exercised end-to-end and its output diffed against
 * real archive JSON. Safe to run repeatedly (upserts by slug).
 */
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  console.log("Seeding pilot letter fixture...");

  const record = await prisma.record.upsert({
    where: { slug: "de-001" },
    update: {},
    create: {
      type: "LETTER",
      slug: "de-001",
      title: "Becker — Vyazma, Eastern Front (1941)",
      summary:
        "The distances here are incomprehensible. We have marched further in the last weeks than I could have believed possible...",
      content:
        "Dearest Family,\n\nI write to you from somewhere near Vyazma, where we have halted to consolidate. The distances here are incomprehensible — we have marched and ridden further in the last weeks than I could have believed possible. Russia is not like France. The land goes on without end, and the autumn mud has already begun. My boots have not been dry in a week.\n\nDespite all this, spirits remain high. The men around me are good soldiers and good comrades. We have seen hard fighting, but we believe in what we are doing. The encirclement battles have been enormous — tens of thousands of prisoners streaming westward, more than I can count.\n\nI hope Father's health is improving. Tell Mother her package arrived with the socks and the Lebkuchen — they were shared with the whole section and gone in minutes. Everyone sends their thanks.\n\nI cannot say when I will next write, but know that I think of home every day.\n\nYour Hans",
      date: new Date("1941-10-15"),
      nationality: "Germany",
      published: true,
      metadata: {
        language: "german",
        from: "Gefreiter Hans Becker",
        from_unit: "6th Infanterie-Division, Army Group Centre",
        to: "Family",
        location_written: "Near Vyazma, Russia",
        subject: "Letter from the Eastern Front",
        excerpt:
          "The distances here are incomprehensible. We have marched further in the last weeks than I could have believed possible...",
        context:
          "By October 1941, Army Group Centre was deep into Operation Typhoon, the German drive on Moscow. The encirclement battles of Vyazma and Bryansk had just concluded, trapping approximately 663,000 Soviet troops in the largest encirclement in military history.",
        notes:
          "Gefreiter Becker was killed in action near Rzhev in January 1942. This letter was returned to his family after the war.",
        archive_source: "Private family collection, donated 1960",
        sources: [
          {
            type: "primary",
            ref: "Original letter, private family collection, donated to Bundesarchiv-Militärarchiv, Freiburg, 1960. Bestand RH 37/6254.",
          },
        ],
        related_records: [
          { id: "de-002", title: "Müller — Stalingrad Pocket (1942)", type: "German Collection" },
        ],
      },
    },
  });

  console.log(`Fixture record ready: id=${record.id} slug=${record.slug}`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
