import type { FastifyInstance } from "fastify";
import { OrderStatus, ProductStatus, Size } from "../lib/db.js";
import { z } from "zod";
import { prisma } from "../lib/prisma.js";
import {
  allocateLineTotals,
  priceOrderLines,
  SIZE_PRICE,
  type PosterSize,
} from "../lib/pricing.js";
import {
  getComboSettings,
  getSizePriceMap,
} from "../lib/pricing-settings.js";
import { writeAuditLog } from "../lib/audit.js";

const orderLineSchema = z.object({
  productId: z.string().min(1),
  slug: z.string().min(1),
  title: z.string().min(1),
  size: z.enum(["A4", "A5", "A6"]),
  qty: z.number().int().min(1),
  unitPrice: z.number().int().min(0),
  lineTotal: z.number().int().min(0),
  imageUrl: z.string().optional(),
});

const createOrderSchema = z.object({
  customer: z.object({
    name: z.string().min(1),
    email: z.string().email(),
    phone: z.string().min(5),
    address: z.string().min(1),
    city: z.string().optional(),
    zip: z.string().optional(),
    country: z.string().optional(),
  }),
  lines: z.array(orderLineSchema).min(1),
  subtotal: z.number().int().min(0),
  shipping: z.number().int().min(0),
  total: z.number().int().min(0),
  couponCode: z.string().optional(),
});

/** Allowed transitions for WhatsApp prepaid ops */
const ALLOWED_TRANSITIONS: Record<OrderStatus, OrderStatus[]> = {
  PENDING: [OrderStatus.CONFIRMED, OrderStatus.CANCELLED],
  CONFIRMED: [OrderStatus.SHIPPED, OrderStatus.CANCELLED],
  SHIPPED: [OrderStatus.DELIVERED, OrderStatus.CANCELLED],
  DELIVERED: [],
  CANCELLED: [],
};

function generateOrderId(): string {
  const n = Date.now().toString(36).toUpperCase();
  const r = Math.random().toString(36).slice(2, 6).toUpperCase();
  return `AF-${n}-${r}`;
}

function serializeOrder(order: {
  id: string;
  orderId: string;
  customerId: string | null;
  customerSnapshot: {
    name: string;
    email: string;
    phone: string;
    address: string;
    city?: string | null;
    zip?: string | null;
    country?: string | null;
  };
  lines: Array<{
    productId: string;
    slug: string;
    title: string;
    size: Size;
    qty: number;
    unitPrice: number;
    lineTotal: number;
    imageUrl?: string | null;
  }>;
  subtotal: number;
  shipping: number;
  discount?: number;
  couponCode?: string | null;
  total: number;
  status: OrderStatus;
  trackingNumber?: string | null;
  whatsappOpenedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}) {
  return {
    id: order.id,
    orderId: order.orderId,
    customerId: order.customerId,
    customer: {
      name: order.customerSnapshot.name,
      email: order.customerSnapshot.email,
      phone: order.customerSnapshot.phone,
      address: order.customerSnapshot.address,
      city: order.customerSnapshot.city ?? undefined,
      zip: order.customerSnapshot.zip ?? undefined,
      country: order.customerSnapshot.country ?? undefined,
    },
    lines: order.lines.map((l) => ({
      productId: l.productId,
      slug: l.slug,
      title: l.title,
      size: l.size,
      qty: l.qty,
      unitPrice: l.unitPrice,
      lineTotal: l.lineTotal,
      imageUrl: l.imageUrl ?? undefined,
    })),
    subtotal: order.subtotal,
    shipping: order.shipping,
    discount: order.discount ?? 0,
    couponCode: order.couponCode ?? undefined,
    total: order.total,
    status: order.status,
    trackingNumber: order.trackingNumber ?? undefined,
    whatsappOpenedAt: order.whatsappOpenedAt,
    createdAt: order.createdAt,
    updatedAt: order.updatedAt,
  };
}

async function applyCoupon(
  code: string | undefined,
  subtotal: number,
): Promise<{ discount: number; couponCode?: string; couponId?: string }> {
  if (!code?.trim()) return { discount: 0 };
  const coupon = await prisma.coupon.findUnique({
    where: { code: code.trim().toUpperCase() },
  });
  if (!coupon || !coupon.active) {
    throw Object.assign(new Error("Invalid or inactive coupon"), { statusCode: 400 });
  }
  if (coupon.expiresAt && coupon.expiresAt < new Date()) {
    throw Object.assign(new Error("Coupon has expired"), { statusCode: 400 });
  }
  if (coupon.maxUses != null && coupon.usedCount >= coupon.maxUses) {
    throw Object.assign(new Error("Coupon usage limit reached"), { statusCode: 400 });
  }
  if (subtotal < coupon.minOrder) {
    throw Object.assign(
      new Error(`Coupon requires minimum order of ₹${coupon.minOrder}`),
      { statusCode: 400 },
    );
  }
  const discount =
    coupon.type === "PERCENT"
      ? Math.min(subtotal, Math.round((subtotal * coupon.value) / 100))
      : Math.min(subtotal, coupon.value);
  return { discount, couponCode: coupon.code, couponId: coupon.id };
}

export async function orderRoutes(app: FastifyInstance): Promise<void> {
  app.post(
    "/api/orders",
    { preHandler: [app.authenticateOptional] },
    async (request, reply) => {
      let body: z.infer<typeof createOrderSchema>;
      try {
        body = createOrderSchema.parse(request.body);
      } catch (err) {
        return reply.code(400).send({
          error: err instanceof z.ZodError ? err.errors[0]?.message : "Invalid order",
        });
      }

      const customerId =
        request.user?.role === "customer" ? request.user.sub : undefined;
      const sizePrice = await getSizePriceMap();
      const combos = await getComboSettings();

      // Validate products exist, are ACTIVE, and have enough stock
      const qtyByProduct = new Map<string, number>();
      for (const line of body.lines) {
        qtyByProduct.set(
          line.productId,
          (qtyByProduct.get(line.productId) ?? 0) + line.qty,
        );
      }

      const productIds = [...qtyByProduct.keys()];
      const products = await prisma.product.findMany({
        where: {
          OR: [{ id: { in: productIds } }, { slug: { in: productIds } }],
        },
      });
      // Map both id and slug → product for lookup from client payloads
      const productMap = new Map<string, (typeof products)[number]>();
      for (const p of products) {
        productMap.set(p.id, p);
        productMap.set(p.slug, p);
      }

      const resolvedQtyByProduct = new Map<string, number>();
      for (const [key, qty] of qtyByProduct) {
        const product = productMap.get(key);
        if (!product || product.status !== ProductStatus.ACTIVE) {
          return reply
            .code(400)
            .send({ error: `Product unavailable: ${key}` });
        }
        resolvedQtyByProduct.set(
          product.id,
          (resolvedQtyByProduct.get(product.id) ?? 0) + qty,
        );
      }

      for (const [productId, qty] of resolvedQtyByProduct) {
        const product = products.find((p) => p.id === productId)!;
        if (product.stock < qty) {
          return reply.code(400).send({
            error: `Insufficient stock for "${product.title}" (need ${qty}, have ${product.stock})`,
          });
        }
      }

      // Prefer catalog titles/slugs/images over client snapshot
      const resolvedLines = body.lines.map((l) => {
        const p = productMap.get(l.productId)!;
        return {
          productId: p.id,
          slug: p.slug,
          title: p.title,
          size: l.size as PosterSize,
          qty: l.qty,
          imageUrl: l.imageUrl ?? p.images[0]?.cardUrl ?? p.images[0]?.url,
        };
      });

      const priced = priceOrderLines(
        resolvedLines.map((l) => ({ size: l.size, qty: l.qty })),
        sizePrice,
        combos,
      );

      let discount = 0;
      let couponCode: string | undefined;
      let couponId: string | undefined;
      try {
        const applied = await applyCoupon(body.couponCode, priced.subtotal);
        discount = applied.discount;
        couponCode = applied.couponCode;
        couponId = applied.couponId;
      } catch (e) {
        const err = e as Error & { statusCode?: number };
        return reply
          .code(err.statusCode ?? 400)
          .send({ error: err.message });
      }

      const total = Math.max(0, priced.subtotal - discount) + priced.shipping;
      const allocated = allocateLineTotals(
        resolvedLines.map((l) => ({ size: l.size, qty: l.qty })),
        sizePrice,
        priced.subtotal,
      );

      try {
        const order = await prisma.$transaction(async (tx) => {
          for (const [productId, qty] of resolvedQtyByProduct) {
            const updated = await tx.product.updateMany({
              where: {
                id: productId,
                status: ProductStatus.ACTIVE,
                stock: { gte: qty },
              },
              data: { stock: { decrement: qty } },
            });
            if (updated.count !== 1) {
              throw Object.assign(
                new Error("Stock changed during checkout — please retry"),
                { statusCode: 409 },
              );
            }
          }

          if (couponId) {
            await tx.coupon.update({
              where: { id: couponId },
              data: { usedCount: { increment: 1 } },
            });
          }

          const created = await tx.order.create({
            data: {
              orderId: generateOrderId(),
              customerId: customerId ?? null,
              customerSnapshot: {
                name: body.customer.name.trim(),
                email: body.customer.email.trim().toLowerCase(),
                phone: body.customer.phone.trim(),
                address: body.customer.address.trim(),
                city: body.customer.city?.trim(),
                zip: body.customer.zip?.trim(),
                country: body.customer.country?.trim() ?? "India",
              },
              lines: resolvedLines.map((l, i) => ({
                productId: l.productId,
                slug: l.slug,
                title: l.title,
                size: l.size as Size,
                qty: l.qty,
                unitPrice: allocated[i]!.unitPrice,
                lineTotal: allocated[i]!.lineTotal,
                imageUrl: l.imageUrl,
              })),
              subtotal: priced.subtotal,
              shipping: priced.shipping,
              discount,
              couponCode: couponCode ?? null,
              total,
              status: OrderStatus.PENDING,
              whatsappOpenedAt: new Date(),
            },
          });

          // Loyalty: 1 point per ₹10 spent (logged-in only)
          if (customerId && total > 0) {
            const points = Math.floor(total / 10);
            if (points > 0) {
              await tx.customer.update({
                where: { id: customerId },
                data: { loyaltyPoints: { increment: points } },
              });
              await tx.loyaltyTransaction.create({
                data: {
                  customerId,
                  points,
                  reason: "order",
                  orderId: created.orderId,
                },
              });
            }
          }

          return created;
        });

        return reply.code(201).send(serializeOrder(order));
      } catch (e) {
        const err = e as Error & { statusCode?: number };
        return reply
          .code(err.statusCode ?? 500)
          .send({ error: err.message || "Failed to create order" });
      }
    },
  );

  app.get(
    "/api/orders/me",
    { preHandler: [app.authenticateCustomer] },
    async (request) => {
      const orders = await prisma.order.findMany({
        where: { customerId: request.user.sub },
        orderBy: { createdAt: "desc" },
      });
      return { orders: orders.map(serializeOrder) };
    },
  );

  app.get(
    "/api/orders/:orderId",
    { preHandler: [app.authenticateOptional] },
    async (request, reply) => {
      const { orderId } = request.params as { orderId: string };
      const order = await prisma.order.findFirst({
        where: { OR: [{ orderId }, { id: orderId }] },
      });
      if (!order) return reply.code(404).send({ error: "Order not found" });

      const isOwner =
        request.user?.role === "customer" &&
        order.customerId === request.user.sub;
      const isAdmin = request.user?.role === "admin";
      if (!isOwner && !isAdmin) {
        // Allow guest lookup by orderId only (tracking page)
        if (request.user) {
          return reply.code(403).send({ error: "Forbidden" });
        }
      }

      return serializeOrder(order);
    },
  );

  app.get(
    "/api/admin/orders",
    { preHandler: [app.authenticateAdmin] },
    async (request) => {
      const query = request.query as { status?: string };
      const orders = await prisma.order.findMany({
        where: query.status
          ? { status: query.status as OrderStatus }
          : undefined,
        orderBy: { createdAt: "desc" },
      });
      return { orders: orders.map(serializeOrder) };
    },
  );

  app.patch(
    "/api/admin/orders/:id",
    { preHandler: [app.authenticateAdmin] },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      let body: { status?: OrderStatus; trackingNumber?: string };
      try {
        body = z
          .object({
            status: z
              .enum([
                "PENDING",
                "CONFIRMED",
                "SHIPPED",
                "DELIVERED",
                "CANCELLED",
              ])
              .optional(),
            trackingNumber: z.string().optional(),
          })
          .parse(request.body);
      } catch (err) {
        return reply.code(400).send({
          error: err instanceof z.ZodError ? err.errors[0]?.message : "Invalid",
        });
      }

      const existing = await prisma.order.findFirst({
        where: { OR: [{ id }, { orderId: id }] },
      });
      if (!existing) return reply.code(404).send({ error: "Order not found" });

      if (body.status && body.status !== existing.status) {
        const allowed = ALLOWED_TRANSITIONS[existing.status] ?? [];
        if (!allowed.includes(body.status)) {
          return reply.code(400).send({
            error: `Cannot transition from ${existing.status} to ${body.status}`,
          });
        }
      }

      // Restock on cancel
      if (
        body.status === OrderStatus.CANCELLED &&
        existing.status !== OrderStatus.CANCELLED
      ) {
        const qtyByProduct = new Map<string, number>();
        for (const line of existing.lines) {
          qtyByProduct.set(
            line.productId,
            (qtyByProduct.get(line.productId) ?? 0) + line.qty,
          );
        }
        await prisma.$transaction(async (tx) => {
          for (const [productId, qty] of qtyByProduct) {
            await tx.product.updateMany({
              where: { id: productId },
              data: { stock: { increment: qty } },
            });
          }
          await tx.order.update({
            where: { id: existing.id },
            data: {
              status: OrderStatus.CANCELLED,
              ...(body.trackingNumber !== undefined
                ? { trackingNumber: body.trackingNumber }
                : {}),
            },
          });
        });
      } else {
        await prisma.order.update({
          where: { id: existing.id },
          data: {
            ...(body.status ? { status: body.status as OrderStatus } : {}),
            ...(body.trackingNumber !== undefined
              ? { trackingNumber: body.trackingNumber }
              : {}),
          },
        });
      }

      const order = await prisma.order.findUniqueOrThrow({
        where: { id: existing.id },
      });

      await writeAuditLog({
        actorId: request.user.sub,
        actorEmail: request.user.email,
        action: "order.update",
        entity: "Order",
        entityId: order.orderId,
        meta: { status: order.status, trackingNumber: order.trackingNumber },
      });

      return serializeOrder(order);
    },
  );
}
