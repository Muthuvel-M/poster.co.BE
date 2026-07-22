import { PrismaClient } from "@prisma/client";
import { CATALOG_CATEGORIES } from "../src/lib/catalog.js";

const prisma = new PrismaClient();

const DEFAULT_FAQS = [
  {
    question: "What sizes are available for posters?",
    answer:
      "We offer A6 (10×15 cm), A5 (15×21 cm), and A4 (21×30 cm) sizes. Bulk pricing applies when you order multiple posters of the same size.",
    sortOrder: 1,
  },
  {
    question: "Can I upload my own photo for a custom poster?",
    answer:
      "Yes! Send us your image via WhatsApp or email along with the size you need. We'll print and ship it to you.",
    sortOrder: 2,
  },
  {
    question: "Is free shipping available?",
    answer:
      "Yes — free shipping is available for all orders above ₹500. For orders below ₹500, a flat shipping charge of ₹80 applies.",
    sortOrder: 3,
  },
  {
    question: "How do I place a bulk order?",
    answer:
      "Click 'Bulk Enquiry' in the nav or message us on WhatsApp. We offer special pricing for orders of 10+ posters.",
    sortOrder: 4,
  },
];

async function main() {
  const keepSlugs = new Set(CATALOG_CATEGORIES.map((c) => c.slug));

  for (const cat of CATALOG_CATEGORIES) {
    await prisma.category.upsert({
      where: { slug: cat.slug },
      update: { name: cat.name },
      create: { name: cat.name, slug: cat.slug },
    });
  }
  console.log(`Seeded ${CATALOG_CATEGORIES.length} categories`);

  const extras = await prisma.category.findMany({
    where: { slug: { notIn: [...keepSlugs] } },
    include: { _count: { select: { products: true } } },
  });
  for (const cat of extras) {
    if (cat._count.products === 0) {
      await prisma.category.delete({ where: { id: cat.id } });
      console.log(`Removed unused category: ${cat.name}`);
    } else {
      console.log(
        `Kept legacy category with products: ${cat.name} (${cat._count.products})`,
      );
    }
  }

  const faqCount = await prisma.faq.count();
  if (faqCount === 0) {
    for (const faq of DEFAULT_FAQS) {
      await prisma.faq.create({
        data: { ...faq, published: true },
      });
    }
    console.log(`Seeded ${DEFAULT_FAQS.length} FAQs`);
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
