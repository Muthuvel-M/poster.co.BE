import type { FastifyInstance } from "fastify";
import type { Multipart, MultipartFile } from "@fastify/multipart";
import { Size, ProductStatus } from "@prisma/client";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { prisma } from "../lib/prisma.js";
import { slugify, uniqueSlug } from "../lib/slug.js";
import { processAndUploadImage } from "../lib/storage.js";
import { toApiCategories, toApiProduct } from "../lib/serializers.js";

const productInclude = {
  category: true,
  sizes: true,
  images: true,
} as const;

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

async function readParts(request: { parts: () => AsyncIterable<Multipart> }) {
  const fields: Record<string, string> = {};
  const files: MultipartFile[] = [];

  for await (const part of request.parts()) {
    if (part.type === "file") {
      files.push(part);
    } else {
      fields[part.fieldname] = String(part.value);
    }
  }

  return { fields, files };
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
  const existing = await prisma.category.findFirst({
    where: { OR: [{ slug }, { name: { equals: categoryInput, mode: "insensitive" } }] },
  });
  if (existing) return existing;

  return prisma.category.create({
    data: {
      name: categoryInput.trim(),
      slug: slug || "general",
    },
  });
}

async function findProductByIdOrSlug(id: string) {
  return prisma.product.findFirst({
    where: { OR: [{ id }, { slug: id }] },
    include: productInclude,
  });
}

async function uploadImages(productId: string, files: MultipartFile[]) {
  const existingCount = await prisma.productImage.count({ where: { productId } });

  for (let i = 0; i < files.length; i++) {
    const file = files[i]!;
    const buffer = await file.toBuffer();
    const imageId = randomUUID();
    const urls = await processAndUploadImage(productId, imageId, buffer);

    await prisma.productImage.create({
      data: {
        productId,
        ...urls,
        sortOrder: existingCount + i,
      },
    });
  }
}

export async function productRoutes(app: FastifyInstance): Promise<void> {
  app.get("/api/products", async (request) => {
    const query = request.query as { category?: string; includeArchived?: string };
    const categoryKey = query.category;

    const [products, categories] = await Promise.all([
      prisma.product.findMany({
        where: {
          status: query.includeArchived === "true" ? undefined : ProductStatus.ACTIVE,
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
    { preHandler: [app.authenticate] },
    async (request, reply) => {
      const { fields, files } = await readParts(request);
      const data = parseProductFields(fields);
      const category = await resolveCategory(data.category);

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
          stock: data.stock,
          status: ProductStatus.ACTIVE,
          sizes: {
            create: data.sizes.map((s) => ({
              size: s.size as Size,
              price: s.price,
              discountedPrice: s.discountedPrice ?? null,
            })),
          },
        },
        include: productInclude,
      });

      if (files.length > 0) {
        await uploadImages(product.id, files);
      }

      const full = await prisma.product.findUniqueOrThrow({
        where: { id: product.id },
        include: productInclude,
      });

      return reply.code(201).send(toApiProduct(full));
    },
  );

  app.patch(
    "/api/products/:id",
    { preHandler: [app.authenticate] },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      const existing = await findProductByIdOrSlug(id);
      if (!existing) return reply.code(404).send({ error: "Product not found" });

      const { fields, files } = await readParts(request);
      const data = parseProductFields(fields);
      const category = await resolveCategory(data.category);

      await prisma.productSize.deleteMany({ where: { productId: existing.id } });

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
          sizes: {
            create: data.sizes.map((s) => ({
              size: s.size as Size,
              price: s.price,
              discountedPrice: s.discountedPrice ?? null,
            })),
          },
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
    },
  );

  app.delete(
    "/api/products/:id",
    { preHandler: [app.authenticate] },
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
    { preHandler: [app.authenticate] },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      const existing = await findProductByIdOrSlug(id);
      if (!existing) return reply.code(404).send({ error: "Product not found" });

      const { files } = await readParts(request);
      if (files.length === 0) {
        return reply.code(400).send({ error: "No images provided" });
      }

      await uploadImages(existing.id, files);

      const full = await prisma.product.findUniqueOrThrow({
        where: { id: existing.id },
        include: productInclude,
      });

      return toApiProduct(full);
    },
  );

  app.delete(
    "/api/products/:id/images/:imageId",
    { preHandler: [app.authenticate] },
    async (request, reply) => {
      const { id, imageId } = request.params as { id: string; imageId: string };
      const existing = await findProductByIdOrSlug(id);
      if (!existing) return reply.code(404).send({ error: "Product not found" });

      const image = await prisma.productImage.findFirst({
        where: { id: imageId, productId: existing.id },
      });
      if (!image) return reply.code(404).send({ error: "Image not found" });

      await prisma.productImage.delete({ where: { id: imageId } });
      return { ok: true };
    },
  );

  app.get(
    "/api/admin/products",
    { preHandler: [app.authenticate] },
    async () => {
      const products = await prisma.product.findMany({
        include: productInclude,
        orderBy: { createdAt: "desc" },
      });
      return { products: products.map(toApiProduct) };
    },
  );
}
