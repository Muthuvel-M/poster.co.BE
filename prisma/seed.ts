import { PrismaClient } from "@prisma/client";
import { CATALOG_CATEGORIES } from "../src/lib/catalog.js";

const prisma = new PrismaClient();

const DEFAULT_FAQS = [
  {
    question: "What sizes are available for posters?",
    answer:
      "We offer A6 (₹20), A5 (₹25), and A4 (₹40). Combos: any 2 A4 for ₹70, any 3 A4 for ₹109, mini (A5+A6) for ₹39, mixed (A4+A5+A6) for ₹69. 1 A6 free on orders above ₹199.",
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
      "Yes — free shipping on all orders of ₹499 or more. Below ₹499, a flat shipping charge of ₹80 applies.",
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
