import prisma from "./src/database/prisma";

const IDS = {
  award: "cmr03z0f70000cqt95ez8hf4a",
  map: "cmr03z0fm0001cqt9ktknf9v7",
  poldoc: "cmr03z0fp0002cqt9cl96d6l0",
};

async function main() {
  const now = new Date();
  for (const [key, id] of Object.entries(IDS)) {
    await prisma.translation.upsert({
      where: { entityType_entityId_locale: { entityType: "record", entityId: id, locale: "de" } },
      create: {
        entityType: "record", entityId: id, locale: "de", status: "machine",
        fields: { title: `TEST_DE_${key.toUpperCase()}_TITLE`, summary: `TEST_DE_${key.toUpperCase()}_SUMMARY` },
        generatedAt: now,
      },
      update: {
        status: "machine",
        fields: { title: `TEST_DE_${key.toUpperCase()}_TITLE`, summary: `TEST_DE_${key.toUpperCase()}_SUMMARY` },
      },
    });
  }
  console.log("Seeded translations for award/map/poldoc fixtures");
}

main().finally(() => prisma.$disconnect());
