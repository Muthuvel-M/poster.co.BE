import type { FastifyInstance } from "fastify";
import { ProductStatus, Size } from "@prisma/client";
import { randomUUID } from "node:crypto";
import { prisma } from "../lib/prisma.js";
import { CATALOG_CATEGORIES } from "../lib/catalog.js";
import { getSizePriceMap, saveSizePriceMap } from "../lib/pricing-settings.js";
import type { SizePriceMap } from "../lib/pricing.js";
import { slugify, uniqueSlug } from "../lib/slug.js";
import { processAndUploadImage } from "../lib/storage.js";
import { toApiProduct } from "../lib/serializers.js";
import {
  isImageUpload,
  readMultipart,
  type BufferedUpload,
} from "../lib/multipart.js";

const productInclude = { category: true } as const;

async function resolveCategory(categoryInput: string) {
  const slug = slugify(categoryInput);
  const trimmed = categoryInput.trim();
  const catalog = CATALOG_CATEGORIES.find(
    (c) =>
      c.slug === slug ||
      c.name.toLowerCase() === trimmed.toLowerCase() ||
      c.slug === trimmed.toLowerCase(),
  );

  if (catalog) {
    return prisma.category.upsert({
      where: { slug: catalog.slug },
      update: { name: catalog.name },
      create: { name: catalog.name, slug: catalog.slug },
    });
  }

  const existing = await prisma.category.findFirst({
    where: { OR: [{ slug }, { name: trimmed }] },
  });
  if (existing) return existing;

  return prisma.category.create({
    data: {
      name: trimmed,
      slug: slug || "general",
    },
  });
}

function sizesFromPrice(sizePrice: SizePriceMap) {
  return [
    { size: Size.A6, price: sizePrice.A6 },
    { size: Size.A5, price: sizePrice.A5 },
    { size: Size.A4, price: sizePrice.A4 },
  ];
}

function sizesFromFields(fields: Record<string, string>, fallback: SizePriceMap) {
  const a6 = Number(fields.price_a6 || fields.priceA6);
  const a5 = Number(fields.price_a5 || fields.priceA5 || fields.price);
  const a4 = Number(fields.price_a4 || fields.priceA4);

  if (a6 > 0 && a5 > 0 && a4 > 0) {
    return [
      { size: Size.A6, price: Math.round(a6) },
      { size: Size.A5, price: Math.round(a5) },
      { size: Size.A4, price: Math.round(a4) },
    ];
  }

  return sizesFromPrice(fallback);
}

function basenameNoExt(filename: string): string {
  return filename.replace(/\.[^.]+$/, "").trim();
}

function parseCsv(text: string): Record<string, string>[] {
  const lines = text
    .replace(/^\uFEFF/, "")
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);
  if (lines.length < 2) return [];

  const headers = splitCsvLine(lines[0]!).map((h) => h.trim().toLowerCase());
  return lines.slice(1).map((line) => {
    const cols = splitCsvLine(line);
    const row: Record<string, string> = {};
    headers.forEach((h, i) => {
      row[h] = (cols[i] ?? "").trim();
    });
    return row;
  });
}

function splitCsvLine(line: string): string[] {
  const result: string[] = [];
  let current = "";
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const ch = line[i]!;
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') {
        current += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (ch === "," && !inQuotes) {
      result.push(current);
      current = "";
    } else {
      current += ch;
    }
  }
  result.push(current);
  return result;
}

type BulkRow = {
  title: string;
  category: string;
  description: string;
  stock: number;
  artist?: string;
  subtitle?: string;
  imageKey: string;
  sizes: { size: Size; price: number; discountedPrice?: number | null }[];
};

function toApiPricing(sizePrice: SizePriceMap) {
  return {
    priceA4: sizePrice.A4,
    priceA5: sizePrice.A5,
    priceA6: sizePrice.A6,
    sizePrice,
  };
}

function rowToBulk(
  row: Record<string, string>,
  fallback: SizePriceMap,
): BulkRow | null {
  const title = row.title || row.name;
  if (!title) return null;

  const sizes: BulkRow["sizes"] = [];
  for (const size of ["A4", "A5", "A6"] as const) {
    const priceKey = `price_${size.toLowerCase()}`;
    const altKey = size.toLowerCase();
    const priceRaw = row[priceKey] || row[altKey] || row[`price${size.toLowerCase()}`];
    if (!priceRaw) continue;
    const price = Number(priceRaw);
    if (Number.isNaN(price)) continue;
    const discRaw =
      row[`discount_${size.toLowerCase()}`] ||
      row[`discounted_${size.toLowerCase()}`];
    sizes.push({
      size: size as Size,
      price,
      discountedPrice: discRaw ? Number(discRaw) : null,
    });
  }

  if (sizes.length === 0) {
    sizes.push(
      { size: Size.A6, price: fallback.A6 },
      { size: Size.A5, price: fallback.A5 },
      { size: Size.A4, price: fallback.A4 },
    );
  }

  const imageKey = (
    row.image ||
    row.filename ||
    row.file ||
    slugify(title)
  ).replace(/\.[^.]+$/, "");

  return {
    title,
    category: row.category || "General",
    description: row.description || title,
    stock: Number(row.stock || "10") || 10,
    artist: row.artist || undefined,
    subtitle: row.subtitle || undefined,
    imageKey,
    sizes,
  };
}

export async function adminRoutes(app: FastifyInstance): Promise<void> {
  app.get(
    "/api/admin/pricing",
    { preHandler: [app.authenticateAdmin] },
    async () => {
      const sizePrice = await getSizePriceMap();
      return toApiPricing(sizePrice);
    },
  );

  app.patch(
    "/api/admin/pricing",
    { preHandler: [app.authenticateAdmin] },
    async (request, reply) => {
      const body = request.body as
        | {
            priceA4?: unknown;
            priceA5?: unknown;
            priceA6?: unknown;
          }
        | undefined;

      const priceA4 = Number(body?.priceA4);
      const priceA5 = Number(body?.priceA5);
      const priceA6 = Number(body?.priceA6);
      const values = [priceA4, priceA5, priceA6];
      if (
        values.some((n) => Number.isNaN(n) || !Number.isInteger(n) || n < 1)
      ) {
        return reply.code(400).send({
          error: "Body must be { priceA4, priceA5, priceA6 } with positive integers",
        });
      }

      const saved = await saveSizePriceMap({
        A4: priceA4,
        A5: priceA5,
        A6: priceA6,
      });
      return toApiPricing(saved);
    },
  );

  app.get(
    "/api/admin/stats",
    { preHandler: [app.authenticateAdmin] },
    async () => {
      const [
        customers,
        orders,
        pendingReviews,
        faqs,
        products,
        orderAgg,
      ] = await Promise.all([
        prisma.customer.count(),
        prisma.order.count(),
        prisma.review.count({ where: { status: "PENDING" } }),
        prisma.faq.count({ where: { published: true } }),
        prisma.product.count({ where: { status: "ACTIVE" } }),
        prisma.order.findMany({
          select: { total: true, status: true, createdAt: true },
          orderBy: { createdAt: "desc" },
          take: 100,
        }),
      ]);

      const revenue = orderAgg
        .filter((o) => o.status !== "CANCELLED")
        .reduce((s, o) => s + o.total, 0);

      const recentOrders = orderAgg.slice(0, 14);
      const byDay = new Map<string, number>();
      for (const o of recentOrders) {
        const day = o.createdAt.toISOString().slice(0, 10);
        byDay.set(day, (byDay.get(day) ?? 0) + 1);
      }

      return {
        customers,
        orders,
        revenue,
        pendingReviews,
        faqs,
        products,
        ordersByDay: [...byDay.entries()]
          .map(([date, count]) => ({ date, count }))
          .sort((a, b) => a.date.localeCompare(b.date)),
      };
    },
  );

  app.get(
    "/api/admin/customers",
    { preHandler: [app.authenticateAdmin] },
    async () => {
      const customers = await prisma.customer.findMany({
        orderBy: { createdAt: "desc" },
        select: {
          id: true,
          email: true,
          name: true,
          phone: true,
          avatarUrl: true,
          googleId: true,
          createdAt: true,
          _count: { select: { orders: true, reviews: true } },
        },
      });

      return {
        customers: customers.map((c) => ({
          id: c.id,
          email: c.email,
          name: c.name,
          phone: c.phone || "—",
          avatarUrl: c.avatarUrl,
          authProvider: c.googleId ? "google" : "email",
          createdAt: c.createdAt,
          ordersCount: c._count.orders,
          reviewsCount: c._count.reviews,
        })),
      };
    },
  );

  /** CSV + images matched by filename, or multi-image quick create */
  app.post(
    "/api/admin/products/bulk",
    { preHandler: [app.authenticateAdmin] },
    async (request, reply) => {
      const { fields, files } = await readMultipart(request);
      const mode = fields.mode === "quick" ? "quick" : "csv";
      const sizePrice = await getSizePriceMap();

      const imageFiles = files.filter(
        (f) =>
          isImageUpload(f) &&
          (f.fieldname === "images" ||
            f.fieldname === "images[]" ||
            f.mimetype.startsWith("image/")),
      );
      const csvFile = files.find(
        (f) =>
          f.fieldname === "csv" ||
          f.filename.endsWith(".csv") ||
          f.mimetype === "text/csv",
      );

      const fileMap = new Map<string, BufferedUpload>();
      for (const f of imageFiles) {
        const key = basenameNoExt(f.filename).toLowerCase();
        fileMap.set(key, f);
        fileMap.set(slugify(key), f);
      }

      const created: ReturnType<typeof toApiProduct>[] = [];
      const errors: { row: string; error: string }[] = [];

      if (mode === "quick") {
        if (imageFiles.length === 0) {
          return reply.code(400).send({
            error: "No images provided. Use JPG, PNG, or WebP.",
          });
        }

        const categoryName = fields.category || "Aesthetic";
        const category = await resolveCategory(categoryName);
        const stock = Number(fields.stock || "50") || 50;
        const sizes = sizesFromFields(fields, sizePrice);
        const existingCount = await prisma.product.count({
          where: { categoryId: category.id },
        });

        for (let i = 0; i < imageFiles.length; i++) {
          const file = imageFiles[i]!;
          try {
            const number = existingCount + i + 1;
            const title = `${category.name} ${number}`;

            const slug = await uniqueSlug(title, async (s) => {
              const found = await prisma.product.findUnique({
                where: { slug: s },
              });
              return Boolean(found);
            });

            const product = await prisma.product.create({
              data: {
                slug,
                title,
                description: `${category.name} poster Nº ${String(number).padStart(3, "0")}`,
                categoryId: category.id,
                stock,
                status: ProductStatus.ACTIVE,
                sizes,
                images: [],
              },
              include: productInclude,
            });

            const imageId = randomUUID();
            const urls = await processAndUploadImage(
              product.id,
              imageId,
              file.buffer,
            );
            await prisma.product.update({
              where: { id: product.id },
              data: {
                images: {
                  push: [{ id: imageId, ...urls, sortOrder: 0 }],
                },
              },
            });

            const full = await prisma.product.findUniqueOrThrow({
              where: { id: product.id },
              include: productInclude,
            });
            created.push(toApiProduct(full));
          } catch (err) {
            errors.push({
              row: file.filename,
              error: err instanceof Error ? err.message : "Upload failed",
            });
          }
        }
      } else {
        if (!csvFile && !fields.csv) {
          return reply
            .code(400)
            .send({ error: "CSV file or csv field required for bulk mode" });
        }

        const csvText = csvFile
          ? csvFile.buffer.toString("utf8")
          : fields.csv;
        const rows = parseCsv(csvText)
          .map((row) => rowToBulk(row, sizePrice))
          .filter((r): r is BulkRow => r !== null);

        if (rows.length === 0) {
          return reply.code(400).send({ error: "No valid rows in CSV" });
        }

        for (const row of rows) {
          try {
            const category = await resolveCategory(row.category);
            const slug = await uniqueSlug(row.title, async (s) => {
              const found = await prisma.product.findUnique({
                where: { slug: s },
              });
              return Boolean(found);
            });

            const product = await prisma.product.create({
              data: {
                slug,
                title: row.title,
                subtitle: row.subtitle,
                description: row.description,
                artist: row.artist,
                categoryId: category.id,
                stock: row.stock,
                status: ProductStatus.ACTIVE,
                sizes: row.sizes,
                images: [],
              },
              include: productInclude,
            });

            const imageFile =
              fileMap.get(row.imageKey.toLowerCase()) ||
              fileMap.get(slugify(row.imageKey));

            if (imageFile) {
              const imageId = randomUUID();
              const urls = await processAndUploadImage(
                product.id,
                imageId,
                imageFile.buffer,
              );
              await prisma.product.update({
                where: { id: product.id },
                data: {
                  images: {
                    push: [{ id: imageId, ...urls, sortOrder: 0 }],
                  },
                },
              });
            }

            const full = await prisma.product.findUniqueOrThrow({
              where: { id: product.id },
              include: productInclude,
            });
            created.push(toApiProduct(full));
          } catch (err) {
            errors.push({
              row: row.title,
              error: err instanceof Error ? err.message : "Create failed",
            });
          }
        }
      }

      return reply.code(201).send({
        created: created.length,
        products: created,
        errors,
      });
    },
  );
}
