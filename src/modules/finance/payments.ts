import type { Payment } from "@/generated/prisma/client";
import { withTx } from "@/lib/db";
import { now, startOfDay } from "@/lib/clock";
import { ConflictError, DomainError, NotFoundError, isUniqueViolation } from "@/lib/errors";
import { formatDate } from "@/lib/format";
import { formatINR } from "@/lib/money";
import type { Actor } from "@/modules/identity/actor";
import { assertCan } from "@/modules/identity/permissions";
import { bookingScope } from "@/modules/identity/scope";
import { notify, recordEvent } from "@/modules/audit/audit";
import { transitionUnit } from "@/modules/inventory/units";
import { earningThreshold } from "./calc";
import { markCommissionsEarned } from "./commissions";

import type { PaymentMode } from "./modes";
export { PAYMENT_MODES, type PaymentMode } from "./modes";

/**
 * Sends the customer a payment reminder for an open instalment (simulated
 * WhatsApp through the outbox). At most one reminder per instalment per day,
 * so a busy queue cannot spam a customer.
 */
export async function sendPaymentReminder(actor: Actor, installmentId: string): Promise<void> {
  assertCan(actor, "payment.remind");
  await withTx(async (tx) => {
    const inst = await tx.installment.findFirst({
      where: { id: installmentId, booking: bookingScope(actor) },
      include: { booking: { include: { customer: true, project: true, unit: true } } },
    });
    if (!inst) throw new NotFoundError("Instalment");
    if (inst.status !== "DUE" && inst.status !== "PARTIAL") throw new DomainError("VALIDATION", "This instalment is already settled.");
    if (inst.booking.status !== "CONFIRMED" && inst.booking.status !== "AGREEMENT") {
      throw new DomainError("VALIDATION", "Reminders can only be sent on a live booking.");
    }
    const at = now();
    const already = await tx.auditEvent.count({
      where: { type: "PAYMENT_REMINDER_SENT", entityType: "Installment", entityId: inst.id, at: { gte: startOfDay(at) } },
    });
    if (already > 0) throw new DomainError("ALREADY_REMINDED", "A reminder for this instalment was already sent today.");
    const outstanding = inst.amountDue - inst.amountReceived;
    const overdue = inst.dueDate < at;
    await notify(tx, {
      channel: "WHATSAPP",
      recipient: `${inst.booking.customer.name} (customer)`,
      body: `Dear ${inst.booking.customer.name}, a gentle reminder that ${formatINR(outstanding)} towards "${inst.label}" for ${inst.booking.unit.unitNo}, ${inst.booking.project.name} ${overdue ? `was due on ${formatDate(inst.dueDate)}` : `is due on ${formatDate(inst.dueDate)}`}. Please quote ${inst.booking.code} with your payment. Thank you.`,
      entityType: "Booking",
      entityId: inst.booking.id,
    });
    await recordEvent(tx, actor, {
      type: "PAYMENT_REMINDER_SENT",
      entityType: "Installment",
      entityId: inst.id,
      projectId: inst.booking.projectId,
      summary: `Payment reminder sent for ${inst.booking.code} "${inst.label}" (${formatINR(outstanding)}${overdue ? ", overdue" : ""})`,
      data: { bookingId: inst.booking.id, outstanding },
    });
  });
}

export type RecordPaymentInput = {
  bookingId: string;
  amount: number;
  mode: PaymentMode;
  reference: string;
  receivedAt?: Date;
};

/**
 * Records a customer receipt and allocates it to instalments in due order.
 * Crossing the mandate's earning trigger moves the booking to agreement stage,
 * marks the unit SOLD and makes its commissions earned, all in the same transaction.
 */
export async function recordPayment(actor: Actor, input: RecordPaymentInput): Promise<Payment> {
  assertCan(actor, "payment.record");
  if (!Number.isInteger(input.amount) || input.amount <= 0) {
    throw new DomainError("VALIDATION", "Amount must be a positive whole rupee amount.");
  }
  const reference = input.reference.trim();
  if (reference.length < 4) throw new DomainError("VALIDATION", "Enter the bank / UTR reference.");

  try {
    return await withTx(async (tx) => {
      const booking = await tx.booking.findFirst({
        where: { AND: [{ id: input.bookingId }, bookingScope(actor)] },
        include: { installments: { orderBy: { seq: "asc" } }, mandate: true, unit: true, customer: true, project: true },
      });
      if (!booking) throw new NotFoundError("Booking");
      if (booking.status !== "CONFIRMED" && booking.status !== "AGREEMENT") {
        throw new DomainError("VALIDATION", "Payments can only be recorded against a confirmed booking.");
      }
      const open = booking.installments.filter((i) => i.status !== "CANCELLED");
      const outstanding = open.reduce((sum, i) => sum + (i.amountDue - i.amountReceived), 0);
      if (input.amount > outstanding) {
        throw new DomainError("OVERPAYMENT", `Amount exceeds the outstanding balance of ${formatINR(outstanding)}.`);
      }
      const at = now();
      const payment = await tx.payment.create({
        data: {
          bookingId: booking.id,
          amount: input.amount,
          mode: input.mode,
          reference,
          receivedAt: input.receivedAt ?? at,
          recordedById: actor.userId,
          createdAt: at,
        },
      });

      let remaining = input.amount;
      for (const inst of open) {
        if (remaining === 0) break;
        const gap = inst.amountDue - inst.amountReceived;
        if (gap <= 0) continue;
        const applied = Math.min(gap, remaining);
        const newReceived = inst.amountReceived + applied;
        const updated = await tx.installment.updateMany({
          where: { id: inst.id, amountReceived: inst.amountReceived },
          data: { amountReceived: newReceived, status: newReceived === inst.amountDue ? "PAID" : "PARTIAL" },
        });
        if (updated.count !== 1) throw new ConflictError("Another payment was recorded at the same time. Try again.");
        remaining -= applied;
      }

      const totalReceived = open.reduce((s, i) => s + i.amountReceived, 0) + input.amount;
      await recordEvent(tx, actor, {
        type: "PAYMENT_RECORDED",
        entityType: "Booking",
        entityId: booking.id,
        projectId: booking.projectId,
        summary: `${formatINR(input.amount)} received on ${booking.code} via ${input.mode} (${reference}); collected ${formatINR(totalReceived)} of ${formatINR(booking.agreementValue)}`,
        data: { paymentId: payment.id, amount: input.amount, totalReceived },
      });
      await notify(tx, {
        channel: "WHATSAPP",
        recipient: `${booking.customer.name} (customer)`,
        body: `Receipt: ${formatINR(input.amount)} received against ${booking.code} (ref ${reference}). Thank you.`,
        entityType: "Booking",
        entityId: booking.id,
      });

      const threshold = earningThreshold(booking.agreementValue, booking.mandate.earningTriggerBps);
      if (booking.status === "CONFIRMED" && totalReceived >= threshold) {
        const moved = await tx.booking.updateMany({
          where: { id: booking.id, status: "CONFIRMED" },
          data: { status: "AGREEMENT", agreementAt: at },
        });
        if (moved.count !== 1) throw new ConflictError("The booking was changed by someone else. Try again.");
        await transitionUnit(tx, booking.unit, "SOLD");
        await markCommissionsEarned(tx, actor, booking);
        await recordEvent(tx, actor, {
          type: "BOOKING_AGREEMENT",
          entityType: "Booking",
          entityId: booking.id,
          projectId: booking.projectId,
          summary: `${booking.code} reached agreement stage (collected ${formatINR(totalReceived)} ≥ ${formatINR(threshold)}); ${booking.unit.unitNo} sold, commissions earned`,
        });
      }
      return payment;
    });
  } catch (err) {
    if (isUniqueViolation(err)) {
      throw new DomainError("DUPLICATE_PAYMENT", "A payment with this reference is already recorded for this booking.");
    }
    throw err;
  }
}
