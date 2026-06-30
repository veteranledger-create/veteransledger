import prisma from "./src/database/prisma";

async function main() {
  const award = await prisma.record.create({
    data: {
      type: "AWARD", title: "TEMP_FIXTURE_AWARD_TITLE", slug: "temp-fixture-award",
      summary: "TEMP_FIXTURE_AWARD_SUMMARY", published: true,
      metadata: { nation: "Germany" },
    },
  });
  const map = await prisma.record.create({
    data: {
      type: "MAP", title: "TEMP_FIXTURE_MAP_TITLE", slug: "temp-fixture-map",
      summary: "TEMP_FIXTURE_MAP_SUMMARY", published: true,
      metadata: { theater: "eastern-front", year: 1942 },
    },
  });
  const poldoc = await prisma.record.create({
    data: {
      type: "POLITICAL_DOCUMENT", title: "TEMP_FIXTURE_POLDOC_TITLE", slug: "temp-fixture-poldoc",
      summary: "TEMP_FIXTURE_POLDOC_SUMMARY", published: true,
      date: new Date("1933-01-01"),
    },
  });
  console.log(JSON.stringify({ awardId: award.id, mapId: map.id, poldocId: poldoc.id }, null, 2));
}

main().finally(() => prisma.$disconnect());
