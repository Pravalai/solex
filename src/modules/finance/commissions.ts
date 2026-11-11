import type { Booking, Mandate } from "@/generated/prisma/client";
import type { CommissionKind, CommissionStatus } from "@/generated/prisma/enums";
import { withTx, type Tx } from "@/lib/db";
import { now } from "@/lib/clock";
import { DomainError, ConflictError, NotFoundError } from "@/lib/errors";
import { formatINR } from "@/lib/money";
import { assertTransition, type Machine } from "@/lib/state";
import type { Actor } from "@/modules/identity/actor";
import { assertCan } from "@/modules/identity/permissions";
import { commissionScope } from "@/modules/identity/scope";
import { notify, recordEvent } from "@/modules/audit/audit";
import { commissionLines } from "./calc";

/** Receivable lifecycle (soleX invoices the developer). */
export const FEE_MACHINE: Machine<CommissionStatus> = {
  ACCRUED: ["EARNED", "REVERSED"],
  EARNED: ["INVOICED", "REVERSED"],
  INVOICED: ["RECEIVED", "REVERSED"],
  RECEIVED: [],
  APPROVED: [],
  PAID: [],
  REVERSED: [],
};

/** Payable lifecycle (soleX pays brokers and staff). Approval and payment are separate duties. */
export const PAYOUT_MACHINE: Machine<CommissionStatus> = {
  ACCRUED: ["EARNED", "REVERSED"],
  EARNED: ["APPROVED", "REVERSED"],
  APPROVED: ["PAID", "REVERSED"],
  PAID: [],
  INVOICED: [],
  RECEIVED: [],
  REVERSED: [],
};

export function machineFor(kind: CommissionKind): Machine<CommissionStatus> {
  return kind === "DEVELOPER_FEE" ? FEE_MACHINE : PAYOUT_MACHINE;
}

export const LIVE_BOOKING_STATUSES = ["CONFIRMED", "AGREEMENT"] as const;

/** Creates the ledger lines for a newly confirmed booking, with rates frozen from the mandate. */
export async function accrueCommissions(tx: Tx, actor: Actor, booking: Booking, mandate: Mandate) {
  const prior = await tx.booking.count({
    where: {
      mandateId: mandate.id,
      id: { not: booking.id },
      status: { in: [...LIVE_BOOKING_STATUSES] },
    },
  });
  const lines = commissionLines(booking, mandate, prior);
  const at = now();
  await tx.commission.createMany({
    data: lines.map((l) => ({
      ...l,
      bookingId: booking.id,
      mandateId: mandate.id,
      projectId: booking.projectId,
      status: "ACCRUED" as const,
      accruedAt: at,
    })),
  });
  await recordEvent(tx, actor, {
    type: "COMMISSION_ACCRUED",
    entityType: "Booking",
    entityId: booking.id,
    projectId: booking.projectId,
    summary: `Commission accrued on ${booking.code}: ${lines
      .map((l) => `${l.kind.replace("_", " ").toLowerCase()} ${formatINR(l.amount)}`)
      .join(", ")}`,
    data: { lines, priorConfirmedBookings: prior },
  });
}

export async function markCommissionsEarned(tx: Tx, actor: Actor, booking: Booking) {
  const at = now();
  const result = await tx.commission.updateMany({
    where: { bookingId: booking.id, status: "ACCRUED", isAdjustment: false },
    data: { status: "EARNED", earnedAt: at },
  });
  if (result.count > 0) {
    await recordEvent(tx, actor, {
      type: "COMMISSION_EARNED",
      entityType: "Booking",
      entityId: booking.id,
      projectId: booking.projectId,
      summary: `${result.count} commission line(s) on ${booking.code} became earned`,
    });
  }
}

/**
 * Cancellation: unsettled lines are reversed; lines already settled get a
 * negative adjustment (clawback / credit note) so history is never rewritten.
 */
export async function reverseCommissions(tx: Tx, actor: Actor, booking: Booking) {
  const lines = await tx.commission.findMany({ where: { bookingId: booking.id, isAdjustment: false } });
  const at = now();
  let reversed = 0;
  let clawedBack = 0;
  for (const line of lines) {
    if (line.status === "REVERSED") continue;
    if (line.status === "RECEIVED" || line.status === "PAID") {
      await tx.commission.create({
        data: {
          bookingId: line.bookingId,
          mandateId: line.mandateId,
          projectId: line.projectId,
          kind: line.kind,
          brokerId: line.brokerId,
          userId: line.userId,
          baseAmount: line.baseAmount,
          rateBps: line.rateBps,
          amount: -line.amount,
          status: "EARNED",
          isAdjustment: true,
          reversesId: line.id,
          accruedAt: at,
          earnedAt: at,
        },
      });
      clawedBack++;
    } else {
      assertTransition(machineFor(line.kind), "Commission", line.status, "REVERSED");
      await tx.commission.update({ where: { id: line.id }, data: { status: "REVERSED", settledAt: at } });
      reversed++;
    }
  }
  await recordEvent(tx, actor, {
    type: "COMMISSION_REVERSED",
    entityType: "Booking",
    entityId: booking.id,
    projectId: booking.projectId,
    summary: `Commissions on ${booking.code}: ${reversed} reversed, ${clawedBack} clawback adjustment(s) raised`,
  });
}

export type SettleAction = "INVOICE" | "RECEIVE" | "APPROVE" | "PAY";

const ACTION_TARGET: Record<SettleAction, CommissionStatus> = {
  INVOICE: "INVOICED",
  RECEIVE: "RECEIVED",
  APPROVE: "APPROVED",
  PAY: "PAID",
};

/** Finance settles lines one by one; approving payouts is a management duty. */
export async function settleCommission(actor: Actor, commissionId: string, action: SettleAction, reference?: string) {
  assertCan(actor, action === "APPROVE" ? "commission.approve" : "commission.settle");
  return withTx(async (tx) => {
    const line = await tx.commission.findFirst({
      where: { AND: [{ id: commissionId }, commissionScope(actor)] },
      include: { booking: true, broker: true },
    });
    if (!line) throw new NotFoundError("Commission");
    const isFee = line.kind === "DEVELOPER_FEE";
    if (isFee !== (action === "INVOICE" || action === "RECEIVE")) {
      throw new DomainError("VALIDATION", `${action.toLowerCase()} does not apply to this commission type.`);
    }
    const to = ACTION_TARGET[action];
    assertTransition(machineFor(line.kind), "Commission", line.status, to);
    if ((action === "INVOICE" || action === "PAY") && !reference?.trim()) {
      throw new DomainError("VALIDATION", action === "INVOICE" ? "Enter the invoice number." : "Enter the payment reference (UTR).");
    }
    const at = now();
    const result = await tx.commission.updateMany({
      where: { id: line.id, status: line.status },
      data: {
        status: to,
        ...(action === "INVOICE" ? { invoicedAt: at, reference: reference!.trim() } : {}),
        ...(action === "APPROVE" ? { approvedAt: at } : {}),
        ...(action === "RECEIVE" || action === "PAY"
          ? { settledAt: at, ...(reference?.trim() ? { reference: reference.trim() } : {}) }
          : {}),
      },
    });
    if (result.count !== 1) throw new ConflictError("This commission line was updated by someone else.");
    await recordEvent(tx, actor, {
      type: `COMMISSION_${to}`,
      entityType: "Commission",
      entityId: line.id,
      projectId: line.projectId,
      summary: `${line.kind.replace("_", " ").toLowerCase()} ${formatINR(line.amount)} on ${line.booking.code} → ${to.toLowerCase()}`,
      data: { from: line.status, to, reference },
    });
    if (action === "PAY" && line.broker) {
      await notify(tx, {
        channel: "EMAIL",
        recipient: line.broker.email,
        subject: `Brokerage paid: ${line.booking.code}`,
        body: `${formatINR(line.amount)} has been paid against booking ${line.booking.code}. UTR ${reference}.`,
        entityType: "Commission",
        entityId: line.id,
      });
    }
  });
}
