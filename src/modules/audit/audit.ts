import type { Tx } from "@/lib/db";
import { now } from "@/lib/clock";
import type { Actor } from "@/modules/identity/actor";

export type AuditInput = {
  type: string;
  entityType: string;
  entityId: string;
  projectId?: string | null;
  summary: string;
  data?: Record<string, unknown>;
};

/** Written inside the caller's transaction, so the audit trail can never disagree with the data. */
export async function recordEvent(tx: Tx, actor: Actor | null, input: AuditInput): Promise<void> {
  await tx.auditEvent.create({
    data: {
      at: now(),
      actorId: actor?.userId ?? null,
      actorName: actor?.name ?? "System",
      actorRole: actor?.role ?? "SYSTEM",
      type: input.type,
      entityType: input.entityType,
      entityId: input.entityId,
      projectId: input.projectId ?? null,
      summary: input.summary,
      data: input.data ? JSON.stringify(input.data) : null,
    },
  });
}

export type NotificationInput = {
  channel: "WHATSAPP" | "EMAIL" | "SMS" | "IN_APP";
  recipient: string;
  subject?: string;
  body: string;
  entityType?: string;
  entityId?: string;
};

/**
 * Simulated outbox. In production a worker would deliver these through the
 * WhatsApp Business API / email / SMS providers. Here they are stored and shown on
 * the Activity screen, clearly marked as simulated.
 */
export async function notify(tx: Tx, input: NotificationInput): Promise<void> {
  await tx.notification.create({
    data: {
      createdAt: now(),
      channel: input.channel,
      recipient: input.recipient,
      subject: input.subject ?? null,
      body: input.body,
      entityType: input.entityType ?? null,
      entityId: input.entityId ?? null,
    },
  });
}
