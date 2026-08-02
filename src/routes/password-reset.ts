import type { FastifyInstance } from "fastify";
import bcrypt from "bcryptjs";
import { createHash, randomBytes } from "node:crypto";
import { z } from "zod";
import { config } from "../config.js";
import { prisma } from "../lib/prisma.js";

function hashToken(token: string) {
  return createHash("sha256").update(token).digest("hex");
}

export async function passwordResetRoutes(app: FastifyInstance): Promise<void> {
  app.post("/api/auth/forgot-password", async (request, reply) => {
    const body = z.object({ email: z.string().email() }).parse(request.body);
    const email = body.email.trim().toLowerCase();
    const customer = await prisma.customer.findUnique({ where: { email } });

    // Always return success to avoid email enumeration
    const generic = {
      ok: true,
      message:
        "If an account exists for that email, a reset link has been prepared.",
    };

    if (!customer?.passwordHash) {
      return generic;
    }

    const rawToken = randomBytes(32).toString("hex");
    const tokenHash = hashToken(rawToken);
    const expiresAt = new Date(Date.now() + 60 * 60 * 1000);

    await prisma.passwordResetToken.create({
      data: {
        customerId: customer.id,
        tokenHash,
        expiresAt,
      },
    });

    const resetUrl = `${config.storefrontUrl}/reset-password?token=${rawToken}`;

    // No email provider wired — log for ops / future SES/Resend integration
    console.log(`[password-reset] ${email} → ${resetUrl}`);

    return {
      ...generic,
      // Dev helper only — never expose in production responses
      ...(config.isProduction ? {} : { resetUrl }),
    };
  });

  app.post("/api/auth/reset-password", async (request, reply) => {
    const body = z
      .object({
        token: z.string().min(20),
        password: z.string().min(6),
      })
      .parse(request.body);

    const tokenHash = hashToken(body.token);
    const record = await prisma.passwordResetToken.findUnique({
      where: { tokenHash },
    });

    if (!record || record.usedAt || record.expiresAt < new Date()) {
      return reply.code(400).send({ error: "Invalid or expired reset token" });
    }

    const passwordHash = await bcrypt.hash(body.password, 12);
    await prisma.$transaction([
      prisma.customer.update({
        where: { id: record.customerId },
        data: { passwordHash },
      }),
      prisma.passwordResetToken.update({
        where: { id: record.id },
        data: { usedAt: new Date() },
      }),
    ]);

    return { ok: true, message: "Password updated. You can sign in now." };
  });
}
