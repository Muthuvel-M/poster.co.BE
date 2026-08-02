import type { FastifyInstance } from "fastify";
import { ProductStatus } from "../lib/db.js";
import { prisma } from "../lib/prisma.js";
import { toApiProduct } from "../lib/serializers.js";

const productInclude = { category: true } as const;

/**
 * Co-purchase recommendations with category fallback.
 */
export async function recommendationRoutes(
  app: FastifyInstance,
): Promise<void> {
  app.get("/api/products/:id/recommendations", async (request, reply) => {
    const { id } = request.params as { id: string };
    const product = await prisma.product.findFirst({
      where: {
        OR: [{ id }, { slug: id }],
        status: ProductStatus.ACTIVE,
      },
      include: productInclude,
    });
    if (!product) return reply.code(404).send({ error: "Product not found" });

    const orders = await prisma.order.findMany({
      where: { status: { not: "CANCELLED" } },
      take: 200,
      orderBy: { createdAt: "desc" },
    });

    const counts = new Map<string, number>();
    for (const order of orders) {
      const hasProduct = order.lines.some((l) => l.productId === product.id);
      if (!hasProduct) continue;
      const seen = new Set<string>();
      for (const line of order.lines) {
        if (line.productId === product.id || seen.has(line.productId)) continue;
        seen.add(line.productId);
        counts.set(line.productId, (counts.get(line.productId) ?? 0) + 1);
      }
    }

    const rankedIds = [...counts.entries()]
      .sort((a, b) => b[1] - a[1])
      .map(([pid]) => pid)
      .slice(0, 8);

    let related =
      rankedIds.length > 0
        ? await prisma.product.findMany({
            where: {
              id: { in: rankedIds },
              status: ProductStatus.ACTIVE,
            },
            include: productInclude,
          })
        : [];

    related = rankedIds
      .map((pid) => related.find((p) => p.id === pid))
      .filter(Boolean) as typeof related;

    if (related.length < 4) {
      const exclude = new Set([product.id, ...related.map((p) => p.id)]);
      const fallback = await prisma.product.findMany({
        where: {
          categoryId: product.categoryId,
          status: ProductStatus.ACTIVE,
        },
        include: productInclude,
        take: 12,
        orderBy: { createdAt: "desc" },
      });
      for (const p of fallback) {
        if (exclude.has(p.id)) continue;
        related.push(p);
        if (related.length >= 8) break;
      }
    }

    return {
      recommendations: related.map(toApiProduct),
      source: rankedIds.length ? "co-purchase" : "category",
    };
  });

  app.get("/api/products/trending", async () => {
    const recent = await prisma.order.findMany({
      where: {
        status: { not: "CANCELLED" },
        createdAt: { gte: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000) },
      },
      take: 200,
      orderBy: { createdAt: "desc" },
    });

    const counts = new Map<string, number>();
    for (const order of recent) {
      for (const line of order.lines) {
        counts.set(
          line.productId,
          (counts.get(line.productId) ?? 0) + line.qty,
        );
      }
    }

    const topIds = [...counts.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 12)
      .map(([id]) => id);

    const products =
      topIds.length > 0
        ? await prisma.product.findMany({
            where: { id: { in: topIds }, status: ProductStatus.ACTIVE },
            include: productInclude,
          })
        : [];

    const ordered = topIds
      .map((id) => products.find((p) => p.id === id))
      .filter(Boolean);

    return { posters: ordered.map((p) => toApiProduct(p!)) };
  });
}
