import bcrypt from "bcryptjs";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { OAuth2Client } from "google-auth-library";
import { z } from "zod";
import { config, isGoogleAuthConfigured } from "../config.js";
import { prisma } from "../lib/prisma.js";

export type JwtRole = "admin" | "customer";

declare module "fastify" {
  interface FastifyInstance {
    authenticate: (request: FastifyRequest, reply: FastifyReply) => Promise<void>;
    authenticateAdmin: (
      request: FastifyRequest,
      reply: FastifyReply,
    ) => Promise<void>;
    authenticateCustomer: (
      request: FastifyRequest,
      reply: FastifyReply,
    ) => Promise<void>;
    authenticateOptional: (
      request: FastifyRequest,
      reply: FastifyReply,
    ) => Promise<void>;
  }
}

declare module "@fastify/jwt" {
  interface FastifyJWT {
    payload: { sub: string; email: string; role: JwtRole };
    user: { sub: string; email: string; role: JwtRole };
  }
}

function customerPayload(customer: {
  id: string;
  email: string;
  name: string;
  phone: string;
  avatarUrl?: string | null;
  loyaltyPoints?: number;
}) {
  return {
    id: customer.id,
    email: customer.email,
    name: customer.name,
    phone: customer.phone,
    avatarUrl: customer.avatarUrl ?? undefined,
    loyaltyPoints: customer.loyaltyPoints ?? 0,
  };
}

export async function ensureAdminUser(): Promise<void> {
  const existing = await prisma.admin.findUnique({
    where: { email: config.adminEmail },
  });
  if (existing) return;

  const passwordHash = await bcrypt.hash(config.adminPassword, 12);
  await prisma.admin.create({
    data: { email: config.adminEmail, passwordHash },
  });
  console.log(`Admin user created: ${config.adminEmail}`);
}

export async function registerAuth(app: FastifyInstance): Promise<void> {
  await app.register(import("@fastify/jwt"), {
    secret: config.jwtSecret,
  });

  const googleClient = isGoogleAuthConfigured()
    ? new OAuth2Client(config.googleClientId)
    : null;

  app.decorate(
    "authenticate",
    async (request: FastifyRequest, reply: FastifyReply) => {
      try {
        await request.jwtVerify();
      } catch {
        return reply.code(401).send({ error: "Unauthorized" });
      }
    },
  );

  app.decorate(
    "authenticateAdmin",
    async (request: FastifyRequest, reply: FastifyReply) => {
      try {
        await request.jwtVerify();
        if (request.user.role !== "admin") {
          return reply.code(403).send({ error: "Admin access required" });
        }
      } catch {
        return reply.code(401).send({ error: "Unauthorized" });
      }
    },
  );

  app.decorate(
    "authenticateCustomer",
    async (request: FastifyRequest, reply: FastifyReply) => {
      try {
        await request.jwtVerify();
        if (request.user.role !== "customer") {
          return reply.code(403).send({ error: "Customer access required" });
        }
      } catch {
        return reply.code(401).send({ error: "Unauthorized" });
      }
    },
  );

  app.decorate(
    "authenticateOptional",
    async (request: FastifyRequest, _reply: FastifyReply) => {
      try {
        await request.jwtVerify();
      } catch {
        // no token — continue as guest
      }
    },
  );

  const loginSchema = z.object({
    email: z.string().email(),
    password: z.string().min(1),
  });

  const registerSchema = z.object({
    email: z.string().email(),
    password: z.string().min(6),
    name: z.string().min(1),
    phone: z.string().min(5),
  });

  const googleSchema = z.object({
    credential: z.string().min(1),
  });

  const profileSchema = z.object({
    name: z.string().min(1).optional(),
    phone: z.string().min(5).optional(),
  });

  app.post("/api/admin/login", async (request, reply) => {
    const body = loginSchema.parse(request.body);
    const admin = await prisma.admin.findUnique({ where: { email: body.email } });

    if (!admin || !(await bcrypt.compare(body.password, admin.passwordHash))) {
      return reply.code(401).send({ error: "Invalid email or password" });
    }

    const token = await reply.jwtSign(
      { sub: admin.id, email: admin.email, role: "admin" as const },
      { expiresIn: "7d" },
    );

    return { token, email: admin.email, role: admin.role };
  });

  app.get(
    "/api/admin/me",
    { preHandler: [app.authenticateAdmin] },
    async (request) => {
      const admin = await prisma.admin.findUnique({
        where: { id: request.user.sub },
      });
      return {
        email: request.user.email,
        role: admin?.role ?? "ADMIN",
      };
    },
  );

  app.get("/api/auth/providers", async () => ({
    google: isGoogleAuthConfigured(),
    googleClientId: isGoogleAuthConfigured() ? config.googleClientId : null,
  }));

  app.post("/api/auth/register", async (request, reply) => {
    const body = registerSchema.parse(request.body);
    const email = body.email.trim().toLowerCase();

    const existing = await prisma.customer.findUnique({ where: { email } });
    if (existing) {
      return reply
        .code(409)
        .send({ error: "An account with this email already exists" });
    }

    const passwordHash = await bcrypt.hash(body.password, 12);
    const customer = await prisma.customer.create({
      data: {
        email,
        passwordHash,
        name: body.name.trim(),
        phone: body.phone.trim(),
      },
    });

    const token = await reply.jwtSign(
      { sub: customer.id, email: customer.email, role: "customer" as const },
      { expiresIn: "30d" },
    );

    return { token, user: customerPayload(customer) };
  });

  app.post("/api/auth/login", async (request, reply) => {
    const body = loginSchema.parse(request.body);
    const email = body.email.trim().toLowerCase();
    const customer = await prisma.customer.findUnique({ where: { email } });

    if (!customer?.passwordHash) {
      return reply.code(401).send({
        error: customer?.googleId
          ? "This account uses Google sign-in. Continue with Google instead."
          : "Invalid email or password",
      });
    }

    if (!(await bcrypt.compare(body.password, customer.passwordHash))) {
      return reply.code(401).send({ error: "Invalid email or password" });
    }

    const token = await reply.jwtSign(
      { sub: customer.id, email: customer.email, role: "customer" as const },
      { expiresIn: "30d" },
    );

    return { token, user: customerPayload(customer) };
  });

  app.post("/api/auth/google", async (request, reply) => {
    if (!googleClient || !config.googleClientId) {
      return reply
        .code(503)
        .send({ error: "Google sign-in is not configured" });
    }

    const body = googleSchema.parse(request.body);

    let payload;
    try {
      const ticket = await googleClient.verifyIdToken({
        idToken: body.credential,
        audience: config.googleClientId,
      });
      payload = ticket.getPayload();
    } catch {
      return reply.code(401).send({ error: "Invalid Google credential" });
    }

    if (!payload?.sub || !payload.email) {
      return reply.code(401).send({ error: "Google account missing email" });
    }

    const email = payload.email.trim().toLowerCase();
    const name =
      payload.name?.trim() ||
      [payload.given_name, payload.family_name].filter(Boolean).join(" ") ||
      email.split("@")[0]!;
    const avatarUrl = payload.picture ?? null;
    const googleId = payload.sub;

    let customer = await prisma.customer.findFirst({
      where: { OR: [{ googleId }, { email }] },
    });

    if (customer) {
      customer = await prisma.customer.update({
        where: { id: customer.id },
        data: {
          googleId,
          name: customer.name || name,
          avatarUrl: avatarUrl ?? customer.avatarUrl,
          email,
        },
      });
    } else {
      customer = await prisma.customer.create({
        data: {
          email,
          googleId,
          name,
          phone: "",
          avatarUrl,
          passwordHash: null,
        },
      });
    }

    const token = await reply.jwtSign(
      { sub: customer.id, email: customer.email, role: "customer" as const },
      { expiresIn: "30d" },
    );

    return {
      token,
      user: customerPayload(customer),
      needsPhone: !customer.phone?.trim(),
    };
  });

  app.patch(
    "/api/auth/me",
    { preHandler: [app.authenticateCustomer] },
    async (request, reply) => {
      const body = profileSchema.parse(request.body);
      if (!body.name && !body.phone) {
        return reply.code(400).send({ error: "Nothing to update" });
      }

      const customer = await prisma.customer.update({
        where: { id: request.user.sub },
        data: {
          ...(body.name ? { name: body.name.trim() } : {}),
          ...(body.phone ? { phone: body.phone.trim() } : {}),
        },
      });

      return customerPayload(customer);
    },
  );

  app.get(
    "/api/auth/me",
    { preHandler: [app.authenticateCustomer] },
    async (request, reply) => {
      const customer = await prisma.customer.findUnique({
        where: { id: request.user.sub },
      });
      if (!customer) return reply.code(404).send({ error: "Customer not found" });

      return customerPayload(customer);
    },
  );
}
