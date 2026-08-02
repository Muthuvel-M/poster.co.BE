import type { FastifyInstance } from "fastify";
import { randomBytes } from "node:crypto";
import { z } from "zod";
import { prisma } from "../lib/prisma.js";
import { writeAuditLog } from "../lib/audit.js";

function serialize(g: {
  id: string;
  code: string;
  initialBalance: number;
  balance: number;
  active: boolean;
  expiresAt: Date | null;
  createdAt: Date;
}) {
  return {
    id: g.id,
    code: g.code,
    initialBalance: g.initialBalance,
    balance: g.balance,
    active: g.active,
    expiresAt: g.expiresAt,
    createdAt: g.createdAt,
  };
}

export async function giftCardRoutes(app: FastifyInstance): Promise<void> {
  app.post("/api/gift-cards/validate", async (request, reply) => {
    const body = z.object({ code: z.string().min(1) }).parse(request.body);
    const card = await prisma.giftCard.findUnique({
      where: { code: body.code.trim().toUpperCase() },
    });
    if (!card || !card.active) {
      return reply.code(400).send({ error: "Invalid gift card" });
    }
    if (card.expiresAt && card.expiresAt < new Date()) {
      return reply.code(400).send({ error: "Gift card expired" });
    }
    return { code: card.code, balance: card.balance };
  });

  app.get(
    "/api/admin/gift-cards",
    { preHandler: [app.authenticateAdmin] },
    async () => {
      const cards = await prisma.giftCard.findMany({
        orderBy: { createdAt: "desc" },
      });
      return { giftCards: cards.map(serialize) };
    },
  );

  app.post(
    "/api/admin/gift-cards",
    { preHandler: [app.authenticateAdmin] },
    async (request, reply) => {
      const body = z
        .object({
          amount: z.number().int().min(50).max(50000),
          expiresAt: z.string().datetime().optional(),
        })
        .parse(request.body);

      const code = `AFGC-${randomBytes(4).toString("hex").toUpperCase()}`;
      const card = await prisma.giftCard.create({
        data: {
          code,
          initialBalance: body.amount,
          balance: body.amount,
          expiresAt: body.expiresAt ? new Date(body.expiresAt) : null,
        },
      });

      await writeAuditLog({
        actorId: request.user.sub,
        actorEmail: request.user.email,
        action: "giftcard.create",
        entity: "GiftCard",
        entityId: card.id,
        meta: { code: card.code, amount: body.amount },
      });

      return reply.code(201).send(serialize(card));
    },
  );

  app.patch(
    "/api/admin/gift-cards/:id",
    { preHandler: [app.authenticateAdmin] },
    async (request) => {
      const { id } = request.params as { id: string };
      const body = z.object({ active: z.boolean() }).parse(request.body);
      const card = await prisma.giftCard.update({
        where: { id },
        data: { active: body.active },
      });
      return serialize(card);
    },
  );
}
