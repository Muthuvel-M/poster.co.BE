import type { FastifyInstance } from "fastify";
import { ProductStatus } from "../lib/db.js";
import { prisma } from "../lib/prisma.js";
import { toApiProduct } from "../lib/serializers.js";

/** Wall makeover / bundle SKUs (products flagged isBundle) */
export async function registerBundleListRoute(
  app: FastifyInstance,
): Promise<void> {
  app.get("/api/bundles", async () => {
    const products = await prisma.product.findMany({
      where: { isBundle: true, status: ProductStatus.ACTIVE },
      include: { category: true },
      orderBy: { createdAt: "desc" },
    });
    return { bundles: products.map(toApiProduct) };
  });
}
