import { prisma } from "./prisma.js";

export async function writeAuditLog(input: {
  actorId?: string;
  actorEmail?: string;
  action: string;
  entity: string;
  entityId?: string;
  meta?: unknown;
}): Promise<void> {
  try {
    await prisma.auditLog.create({
      data: {
        actorId: input.actorId,
        actorEmail: input.actorEmail,
        action: input.action,
        entity: input.entity,
        entityId: input.entityId,
        meta: input.meta as object | undefined,
      },
    });
  } catch (err) {
    console.error("Failed to write audit log", err);
  }
}
