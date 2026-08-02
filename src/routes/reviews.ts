import type { FastifyInstance } from "fastify";
import { ReviewStatus } from "../lib/db.js";
import { z } from "zod";
import { prisma } from "../lib/prisma.js";

function serializeReview(
  review: {
    id: string;
    productId: string;
    customerId: string;
    rating: number;
    comment: string;
    status: ReviewStatus;
    createdAt: Date;
    updatedAt: Date;
  },
  customer?: { name: string; email: string } | null,
  product?: { slug: string; title: string } | null,
) {
  return {
    id: review.id,
    productId: review.productId,
    productSlug: product?.slug,
    productTitle: product?.title,
    customerId: review.customerId,
    customerName: customer?.name,
    customerEmail: customer?.email,
    rating: review.rating,
    comment: review.comment,
    status: review.status,
    createdAt: review.createdAt,
    updatedAt: review.updatedAt,
  };
}

export async function reviewRoutes(app: FastifyInstance): Promise<void> {
  app.get("/api/products/:id/reviews", async (request, reply) => {
    const { id } = request.params as { id: string };
    const product = await prisma.product.findFirst({
      where: { OR: [{ id }, { slug: id }] },
    });
    if (!product) return reply.code(404).send({ error: "Product not found" });

    const reviews = await prisma.review.findMany({
      where: { productId: product.id, status: ReviewStatus.APPROVED },
      include: { customer: { select: { name: true, email: true } } },
      orderBy: { createdAt: "desc" },
    });

    return {
      reviews: reviews.map((r) => serializeReview(r, r.customer, product)),
      averageRating:
        reviews.length === 0
          ? 0
          : Math.round(
              (reviews.reduce((s, r) => s + r.rating, 0) / reviews.length) * 10,
            ) / 10,
      count: reviews.length,
    };
  });

  app.post(
    "/api/reviews",
    { preHandler: [app.authenticateCustomer] },
    async (request, reply) => {
      const body = z
        .object({
          productId: z.string().min(1),
          rating: z.number().int().min(1).max(5),
          comment: z.string().min(3).max(2000),
        })
        .parse(request.body);

      const product = await prisma.product.findFirst({
        where: { OR: [{ id: body.productId }, { slug: body.productId }] },
      });
      if (!product) return reply.code(404).send({ error: "Product not found" });

      const existing = await prisma.review.findUnique({
        where: {
          productId_customerId: {
            productId: product.id,
            customerId: request.user.sub,
          },
        },
      });
      if (existing) {
        return reply
          .code(409)
          .send({ error: "You have already reviewed this product" });
      }

      const customer = await prisma.customer.findUnique({
        where: { id: request.user.sub },
      });

      const review = await prisma.review.create({
        data: {
          productId: product.id,
          customerId: request.user.sub,
          rating: body.rating,
          comment: body.comment.trim(),
          status: ReviewStatus.PENDING,
        },
      });

      return reply.code(201).send(serializeReview(review, customer, product));
    },
  );

  app.get(
    "/api/admin/reviews",
    { preHandler: [app.authenticateAdmin] },
    async (request) => {
      const query = request.query as { status?: string };
      const reviews = await prisma.review.findMany({
        where: query.status
          ? { status: query.status as ReviewStatus }
          : undefined,
        include: {
          customer: { select: { name: true, email: true } },
          product: { select: { slug: true, title: true } },
        },
        orderBy: { createdAt: "desc" },
      });

      return {
        reviews: reviews.map((r) => serializeReview(r, r.customer, r.product)),
      };
    },
  );

  app.patch(
    "/api/admin/reviews/:id",
    { preHandler: [app.authenticateAdmin] },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      const body = z
        .object({
          status: z.enum(["PENDING", "APPROVED", "HIDDEN"]),
        })
        .parse(request.body);

      const existing = await prisma.review.findUnique({ where: { id } });
      if (!existing) return reply.code(404).send({ error: "Review not found" });

      const review = await prisma.review.update({
        where: { id },
        data: { status: body.status as ReviewStatus },
        include: {
          customer: { select: { name: true, email: true } },
          product: { select: { slug: true, title: true } },
        },
      });

      return serializeReview(review, review.customer, review.product);
    },
  );
}
