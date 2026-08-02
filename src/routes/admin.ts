import type { FastifyInstance } from "fastify";
import { ProductStatus, Size } from "../lib/db.js";
import { randomUUID } from "node:crypto";
import { prisma } from "../lib/prisma.js";
import { CATALOG_CATEGORIES } from "../lib/catalog.js";
import {
  getFullPricingSettings,
  getSizePriceMap,
  saveFullPricingSettings,
} from "../lib/pricing-settings.js";
import type { SizePriceMap } from "../lib/pricing.js";
import { writeAuditLog } from "../lib/audit.js";
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
      const full = await getFullPricingSettings();
      return {
        ...toApiPricing({ A4: full.A4, A5: full.A5, A6: full.A6 }),
        shippingThreshold: full.shippingThreshold,
        shippingCharge: full.shippingCharge,
        freeA6Threshold: full.freeA6Threshold,
        comboMixed: full.comboMixed,
        comboMini: full.comboMini,
        a4Pack2: full.a4Pack2,
        a4Pack3: full.a4Pack3,
      };
    },
  );

  app.patch(
    "/api/admin/pricing",
    { preHandler: [app.authenticateAdmin] },
    async (request, reply) => {
      const body = request.body as Record<string, unknown> | undefined;

      const priceA4 = body?.priceA4 !== undefined ? Number(body.priceA4) : undefined;
      const priceA5 = body?.priceA5 !== undefined ? Number(body.priceA5) : undefined;
      const priceA6 = body?.priceA6 !== undefined ? Number(body.priceA6) : undefined;

      for (const [label, n] of [
        ["priceA4", priceA4],
        ["priceA5", priceA5],
        ["priceA6", priceA6],
      ] as const) {
        if (n !== undefined && (Number.isNaN(n) || !Number.isInteger(n) || n < 1)) {
          return reply.code(400).send({ error: `${label} must be a positive integer` });
        }
      }

      const intField = (key: string) => {
        if (body?.[key] === undefined) return undefined;
        const n = Number(body[key]);
        if (Number.isNaN(n) || !Number.isInteger(n) || n < 0) return null;
        return n;
      };

      const shippingThreshold = intField("shippingThreshold");
      const shippingCharge = intField("shippingCharge");
      const freeA6Threshold = intField("freeA6Threshold");
      const comboMixed = intField("comboMixed");
      const comboMini = intField("comboMini");
      const a4Pack2 = intField("a4Pack2");
      const a4Pack3 = intField("a4Pack3");

      for (const [label, n] of [
        ["shippingThreshold", shippingThreshold],
        ["shippingCharge", shippingCharge],
        ["freeA6Threshold", freeA6Threshold],
        ["comboMixed", comboMixed],
        ["comboMini", comboMini],
        ["a4Pack2", a4Pack2],
        ["a4Pack3", a4Pack3],
      ] as const) {
        if (n === null) {
          return reply.code(400).send({ error: `${label} must be a non-negative integer` });
        }
      }

      const saved = await saveFullPricingSettings({
        ...(priceA4 !== undefined ? { A4: priceA4 } : {}),
        ...(priceA5 !== undefined ? { A5: priceA5 } : {}),
        ...(priceA6 !== undefined ? { A6: priceA6 } : {}),
        ...(typeof shippingThreshold === "number"
          ? { shippingThreshold }
          : {}),
        ...(typeof shippingCharge === "number" ? { shippingCharge } : {}),
        ...(typeof freeA6Threshold === "number" ? { freeA6Threshold } : {}),
        ...(typeof comboMixed === "number" ? { comboMixed } : {}),
        ...(typeof comboMini === "number" ? { comboMini } : {}),
        ...(typeof a4Pack2 === "number" ? { a4Pack2 } : {}),
        ...(typeof a4Pack3 === "number" ? { a4Pack3 } : {}),
      });

      await writeAuditLog({
        actorId: request.user.sub,
        actorEmail: request.user.email,
        action: "pricing.update",
        entity: "PricingSettings",
        entityId: "global",
      });

      return {
        ...toApiPricing({ A4: saved.A4, A5: saved.A5, A6: saved.A6 }),
        shippingThreshold: saved.shippingThreshold,
        shippingCharge: saved.shippingCharge,
        freeA6Threshold: saved.freeA6Threshold,
        comboMixed: saved.comboMixed,
        comboMini: saved.comboMini,
        a4Pack2: saved.a4Pack2,
        a4Pack3: saved.a4Pack3,
      };
    },
  );

  app.get(
    "/api/admin/categories",
    { preHandler: [app.authenticateAdmin] },
    async () => {
      const categories = await prisma.category.findMany({
        orderBy: { name: "asc" },
        include: { _count: { select: { products: true } } },
      });
      return {
        categories: categories.map((c) => ({
          id: c.id,
          name: c.name,
          slug: c.slug,
          productCount: c._count.products,
        })),
      };
    },
  );

  app.post(
    "/api/admin/categories",
    { preHandler: [app.authenticateAdmin] },
    async (request, reply) => {
      const body = request.body as { name?: string } | undefined;
      const name = body?.name?.trim();
      if (!name) return reply.code(400).send({ error: "name is required" });
      const slug = slugify(name) || "category";
      const existing = await prisma.category.findUnique({ where: { slug } });
      if (existing) {
        return reply.code(409).send({ error: "Category already exists" });
      }
      const category = await prisma.category.create({ data: { name, slug } });
      await writeAuditLog({
        actorId: request.user.sub,
        actorEmail: request.user.email,
        action: "category.create",
        entity: "Category",
        entityId: category.id,
      });
      return reply.code(201).send(category);
    },
  );

  app.patch(
    "/api/admin/categories/:id",
    { preHandler: [app.authenticateAdmin] },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      const body = request.body as { name?: string } | undefined;
      const name = body?.name?.trim();
      if (!name) return reply.code(400).send({ error: "name is required" });
      const slug = slugify(name) || "category";
      try {
        const category = await prisma.category.update({
          where: { id },
          data: { name, slug },
        });
        return category;
      } catch {
        return reply.code(404).send({ error: "Category not found" });
      }
    },
  );

  app.delete(
    "/api/admin/categories/:id",
    { preHandler: [app.authenticateAdmin] },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      const count = await prisma.product.count({ where: { categoryId: id } });
      if (count > 0) {
        return reply
          .code(400)
          .send({ error: "Move or archive products before deleting category" });
      }
      await prisma.category.delete({ where: { id } });
      return reply.code(204).send();
    },
  );

  app.get(
    "/api/admin/audit-logs",
    { preHandler: [app.authenticateAdmin] },
    async (request) => {
      const query = request.query as { limit?: string };
      const limit = Math.min(200, Math.max(1, Number(query.limit) || 50));
      const logs = await prisma.auditLog.findMany({
        orderBy: { createdAt: "desc" },
        take: limit,
      });
      return { logs };
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
          select: { total: true, status: true, createdAt: true, lines: true },
          orderBy: { createdAt: "desc" },
        }),
      ]);

      const activeOrders = orderAgg.filter((o) => o.status !== "CANCELLED");
      const revenue = activeOrders.reduce((s, o) => s + o.total, 0);
      const aov =
        activeOrders.length > 0
          ? Math.round(revenue / activeOrders.length)
          : 0;

      const productSales = new Map<string, { title: string; qty: number }>();
      for (const o of activeOrders) {
        for (const line of o.lines) {
          const cur = productSales.get(line.productId) ?? {
            title: line.title,
            qty: 0,
          };
          cur.qty += line.qty;
          productSales.set(line.productId, cur);
        }
      }
      const topProducts = [...productSales.entries()]
        .sort((a, b) => b[1].qty - a[1].qty)
        .slice(0, 10)
        .map(([productId, v]) => ({
          productId,
          title: v.title,
          qty: v.qty,
        }));

      const since = new Date(Date.now() - 14 * 24 * 60 * 60 * 1000);
      const byDay = new Map<string, number>();
      for (const o of orderAgg.filter((o) => o.createdAt >= since)) {
        const day = o.createdAt.toISOString().slice(0, 10);
        byDay.set(day, (byDay.get(day) ?? 0) + 1);
      }

      return {
        customers,
        orders,
        revenue,
        aov,
        pendingReviews,
        faqs,
        products,
        topProducts,
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
