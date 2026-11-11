import type { Prisma } from "@/generated/prisma/client";
import type { BookingStatus } from "@/generated/prisma/enums";
import { db } from "@/lib/db";
import { now, startOfDay } from "@/lib/clock";
import { NotFoundError } from "@/lib/errors";
import type { Actor } from "@/modules/identity/actor";
import { isInternal } from "@/modules/identity/roles";
import { bookingScope, commissionScope } from "@/modules/identity/scope";
import { earningThreshold } from "@/modules/finance/calc";

export async function listBookings(actor: Actor, filters: { status?: BookingStatus | "LIVE" | "PENDING"; projectId?: string } = {}) {
  const and: Prisma.BookingWhereInput[] = [bookingScope(actor)];
  if (filters.projectId) and.push({ projectId: filters.projectId });
  if (filters.status === "LIVE") and.push({ status: { in: ["CONFIRMED", "AGREEMENT"] } });
  else if (filters.status === "PENDING") and.push({ status: { in: ["PENDING_MGMT_APPROVAL", "PENDING_DEV_APPROVAL"] } });
  else if (filters.status) and.push({ status: filters.status });
  const bookings = await db.booking.findMany({
    where: { AND: and },
    orderBy: { bookedAt: "desc" },
    include: {
      unit: { select: { unitNo: true, config: true } },
      project: { select: { code: true, name: true } },
      customer: { select: { name: true } },
      broker: { select: { firmName: true } },
      salesExec: { select: { name: true } },
      installments: { select: { amountDue: true, amountReceived: true, status: true, dueDate: true } },
    },
  });
  const today = startOfDay(now());
  return bookings.map((b) => {
    const live = b.installments.filter((i) => i.status !== "CANCELLED");
    const received = b.installments.reduce((s, i) => s + i.amountReceived, 0);
    const overdue = live.filter((i) => i.dueDate < today && i.amountReceived < i.amountDue).reduce((s, i) => s + i.amountDue - i.amountReceived, 0);
    return {
      id: b.id,
      code: b.code,
      status: b.status,
      bookedAt: b.bookedAt,
      unitNo: b.unit.unitNo,
      config: b.unit.config,
      project: b.project,
      customerName: b.customer.name,
      // Developers see whether a sale was partner-sourced, not which partner or what they are paid.
      channel: b.brokerId ? (isInternal(actor) || actor.role === "BROKER" ? (b.broker?.firmName ?? "Channel partner") : "Channel partner") : "Direct",
      salesExec: b.salesExec.name,
      agreementValue: b.agreementValue,
      discountBps: b.discountBps,
      received,
      overdue,
    };
  });
}

export async function getBookingDetail(actor: Actor, bookingId: string) {
  const booking = await db.booking.findFirst({
    where: { AND: [{ id: bookingId }, bookingScope(actor)] },
    include: {
      unit: { select: { id: true, unitNo: true, config: true, superSqft: true, status: true } },
      project: { select: { id: true, code: true, name: true, developer: { select: { name: true } } } },
      mandate: { select: { code: true, earningTriggerBps: true, forfeitureBps: true, execMaxDiscountBps: true, mgmtMaxDiscountBps: true } },
      customer: { select: { name: true, phone: true, email: true } },
      lead: { select: { id: true, code: true, source: true, campaign: true } },
      broker: { select: { firmName: true, code: true } },
      salesExec: { select: { name: true } },
      installments: { orderBy: { seq: "asc" } },
      payments: { orderBy: { receivedAt: "desc" }, include: { recordedBy: { select: { name: true } } } },
      commissions: {
        where: commissionScope(actor),
        orderBy: [{ kind: "asc" }, { accruedAt: "asc" }],
        include: { broker: { select: { firmName: true } }, user: { select: { name: true } } },
      },
    },
  });
  if (!booking) throw new NotFoundError("Booking");
  const timeline = isInternal(actor)
    ? await db.auditEvent.findMany({ where: { entityType: "Booking", entityId: booking.id }, orderBy: { at: "asc" } })
    : [];
  const today = startOfDay(now());
  const received = booking.payments.reduce((s, p) => s + p.amount, 0);
  const due = booking.installments.filter((i) => i.status !== "CANCELLED").reduce((s, i) => s + i.amountDue, 0);
  const threshold = earningThreshold(booking.agreementValue, booking.mandate.earningTriggerBps);
  return {
    ...booking,
    priceSnapshot: JSON.parse(booking.priceSnapshot) as Record<string, number | string>,
    // Customer contact details are only for the soleX team handling the account.
    customer: isInternal(actor) ? booking.customer : { name: booking.customer.name, phone: null, email: null },
    broker: actor.role === "DEVELOPER" ? null : booking.broker,
    channel: booking.brokerId ? "Channel partner" : "Direct",
    installments: booking.installments.map((i) => ({
      ...i,
      overdue: i.status !== "CANCELLED" && i.dueDate < today && i.amountReceived < i.amountDue,
    })),
    totals: { received, outstanding: Math.max(0, due - received), threshold, thresholdMet: received >= threshold },
    timeline,
  };
}
