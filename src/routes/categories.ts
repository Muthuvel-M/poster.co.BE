import type { FastifyInstance } from "fastify";
import { prisma } from "../lib/prisma.js";
import { toApiCategories } from "../lib/serializers.js";

export async function categoryRoutes(app: FastifyInstance): Promise<void> {
  app.get("/api/categories", async () => {
    const categories = await prisma.category.findMany({ orderBy: { name: "asc" } });
    return { categories: toApiCategories(categories) };
  });
}
