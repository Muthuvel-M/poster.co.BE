import type { FastifyInstance } from "fastify";
import { ProductStatus } from "../lib/db.js";
import { z } from "zod";
import { prisma } from "../lib/prisma.js";
import { toApiProduct } from "../lib/serializers.js";

const productInclude = { category: true } as const;

export async function wishlistRoutes(app: FastifyInstance): Promise<void> {
  app.get(
    "/api/wishlist",
    { preHandler: [app.authenticateCustomer] },
    async (request) => {
      const items = await prisma.wishlistItem.findMany({
        where: { customerId: request.user.sub },
        include: { product: { include: productInclude } },
        orderBy: { createdAt: "desc" },
      });
      return {
        items: items
          .filter((i) => i.product.status === ProductStatus.ACTIVE)
          .map((i) => ({
            id: i.id,
            productId: i.productId,
            createdAt: i.createdAt,
            product: toApiProduct(i.product),
          })),
      };
    },
  );

  app.post(
    "/api/wishlist",
    { preHandler: [app.authenticateCustomer] },
    async (request, reply) => {
      const body = z.object({ productId: z.string().min(1) }).parse(request.body);
      const product = await prisma.product.findFirst({
        where: {
          OR: [{ id: body.productId }, { slug: body.productId }],
          status: ProductStatus.ACTIVE,
        },
      });
      if (!product) {
        return reply.code(404).send({ error: "Product not found" });
      }

      const item = await prisma.wishlistItem.upsert({
        where: {
          customerId_productId: {
            customerId: request.user.sub,
            productId: product.id,
          },
        },
        create: {
          customerId: request.user.sub,
          productId: product.id,
        },
        update: {},
      });

      return reply.code(201).send({ id: item.id, productId: item.productId });
    },
  );

  app.delete(
    "/api/wishlist/:productId",
    { preHandler: [app.authenticateCustomer] },
    async (request, reply) => {
      const { productId } = request.params as { productId: string };
      await prisma.wishlistItem.deleteMany({
        where: { customerId: request.user.sub, productId },
      });
      return reply.code(204).send();
    },
  );
}
