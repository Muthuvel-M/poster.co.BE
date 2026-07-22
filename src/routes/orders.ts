import type { FastifyInstance } from "fastify";
import { OrderStatus, Size } from "@prisma/client";
import { z } from "zod";
import { prisma } from "../lib/prisma.js";
import { priceOrderLines, SIZE_PRICE } from "../lib/pricing.js";
import type { PosterSize } from "../lib/pricing.js";

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
});

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
  total: number;
  status: OrderStatus;
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
    total: order.total,
    status: order.status,
    whatsappOpenedAt: order.whatsappOpenedAt,
    createdAt: order.createdAt,
    updatedAt: order.updatedAt,
  };
}

export async function orderRoutes(app: FastifyInstance): Promise<void> {
  app.post(
    "/api/orders",
    { preHandler: [app.authenticateOptional] },
    async (request, reply) => {
      const body = createOrderSchema.parse(request.body);
      const customerId =
        request.user?.role === "customer" ? request.user.sub : undefined;

      const priced = priceOrderLines(
        body.lines.map((l) => ({
          size: l.size as PosterSize,
          qty: l.qty,
        })),
      );

      const order = await prisma.order.create({
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
          lines: body.lines.map((l) => ({
            productId: l.productId,
            slug: l.slug,
            title: l.title,
            size: l.size as Size,
            qty: l.qty,
            unitPrice: SIZE_PRICE[l.size as PosterSize],
            lineTotal: SIZE_PRICE[l.size as PosterSize] * l.qty,
            imageUrl: l.imageUrl,
          })),
          subtotal: priced.subtotal,
          shipping: priced.shipping,
          total: priced.total,
          status: OrderStatus.PENDING,
          whatsappOpenedAt: new Date(),
        },
      });

      return reply.code(201).send(serializeOrder(order));
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
      const body = z
        .object({
          status: z.enum(["PENDING", "CONFIRMED", "SHIPPED", "CANCELLED"]),
        })
        .parse(request.body);

      const existing = await prisma.order.findFirst({
        where: { OR: [{ id }, { orderId: id }] },
      });
      if (!existing) return reply.code(404).send({ error: "Order not found" });

      const order = await prisma.order.update({
        where: { id: existing.id },
        data: { status: body.status as OrderStatus },
      });

      return serializeOrder(order);
    },
  );
}
