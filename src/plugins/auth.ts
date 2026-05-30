import bcrypt from "bcryptjs";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";
import { config } from "../config.js";
import { prisma } from "../lib/prisma.js";

declare module "fastify" {
  interface FastifyInstance {
    authenticate: (request: FastifyRequest, reply: FastifyReply) => Promise<void>;
  }
}

declare module "@fastify/jwt" {
  interface FastifyJWT {
    payload: { sub: string; email: string };
    user: { sub: string; email: string };
  }
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

  const loginSchema = z.object({
    email: z.string().email(),
    password: z.string().min(1),
  });

  app.post("/api/admin/login", async (request, reply) => {
    const body = loginSchema.parse(request.body);
    const admin = await prisma.admin.findUnique({ where: { email: body.email } });

    if (!admin || !(await bcrypt.compare(body.password, admin.passwordHash))) {
      return reply.code(401).send({ error: "Invalid email or password" });
    }

    const token = await reply.jwtSign(
      { sub: admin.id, email: admin.email },
      { expiresIn: "7d" },
    );

    return { token, email: admin.email };
  });

  app.get(
    "/api/admin/me",
    { preHandler: [app.authenticate] },
    async (request) => {
      return { email: request.user.email };
    },
  );
}
