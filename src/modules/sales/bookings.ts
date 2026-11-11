import type { Booking } from "@/generated/prisma/client";
import type { BookingStatus } from "@/generated/prisma/enums";
import { db, withTx, type Tx } from "@/lib/db";
import { now } from "@/lib/clock";
import { ConflictError, DomainError, NotFoundError, isUniqueViolation } from "@/lib/errors";
import { formatBps, formatINR, toBps } from "@/lib/money";
import { assertTransition, type Machine } from "@/lib/state";
import type { Actor } from "@/modules/identity/actor";
import { assertCan } from "@/modules/identity/permissions";
import { bookingScope } from "@/modules/identity/scope";
import { notify, recordEvent } from "@/modules/audit/audit";
import { BOOKABLE_STAGES, getScopedLead, moveLeadStage } from "@/modules/crm/leads";
import { assertSellable, effectiveStatus, getScopedUnit, isApprovalLock, takeableBy, transitionUnit } from "@/modules/inventory/units";
import { HARD_DISCOUNT_CAP_BPS, approvalLevelFor, cancellationSettlement, generateSchedule } from "@/modules/finance/calc";
import { accrueCommissions, reverseCommissions } from "@/modules/finance/commissions";

export const BOOKING_MACHINE: Machine<BookingStatus> = {
  PENDING_MGMT_APPROVAL: ["PENDING_DEV_APPROVAL", "CONFIRMED", "REJECTED"],
  PENDING_DEV_APPROVAL: ["CONFIRMED", "REJECTED"],
  CONFIRMED: ["AGREEMENT", "CANCELLED"],
  AGREEMENT: ["CANCELLED"],
  CANCELLED: [],
  REJECTED: [],
};

export async function getScopedBooking(actor: Actor, bookingId: string, client: Tx = db) {
  const booking = await client.booking.findFirst({
    where: { AND: [{ id: bookingId }, bookingScope(actor)] },
    include: { unit: true, mandate: true, project: true, lead: true, customer: true, broker: true, salesExec: true },
  });
  if (!booking) throw new NotFoundError("Booking");
  return booking;
}

export type BookingQuote = {
  listPrice: number;
  discountAmount: number;
  discountBps: number;
  agreementValue: number;
  approvalLevel: "NONE" | "MANAGEMENT" | "DEVELOPER";
};

export function quoteBooking(
  listPrice: number,
  discountAmount: number,
  bands: { execMaxDiscountBps: number; mgmtMaxDiscountBps: number },
): BookingQuote {
  if (!Number.isInteger(discountAmount) || discountAmount < 0) {
    throw new DomainError("VALIDATION", "Discount must be a whole rupee amount of zero or more.");
  }
  const discountBps = toBps(discountAmount, listPrice);
  if (discountBps > HARD_DISCOUNT_CAP_BPS) {
    throw new DomainError("VALIDATION", `Discount cannot exceed ${formatBps(HARD_DISCOUNT_CAP_BPS)} of list price.`);
  }
  return {
    listPrice,
    discountAmount,
    discountBps,
    agreementValue: listPrice - discountAmount,
    approvalLevel: approvalLevelFor(discountBps, bands),
  };
}

export type CreateBookingInput = {
  unitId: string;
  leadId: string;
  discountAmount: number;
  /** The unit version the user was looking at. A stale view cannot book. */
  expectedVersion: number;
};

/**
 * Lead → booking, as one transaction:
 *   unit lock (optimistic version check + DB unique key) → customer → booking →
 *   lead stage → and, if no approval is needed, schedule + commission accrual.
 */
export async function createBooking(actor: Actor, input: CreateBookingInput): Promise<Booking> {
  assertCan(actor, "booking.create");
  try {
    return await withTx(async (tx) => {
      const at = now();
      const unit = await getScopedUnit(actor, input.unitId, tx);
      assertSellable(unit, at);
      const mandate = unit.mandate!;
      const lead = await getScopedLead(actor, input.leadId, tx);
      if (lead.projectId !== unit.projectId) {
        throw new DomainError("VALIDATION", "The lead is for a different project.");
      }
      if (!BOOKABLE_STAGES.includes(lead.stage)) {
        throw new DomainError("VALIDATION", `A lead in stage ${lead.stage.toLowerCase().replace(/_/g, " ")} cannot be booked.`);
      }
      if (unit.version !== input.expectedVersion) {
        throw new ConflictError(`Unit ${unit.unitNo} changed since you opened it. Refresh and try again.`);
      }
      const status = effectiveStatus(unit, at);
      if (isApprovalLock(unit) || (status === "HOLD" && unit.holdById !== actor.userId)) {
        throw new ConflictError(`Unit ${unit.unitNo} is on hold for another customer.`);
      }
      if (status !== "AVAILABLE" && status !== "HOLD") {
        throw new ConflictError(`Unit ${unit.unitNo} is no longer available.`);
      }

      const quote = quoteBooking(unit.listPrice, input.discountAmount, mandate);
      const needsApproval = quote.approvalLevel !== "NONE";

      // Unit first: if someone else won the race, nothing else is written.
      await transitionUnit(tx, unit, needsApproval ? "HOLD" : "BOOKED", {
        where: takeableBy(actor.userId, at),
        data: needsApproval ? { holdById: actor.userId, holdExpiresAt: null } : {},
        conflictMessage: `Unit ${unit.unitNo} is no longer available.`,
      });

      const customer = await tx.customer.upsert({
        where: { phoneNormalized: lead.phoneNormalized },
        update: {},
        create: { name: lead.name, phone: lead.phone, phoneNormalized: lead.phoneNormalized, email: lead.email, createdAt: at },
      });

      // Attribution only counts while the broker's protection window is open.
      const brokerAttributed = lead.brokerId && lead.attributionExpiresAt && lead.attributionExpiresAt >= at ? lead.brokerId : null;
      const seq = (await tx.booking.count({ where: { projectId: unit.projectId } })) + 1;
      const booking = await tx.booking.create({
        data: {
          code: `BK-${unit.project.code}-${String(seq).padStart(4, "0")}`,
          unitId: unit.id,
          unitLockKey: unit.id,
          leadId: lead.id,
          customerId: customer.id,
          projectId: unit.projectId,
          mandateId: mandate.id,
          brokerId: brokerAttributed,
          salesExecId: lead.assignedToId ?? actor.userId,
          listPrice: quote.listPrice,
          discountAmount: quote.discountAmount,
          discountBps: quote.discountBps,
          agreementValue: quote.agreementValue,
          priceSnapshot: JSON.stringify({
            unitNo: unit.unitNo,
            tower: unit.tower.name,
            config: unit.config,
            superSqft: unit.superSqft,
            ratePerSqft: unit.project.baseRatePerSqft,
            basicAmount: unit.basicAmount,
            floorRiseAmount: unit.floorRiseAmount,
            plcAmount: unit.plcAmount,
            parkingAmount: unit.parkingAmount,
            otherCharges: unit.otherCharges,
            listPrice: unit.listPrice,
          }),
          status: needsApproval ? "PENDING_MGMT_APPROVAL" : "CONFIRMED",
          approvalLevel: quote.approvalLevel,
          bookedAt: at,
          confirmedAt: needsApproval ? null : at,
        },
      });

      await tx.lead.update({ where: { id: lead.id }, data: { customerId: customer.id, updatedAt: at } });
      await moveLeadStage(tx, actor, lead.id, needsApproval ? "BOOKING_INITIATED" : "BOOKED");
      await recordEvent(tx, actor, {
        type: "BOOKING_CREATED",
        entityType: "Booking",
        entityId: booking.id,
        projectId: booking.projectId,
        summary: `${booking.code}: ${unit.unitNo} for ${lead.name} at ${formatINR(quote.agreementValue)} (discount ${formatBps(quote.discountBps)})${needsApproval ? `, awaiting ${quote.approvalLevel.toLowerCase()} approval` : ""}`,
        data: { quote, unitVersion: unit.version, brokerId: brokerAttributed },
      });

      if (needsApproval) {
        await notify(tx, {
          channel: "IN_APP",
          recipient: "soleX management",
          subject: "Discount approval needed",
          body: `${booking.code}: ${formatBps(quote.discountBps)} discount on ${unit.unitNo} (${unit.project.name}) needs approval.`,
          entityType: "Booking",
          entityId: booking.id,
        });
        return booking;
      }
      await activateBooking(tx, actor, booking.id);
      return tx.booking.findUniqueOrThrow({ where: { id: booking.id } });
    });
  } catch (err) {
    // Backstop: the unique unitLockKey makes a second live booking on a unit impossible.
    if (isUniqueViolation(err)) throw new ConflictError("This unit was just booked by someone else.");
    throw err;
  }
}

/** Effects of a booking becoming confirmed: payment schedule, commission accrual, notifications. */
async function activateBooking(tx: Tx, actor: Actor, bookingId: string) {
  const booking = await tx.booking.findUniqueOrThrow({
    where: { id: bookingId },
    include: {
      unit: true,
      mandate: true,
      project: { include: { planStages: true, developer: true } },
      lead: true,
      broker: true,
    },
  });
  const schedule = generateSchedule(booking.agreementValue, booking.project.planStages, booking.bookedAt);
  await tx.installment.createMany({ data: schedule.map((s) => ({ ...s, bookingId: booking.id })) });
  await recordEvent(tx, actor, {
    type: "SCHEDULE_CREATED",
    entityType: "Booking",
    entityId: booking.id,
    projectId: booking.projectId,
    summary: `Payment schedule created for ${booking.code}: ${schedule.length} instalments totalling ${formatINR(booking.agreementValue)}`,
  });
  await accrueCommissions(tx, actor, booking, booking.mandate);
  await recordEvent(tx, actor, {
    type: "BOOKING_CONFIRMED",
    entityType: "Booking",
    entityId: booking.id,
    projectId: booking.projectId,
    summary: `${booking.code} confirmed; ${booking.unit.unitNo} is now booked`,
  });
  await notify(tx, {
    channel: "WHATSAPP",
    recipient: `${booking.lead.name} (customer)`,
    body: `Congratulations! Your booking ${booking.code} for unit ${booking.unit.unitNo} at ${booking.project.name} is confirmed. First instalment ${formatINR(schedule[0].amountDue)} is due now.`,
    entityType: "Booking",
    entityId: booking.id,
  });
  await notify(tx, {
    channel: "EMAIL",
    recipient: booking.project.developer.contactEmail,
    subject: `New booking ${booking.code}`,
    body: `Unit ${booking.unit.unitNo} booked at ${formatINR(booking.agreementValue)}. Visible now in your soleX developer portal.`,
    entityType: "Booking",
    entityId: booking.id,
  });
  if (booking.broker) {
    await notify(tx, {
      channel: "WHATSAPP",
      recipient: booking.broker.firmName,
      body: `Your customer ${booking.lead.name} has booked ${booking.unit.unitNo} (${booking.code}). Brokerage accrues and becomes payable once the agreement stage is reached.`,
      entityType: "Booking",
      entityId: booking.id,
    });
  }
}

async function confirmPending(tx: Tx, actor: Actor, booking: Booking & { unit: { id: string } }) {
  const at = now();
  const moved = await tx.booking.updateMany({
    where: { id: booking.id, status: booking.status },
    data: { status: "CONFIRMED", confirmedAt: at },
  });
  if (moved.count !== 1) throw new ConflictError("This booking was already actioned by someone else.");
  const unit = await tx.unit.findUniqueOrThrow({ where: { id: booking.unitId } });
  await transitionUnit(tx, unit, "BOOKED", { where: { status: "HOLD", holdExpiresAt: null } });
  await moveLeadStage(tx, actor, booking.leadId, "BOOKED");
  await activateBooking(tx, actor, booking.id);
}

/**
 * Two-level discount approval. Within the mandate's band soleX management
 * decides; beyond it the developer, who owns the pricing, must also agree.
 */
export async function approveBooking(actor: Actor, bookingId: string) {
  return withTx(async (tx) => {
    const booking = await getScopedBooking(actor, bookingId, tx);
    const at = now();
    if (booking.status === "PENDING_MGMT_APPROVAL") {
      assertCan(actor, "discount.approve.management");
      if (booking.approvalLevel === "DEVELOPER") {
        assertTransition(BOOKING_MACHINE, "Booking", booking.status, "PENDING_DEV_APPROVAL");
        const moved = await tx.booking.updateMany({
          where: { id: booking.id, status: "PENDING_MGMT_APPROVAL" },
          data: { status: "PENDING_DEV_APPROVAL", mgmtApprovedBy: actor.name, mgmtApprovedAt: at },
        });
        if (moved.count !== 1) throw new ConflictError("This booking was already actioned by someone else.");
        await recordEvent(tx, actor, {
          type: "DISCOUNT_APPROVED_MANAGEMENT",
          entityType: "Booking",
          entityId: booking.id,
          projectId: booking.projectId,
          summary: `${booking.code}: soleX management approved ${formatBps(booking.discountBps)} discount; sent to developer`,
        });
        await notify(tx, {
          channel: "EMAIL",
          recipient: "Developer approvers",
          subject: `Approval needed: ${booking.code}`,
          body: `soleX requests your approval for a ${formatBps(booking.discountBps)} discount on ${booking.unit.unitNo} (${booking.project.name}).`,
          entityType: "Booking",
          entityId: booking.id,
        });
        return;
      }
      await tx.booking.update({ where: { id: booking.id }, data: { mgmtApprovedBy: actor.name, mgmtApprovedAt: at } });
      await recordEvent(tx, actor, {
        type: "DISCOUNT_APPROVED_MANAGEMENT",
        entityType: "Booking",
        entityId: booking.id,
        projectId: booking.projectId,
        summary: `${booking.code}: soleX management approved ${formatBps(booking.discountBps)} discount`,
      });
      await confirmPending(tx, actor, booking);
      return;
    }
    if (booking.status === "PENDING_DEV_APPROVAL") {
      assertCan(actor, "discount.approve.developer");
      await tx.booking.update({ where: { id: booking.id }, data: { devApprovedBy: actor.name, devApprovedAt: at } });
      await recordEvent(tx, actor, {
        type: "DISCOUNT_APPROVED_DEVELOPER",
        entityType: "Booking",
        entityId: booking.id,
        projectId: booking.projectId,
        summary: `${booking.code}: developer approved ${formatBps(booking.discountBps)} discount`,
      });
      await confirmPending(tx, actor, booking);
      return;
    }
    throw new DomainError("VALIDATION", "This booking is not awaiting approval.");
  });
}

export async function rejectBooking(actor: Actor, bookingId: string, reason: string) {
  if (!reason.trim()) throw new DomainError("VALIDATION", "Give a reason for rejecting the discount.");
  return withTx(async (tx) => {
    const booking = await getScopedBooking(actor, bookingId, tx);
    if (booking.status === "PENDING_MGMT_APPROVAL") assertCan(actor, "discount.approve.management");
    else if (booking.status === "PENDING_DEV_APPROVAL") assertCan(actor, "discount.approve.developer");
    else throw new DomainError("VALIDATION", "This booking is not awaiting approval.");
    const at = now();
    const moved = await tx.booking.updateMany({
      where: { id: booking.id, status: booking.status },
      data: { status: "REJECTED", unitLockKey: null, rejectionReason: reason.trim(), cancelledAt: at },
    });
    if (moved.count !== 1) throw new ConflictError("This booking was already actioned by someone else.");
    const unit = await tx.unit.findUniqueOrThrow({ where: { id: booking.unitId } });
    await transitionUnit(tx, unit, "AVAILABLE", { where: { status: "HOLD", holdExpiresAt: null } });
    await moveLeadStage(tx, actor, booking.leadId, "NEGOTIATION");
    await recordEvent(tx, actor, {
      type: "DISCOUNT_REJECTED",
      entityType: "Booking",
      entityId: booking.id,
      projectId: booking.projectId,
      summary: `${booking.code}: discount rejected by ${actor.name} (${reason.trim()}); ${booking.unit.unitNo} released`,
    });
    await notify(tx, {
      channel: "IN_APP",
      recipient: booking.salesExec.name,
      body: `Discount on ${booking.code} was rejected: ${reason.trim()}. The unit has been released.`,
      entityType: "Booking",
      entityId: booking.id,
    });
  });
}

/**
 * Cancellation reverses everything downstream in one transaction: inventory is
 * released, open instalments are cancelled, commissions are reversed or clawed
 * back, and the refund due is computed under the mandate's forfeiture terms.
 */
export async function cancelBooking(actor: Actor, bookingId: string, reason: string) {
  assertCan(actor, "booking.cancel");
  if (!reason.trim()) throw new DomainError("VALIDATION", "Give a reason for the cancellation.");
  return withTx(async (tx) => {
    const booking = await getScopedBooking(actor, bookingId, tx);
    assertTransition(BOOKING_MACHINE, "Booking", booking.status, "CANCELLED");
    const at = now();
    const received = (await tx.payment.aggregate({ where: { bookingId: booking.id }, _sum: { amount: true } }))._sum.amount ?? 0;
    const { forfeited, refundDue } = cancellationSettlement(booking.agreementValue, received, booking.mandate.forfeitureBps);
    const moved = await tx.booking.updateMany({
      where: { id: booking.id, status: booking.status },
      data: { status: "CANCELLED", unitLockKey: null, cancelledAt: at, cancelReason: reason.trim(), forfeitedAmount: forfeited, refundDue },
    });
    if (moved.count !== 1) throw new ConflictError("This booking was already changed by someone else.");
    const unit = await tx.unit.findUniqueOrThrow({ where: { id: booking.unitId } });
    await transitionUnit(tx, unit, "AVAILABLE");
    await tx.installment.updateMany({
      where: { bookingId: booking.id, status: { in: ["DUE", "PARTIAL"] } },
      data: { status: "CANCELLED" },
    });
    await reverseCommissions(tx, actor, booking);
    await moveLeadStage(tx, actor, booking.leadId, "LOST", { lostReason: `Booking ${booking.code} cancelled: ${reason.trim()}` });
    await recordEvent(tx, actor, {
      type: "BOOKING_CANCELLED",
      entityType: "Booking",
      entityId: booking.id,
      projectId: booking.projectId,
      summary: `${booking.code} cancelled (${reason.trim()}). ${booking.unit.unitNo} back to available. Received ${formatINR(received)}, forfeited ${formatINR(forfeited)}, refund due ${formatINR(refundDue)}`,
      data: { from: booking.status, received, forfeited, refundDue },
    });
    await notify(tx, {
      channel: "WHATSAPP",
      recipient: `${booking.customer.name} (customer)`,
      body: `Your booking ${booking.code} has been cancelled. A refund of ${formatINR(refundDue)} will be processed as per your booking terms.`,
      entityType: "Booking",
      entityId: booking.id,
    });
  });
}
