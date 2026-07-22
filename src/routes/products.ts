import type { FastifyInstance } from "fastify";
import { ProductStatus, Size } from "@prisma/client";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { prisma } from "../lib/prisma.js";
import { CATALOG_CATEGORIES } from "../lib/catalog.js";
import { slugify, uniqueSlug } from "../lib/slug.js";
import { processAndUploadImage } from "../lib/storage.js";
import { toApiProduct, toApiCategories } from "../lib/serializers.js";
import {
  isImageUpload,
  readMultipart,
  type BufferedUpload,
} from "../lib/multipart.js";

const productInclude = { category: true } as const;

const sizeSchema = z.object({
  size: z.enum(["A4", "A5", "A6"]),
  price: z.coerce.number().int().min(0),
  discountedPrice: z.coerce.number().int().min(0).optional().nullable(),
});

const productFieldsSchema = z.object({
  title: z.string().min(1),
  subtitle: z.string().optional(),
  description: z.string().min(1),
  artist: z.string().optional(),
  year: z.coerce.number().int().optional(),
  category: z.string().min(1),
  stock: z.coerce.number().int().min(0).default(0),
  sizes: z.array(sizeSchema).min(1),
  status: z.enum(["ACTIVE", "ARCHIVED"]).optional(),
});

type ParsedFields = z.infer<typeof productFieldsSchema>;

function mapSizes(sizes: ParsedFields["sizes"]) {
  return sizes.map((s) => ({
    size: s.size as Size,
    price: s.price,
    discountedPrice: s.discountedPrice ?? null,
  }));
}

function parseSizes(fields: Record<string, string>): ParsedFields["sizes"] {
  const sizes: ParsedFields["sizes"] = [];

  for (const size of ["A4", "A5", "A6"] as const) {
    const priceKey = `sizes[${size}][price]`;
    const discountKey = `sizes[${size}][discountedPrice]`;
    const priceRaw = fields[priceKey];
    if (priceRaw === undefined || priceRaw === "") continue;

    const price = Number(priceRaw);
    const discountedRaw = fields[discountKey];
    const discountedPrice =
      discountedRaw === undefined || discountedRaw === ""
        ? null
        : Number(discountedRaw);

    sizes.push({ size, price, discountedPrice });
  }

  if (sizes.length === 0 && fields.sizes) {
    try {
      const parsed = JSON.parse(fields.sizes) as unknown;
      return sizeSchema.array().min(1).parse(parsed);
    } catch {
      // fall through
    }
  }

  return sizes;
}

function parseProductFields(fields: Record<string, string>): ParsedFields {
  const sizes = parseSizes(fields);
  return productFieldsSchema.parse({
    title: fields.title,
    subtitle: fields.subtitle || undefined,
    description: fields.description,
    artist: fields.artist || undefined,
    year: fields.year ? Number(fields.year) : undefined,
    category: fields.category,
    stock: fields.stock ? Number(fields.stock) : 0,
    sizes,
    status: fields.status as ProductStatus | undefined,
  });
}

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

async function nextCategoryTitle(categoryId: string, categoryName: string) {
  const count = await prisma.product.count({ where: { categoryId } });
  const number = count + 1;
  return {
    title: `${categoryName} ${number}`,
    description: `${categoryName} poster Nº ${String(number).padStart(3, "0")}`,
  };
}

async function findProductByIdOrSlug(id: string) {
  return prisma.product.findFirst({
    where: { OR: [{ id }, { slug: id }] },
    include: productInclude,
  });
}

async function uploadImages(productId: string, files: BufferedUpload[]) {
  const imageFiles = files.filter(isImageUpload);
  if (imageFiles.length === 0) return;

  const existing = await prisma.product.findUnique({
    where: { id: productId },
    select: { images: true },
  });
  const startOrder = existing?.images.length ?? 0;
  const newImages = [];

  for (let i = 0; i < imageFiles.length; i++) {
    const file = imageFiles[i]!;
    try {
      const imageId = randomUUID();
      const urls = await processAndUploadImage(productId, imageId, file.buffer);
      newImages.push({
        id: imageId,
        ...urls,
        sortOrder: startOrder + i,
      });
    } catch (err) {
      const reason = err instanceof Error ? err.message : "Unknown error";
      throw new Error(
        `Could not process image "${file.filename}": ${reason}. Use JPG, PNG, or WebP.`,
      );
    }
  }

  await prisma.product.update({
    where: { id: productId },
    data: { images: { push: newImages } },
  });
}

export async function productRoutes(app: FastifyInstance): Promise<void> {
  app.get("/api/products", async (request) => {
    const query = request.query as {
      category?: string;
      includeArchived?: string;
    };
    const categoryKey = query.category;

    const [products, categories] = await Promise.all([
      prisma.product.findMany({
        where: {
          status:
            query.includeArchived === "true"
              ? undefined
              : ProductStatus.ACTIVE,
          ...(categoryKey && categoryKey !== "all"
            ? { category: { slug: categoryKey } }
            : {}),
        },
        include: productInclude,
        orderBy: { createdAt: "desc" },
      }),
      prisma.category.findMany({ orderBy: { name: "asc" } }),
    ]);

    return {
      posters: products.map(toApiProduct),
      categories: toApiCategories(categories),
    };
  });

  app.get("/api/products/:slug", async (request, reply) => {
    const { slug } = request.params as { slug: string };
    const product = await prisma.product.findFirst({
      where: {
        OR: [{ slug }, { id: slug }],
        status: ProductStatus.ACTIVE,
      },
      include: productInclude,
    });

    if (!product) return reply.code(404).send({ error: "Product not found" });
    return toApiProduct(product);
  });

  app.post(
    "/api/products",
    { preHandler: [app.authenticateAdmin] },
    async (request, reply) => {
      try {
        const { fields, files } = await readMultipart(request);
        if (files.filter(isImageUpload).length === 0) {
          return reply
            .code(400)
            .send({ error: "Add at least one JPG, PNG, or WebP image." });
        }

        const category = await resolveCategory(fields.category || "Aesthetic");
        if (!fields.title?.trim()) {
          const next = await nextCategoryTitle(category.id, category.name);
          fields.title = next.title;
          fields.description = fields.description?.trim() || next.description;
        } else if (!fields.description?.trim()) {
          fields.description = fields.title;
        }
        fields.category = category.name;

        const data = parseProductFields(fields);

        const slug = await uniqueSlug(data.title, async (s) => {
          const found = await prisma.product.findUnique({ where: { slug: s } });
          return Boolean(found);
        });

        const product = await prisma.product.create({
          data: {
            slug,
            title: data.title,
            subtitle: data.subtitle,
            description: data.description,
            artist: data.artist,
            year: data.year,
            categoryId: category.id,
            stock: data.stock || 50,
            status: ProductStatus.ACTIVE,
            sizes: mapSizes(data.sizes),
            images: [],
          },
          include: productInclude,
        });

        await uploadImages(product.id, files);

        const full = await prisma.product.findUniqueOrThrow({
          where: { id: product.id },
          include: productInclude,
        });

        return reply.code(201).send(toApiProduct(full));
      } catch (err) {
        if (err instanceof z.ZodError) {
          return reply.code(400).send({
            error:
              err.issues.map((i) => i.message).join("; ") ||
              "Invalid product data",
          });
        }
        const message = err instanceof Error ? err.message : "Create failed";
        return reply.code(400).send({ error: message });
      }
    },
  );

  app.patch(
    "/api/products/:id",
    { preHandler: [app.authenticateAdmin] },
    async (request, reply) => {
      try {
        const { id } = request.params as { id: string };
        const existing = await findProductByIdOrSlug(id);
        if (!existing) return reply.code(404).send({ error: "Product not found" });

        const { fields, files } = await readMultipart(request);
        const data = parseProductFields(fields);
        const category = await resolveCategory(data.category);

        await prisma.product.update({
          where: { id: existing.id },
          data: {
            title: data.title,
            subtitle: data.subtitle,
            description: data.description,
            artist: data.artist,
            year: data.year,
            categoryId: category.id,
            stock: data.stock,
            status: data.status ?? existing.status,
            sizes: mapSizes(data.sizes),
          },
        });

        if (files.length > 0) {
          await uploadImages(existing.id, files);
        }

        const full = await prisma.product.findUniqueOrThrow({
          where: { id: existing.id },
          include: productInclude,
        });

        return toApiProduct(full);
      } catch (err) {
        if (err instanceof z.ZodError) {
          return reply.code(400).send({
            error:
              err.issues.map((i) => i.message).join("; ") ||
              "Invalid product data",
          });
        }
        const message = err instanceof Error ? err.message : "Update failed";
        return reply.code(400).send({ error: message });
      }
    },
  );

  app.patch(
    "/api/products/:id/status",
    { preHandler: [app.authenticateAdmin] },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      const body = z
        .object({ status: z.enum(["ACTIVE", "ARCHIVED"]) })
        .safeParse(request.body);
      if (!body.success) {
        return reply
          .code(400)
          .send({ error: "Body must be { status: \"ACTIVE\" | \"ARCHIVED\" }" });
      }

      const existing = await findProductByIdOrSlug(id);
      if (!existing) return reply.code(404).send({ error: "Product not found" });

      const updated = await prisma.product.update({
        where: { id: existing.id },
        data: { status: body.data.status as ProductStatus },
        include: productInclude,
      });

      return toApiProduct(updated);
    },
  );

  app.delete(
    "/api/products/:id",
    { preHandler: [app.authenticateAdmin] },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      const existing = await findProductByIdOrSlug(id);
      if (!existing) return reply.code(404).send({ error: "Product not found" });

      await prisma.product.update({
        where: { id: existing.id },
        data: { status: ProductStatus.ARCHIVED },
      });

      return { ok: true };
    },
  );

  app.post(
    "/api/products/:id/images",
    { preHandler: [app.authenticateAdmin] },
    async (request, reply) => {
      try {
        const { id } = request.params as { id: string };
        const existing = await findProductByIdOrSlug(id);
        if (!existing) return reply.code(404).send({ error: "Product not found" });

        const { files } = await readMultipart(request);
        if (files.filter(isImageUpload).length === 0) {
          return reply
            .code(400)
            .send({ error: "No images provided. Use JPG, PNG, or WebP." });
        }

        await uploadImages(existing.id, files);

        const full = await prisma.product.findUniqueOrThrow({
          where: { id: existing.id },
          include: productInclude,
        });

        return toApiProduct(full);
      } catch (err) {
        const message = err instanceof Error ? err.message : "Upload failed";
        return reply.code(400).send({ error: message });
      }
    },
  );

  app.delete(
    "/api/products/:id/images/:imageId",
    { preHandler: [app.authenticateAdmin] },
    async (request, reply) => {
      const { id, imageId } = request.params as { id: string; imageId: string };
      const existing = await findProductByIdOrSlug(id);
      if (!existing) return reply.code(404).send({ error: "Product not found" });

      const image = existing.images.find((img) => img.id === imageId);
      if (!image) return reply.code(404).send({ error: "Image not found" });

      await prisma.product.update({
        where: { id: existing.id },
        data: {
          images: existing.images.filter((img) => img.id !== imageId),
        },
      });

      return { ok: true };
    },
  );

  app.get(
    "/api/admin/products",
    { preHandler: [app.authenticateAdmin] },
    async () => {
      const products = await prisma.product.findMany({
        include: productInclude,
        orderBy: { createdAt: "desc" },
      });
      return { products: products.map(toApiProduct) };
    },
  );
}
