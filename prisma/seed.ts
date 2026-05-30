import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

const CATEGORIES = [
  { name: "Movie", slug: "movie" },
  { name: "Cars", slug: "cars" },
  { name: "Aesthetic", slug: "aesthetic" },
  { name: "Abstract", slug: "abstract" },
  { name: "Anime", slug: "anime" },
  { name: "Typographic", slug: "typographic" },
  { name: "Travel", slug: "travel" },
  { name: "Cinema", slug: "cinema" },
];

async function main() {
  for (const cat of CATEGORIES) {
    await prisma.category.upsert({
      where: { slug: cat.slug },
      update: { name: cat.name },
      create: cat,
    });
  }
  console.log(`Seeded ${CATEGORIES.length} categories`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
