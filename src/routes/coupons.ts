import type { FastifyInstance } from "fastify";
import { CouponType } from "../lib/db.js";
import { z } from "zod";
import { prisma } from "../lib/prisma.js";
import { writeAuditLog } from "../lib/audit.js";

function serializeCoupon(c: {
  id: string;
  code: string;
  type: CouponType;
  value: number;
  minOrder: number;
  maxUses: number | null;
  usedCount: number;
  active: boolean;
  expiresAt: Date | null;
  createdAt: Date;
}) {
  return {
    id: c.id,
    code: c.code,
    type: c.type,
    value: c.value,
    minOrder: c.minOrder,
    maxUses: c.maxUses,
    usedCount: c.usedCount,
    active: c.active,
    expiresAt: c.expiresAt,
    createdAt: c.createdAt,
  };
}

export async function couponRoutes(app: FastifyInstance): Promise<void> {
  app.post("/api/coupons/validate", async (request, reply) => {
    const body = z
      .object({
        code: z.string().min(1),
        subtotal: z.number().int().min(0),
      })
      .parse(request.body);

    const coupon = await prisma.coupon.findUnique({
      where: { code: body.code.trim().toUpperCase() },
    });
    if (!coupon || !coupon.active) {
      return reply.code(400).send({ error: "Invalid or inactive coupon" });
    }
    if (coupon.expiresAt && coupon.expiresAt < new Date()) {
      return reply.code(400).send({ error: "Coupon has expired" });
    }
    if (coupon.maxUses != null && coupon.usedCount >= coupon.maxUses) {
      return reply.code(400).send({ error: "Coupon usage limit reached" });
    }
    if (body.subtotal < coupon.minOrder) {
      return reply.code(400).send({
        error: `Minimum order ₹${coupon.minOrder} required`,
      });
    }

    const discount =
      coupon.type === "PERCENT"
        ? Math.min(
            body.subtotal,
            Math.round((body.subtotal * coupon.value) / 100),
          )
        : Math.min(body.subtotal, coupon.value);

    return {
      code: coupon.code,
      type: coupon.type,
      value: coupon.value,
      discount,
    };
  });

  app.get(
    "/api/admin/coupons",
    { preHandler: [app.authenticateAdmin] },
    async () => {
      const coupons = await prisma.coupon.findMany({
        orderBy: { createdAt: "desc" },
      });
      return { coupons: coupons.map(serializeCoupon) };
    },
  );

  app.post(
    "/api/admin/coupons",
    { preHandler: [app.authenticateAdmin] },
    async (request, reply) => {
      const body = z
        .object({
          code: z.string().min(2).max(32),
          type: z.enum(["PERCENT", "FIXED"]),
          value: z.number().int().min(1),
          minOrder: z.number().int().min(0).default(0),
          maxUses: z.number().int().min(1).optional(),
          expiresAt: z.string().datetime().optional(),
          active: z.boolean().default(true),
        })
        .parse(request.body);

      if (body.type === "PERCENT" && body.value > 100) {
        return reply.code(400).send({ error: "Percent cannot exceed 100" });
      }

      const coupon = await prisma.coupon.create({
        data: {
          code: body.code.trim().toUpperCase(),
          type: body.type as CouponType,
          value: body.value,
          minOrder: body.minOrder,
          maxUses: body.maxUses ?? null,
          expiresAt: body.expiresAt ? new Date(body.expiresAt) : null,
          active: body.active,
        },
      });

      await writeAuditLog({
        actorId: request.user.sub,
        actorEmail: request.user.email,
        action: "coupon.create",
        entity: "Coupon",
        entityId: coupon.id,
        meta: { code: coupon.code },
      });

      return reply.code(201).send(serializeCoupon(coupon));
    },
  );

  app.patch(
    "/api/admin/coupons/:id",
    { preHandler: [app.authenticateAdmin] },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      const body = z
        .object({
          active: z.boolean().optional(),
          maxUses: z.number().int().min(1).nullable().optional(),
          expiresAt: z.string().datetime().nullable().optional(),
          minOrder: z.number().int().min(0).optional(),
        })
        .parse(request.body);

      const coupon = await prisma.coupon.update({
        where: { id },
        data: {
          ...(body.active !== undefined ? { active: body.active } : {}),
          ...(body.maxUses !== undefined ? { maxUses: body.maxUses } : {}),
          ...(body.expiresAt !== undefined
            ? {
                expiresAt: body.expiresAt ? new Date(body.expiresAt) : null,
              }
            : {}),
          ...(body.minOrder !== undefined ? { minOrder: body.minOrder } : {}),
        },
      });

      return serializeCoupon(coupon);
    },
  );

  app.delete(
    "/api/admin/coupons/:id",
    { preHandler: [app.authenticateAdmin] },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      await prisma.coupon.delete({ where: { id } });
      await writeAuditLog({
        actorId: request.user.sub,
        actorEmail: request.user.email,
        action: "coupon.delete",
        entity: "Coupon",
        entityId: id,
      });
      return reply.code(204).send();
    },
  );
}
