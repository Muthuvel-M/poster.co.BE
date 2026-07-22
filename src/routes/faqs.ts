import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { prisma } from "../lib/prisma.js";

function serializeFaq(faq: {
  id: string;
  question: string;
  answer: string;
  sortOrder: number;
  published: boolean;
  createdAt: Date;
  updatedAt: Date;
}) {
  return {
    id: faq.id,
    question: faq.question,
    answer: faq.answer,
    sortOrder: faq.sortOrder,
    published: faq.published,
    createdAt: faq.createdAt,
    updatedAt: faq.updatedAt,
  };
}

export async function faqRoutes(app: FastifyInstance): Promise<void> {
  app.get("/api/faqs", async () => {
    const faqs = await prisma.faq.findMany({
      where: { published: true },
      orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
    });
    return { faqs: faqs.map(serializeFaq) };
  });

  app.get(
    "/api/admin/faqs",
    { preHandler: [app.authenticateAdmin] },
    async () => {
      const faqs = await prisma.faq.findMany({
        orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
      });
      return { faqs: faqs.map(serializeFaq) };
    },
  );

  app.post(
    "/api/admin/faqs",
    { preHandler: [app.authenticateAdmin] },
    async (request, reply) => {
      const body = z
        .object({
          question: z.string().min(1),
          answer: z.string().min(1),
          sortOrder: z.number().int().optional(),
          published: z.boolean().optional(),
        })
        .parse(request.body);

      const maxSort = await prisma.faq.aggregate({ _max: { sortOrder: true } });
      const faq = await prisma.faq.create({
        data: {
          question: body.question.trim(),
          answer: body.answer.trim(),
          sortOrder: body.sortOrder ?? (maxSort._max.sortOrder ?? 0) + 1,
          published: body.published ?? true,
        },
      });

      return reply.code(201).send(serializeFaq(faq));
    },
  );

  app.patch(
    "/api/admin/faqs/:id",
    { preHandler: [app.authenticateAdmin] },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      const body = z
        .object({
          question: z.string().min(1).optional(),
          answer: z.string().min(1).optional(),
          sortOrder: z.number().int().optional(),
          published: z.boolean().optional(),
        })
        .parse(request.body);

      const existing = await prisma.faq.findUnique({ where: { id } });
      if (!existing) return reply.code(404).send({ error: "FAQ not found" });

      const faq = await prisma.faq.update({
        where: { id },
        data: {
          ...(body.question !== undefined && { question: body.question.trim() }),
          ...(body.answer !== undefined && { answer: body.answer.trim() }),
          ...(body.sortOrder !== undefined && { sortOrder: body.sortOrder }),
          ...(body.published !== undefined && { published: body.published }),
        },
      });

      return serializeFaq(faq);
    },
  );

  app.delete(
    "/api/admin/faqs/:id",
    { preHandler: [app.authenticateAdmin] },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      const existing = await prisma.faq.findUnique({ where: { id } });
      if (!existing) return reply.code(404).send({ error: "FAQ not found" });

      await prisma.faq.delete({ where: { id } });
      return { ok: true };
    },
  );
}
