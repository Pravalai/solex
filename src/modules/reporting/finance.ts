import type { CommissionKind, CommissionStatus } from "@/generated/prisma/enums";
import { db } from "@/lib/db";
import { addDays, daysBetween, now, startOfDay, startOfMonth } from "@/lib/clock";
import type { Actor } from "@/modules/identity/actor";
import { assertCan } from "@/modules/identity/permissions";

export async function getCollections(actor: Actor) {
  assertCan(actor, "finance.view");
  const at = now();
  const today = startOfDay(at);
  const horizon = addDays(today, 45);
  const [open, monthPayments, refunds] = await Promise.all([
    db.installment.findMany({
      where: { status: { in: ["DUE", "PARTIAL"] }, dueDate: { lt: horizon }, booking: { status: { in: ["CONFIRMED", "AGREEMENT"] } } },
      orderBy: { dueDate: "asc" },
      include: {
        booking: { select: { id: true, code: true, customer: { select: { name: true } }, project: { select: { name: true } }, unit: { select: { unitNo: true } } } },
      },
    }),
    db.payment.aggregate({ where: { receivedAt: { gte: startOfMonth(at) } }, _sum: { amount: true }, _count: true }),
    db.booking.findMany({
      where: { status: "CANCELLED", refundDue: { gt: 0 } },
      select: { id: true, code: true, refundDue: true, forfeitedAmount: true, cancelledAt: true, customer: { select: { name: true } } },
    }),
  ]);
  const rows = open.map((i) => ({
    id: i.id,
    bookingId: i.booking.id,
    bookingCode: i.booking.code,
    customer: i.booking.customer.name,
    project: i.booking.project.name,
    unitNo: i.booking.unit.unitNo,
    label: i.label,
    dueDate: i.dueDate,
    outstanding: i.amountDue - i.amountReceived,
    daysOverdue: i.dueDate < today ? daysBetween(i.dueDate, at) : 0,
  }));
  return {
    rows,
    overdue: rows.filter((r) => r.daysOverdue > 0).reduce((s, r) => s + r.outstanding, 0),
    upcoming: rows.filter((r) => r.daysOverdue === 0).reduce((s, r) => s + r.outstanding, 0),
    receivedThisMonth: monthPayments._sum.amount ?? 0,
    paymentsThisMonth: monthPayments._count,
    refunds,
  };
}

export async function getCommissionLedger(actor: Actor, filter: { kind?: CommissionKind; status?: CommissionStatus } = {}) {
  assertCan(actor, "commission.view");
  const lines = await db.commission.findMany({
    where: { ...(filter.kind ? { kind: filter.kind } : {}), ...(filter.status ? { status: filter.status } : {}) },
    orderBy: [{ accruedAt: "desc" }],
    take: 400,
    include: {
      booking: { select: { id: true, code: true, status: true, unit: { select: { unitNo: true } } } },
      project: { select: { name: true } },
      broker: { select: { firmName: true } },
      user: { select: { name: true } },
    },
  });
  // Clawback (adjustment) lines are recoveries, so they are kept out of receivable/payable totals.
  const all = await db.commission.groupBy({ by: ["kind", "status"], where: { isAdjustment: false }, _sum: { amount: true }, _count: true });
  const clawbacks = await db.commission.aggregate({ where: { isAdjustment: true, status: { notIn: ["PAID", "RECEIVED"] } }, _sum: { amount: true }, _count: true });
  const total = (kind: CommissionKind, statuses: CommissionStatus[]) =>
    all.filter((r) => r.kind === kind && statuses.includes(r.status)).reduce((s, r) => s + (r._sum.amount ?? 0), 0);
  return {
    lines,
    summary: {
      fee: {
        accrued: total("DEVELOPER_FEE", ["ACCRUED"]),
        toInvoice: total("DEVELOPER_FEE", ["EARNED"]),
        invoiced: total("DEVELOPER_FEE", ["INVOICED"]),
        received: total("DEVELOPER_FEE", ["RECEIVED"]),
      },
      payable: {
        accrued: total("BROKER_PAYOUT", ["ACCRUED"]) + total("EMPLOYEE_INCENTIVE", ["ACCRUED"]),
        toApprove: total("BROKER_PAYOUT", ["EARNED"]) + total("EMPLOYEE_INCENTIVE", ["EARNED"]),
        toPay: total("BROKER_PAYOUT", ["APPROVED"]) + total("EMPLOYEE_INCENTIVE", ["APPROVED"]),
        paid: total("BROKER_PAYOUT", ["PAID"]) + total("EMPLOYEE_INCENTIVE", ["PAID"]),
      },
      clawbacks: { open: -(clawbacks._sum.amount ?? 0), count: clawbacks._count },
    },
  };
}

export async function getActivity(actor: Actor, opts: { type?: string } = {}) {
  assertCan(actor, "audit.view");
  const [events, notifications, types] = await Promise.all([
    db.auditEvent.findMany({ where: opts.type ? { type: opts.type } : {}, orderBy: { at: "desc" }, take: 120 }),
    db.notification.findMany({ orderBy: { createdAt: "desc" }, take: 60 }),
    db.auditEvent.groupBy({ by: ["type"], _count: true, orderBy: { type: "asc" } }),
  ]);
  return { events, notifications, types: types.map((t) => ({ type: t.type, count: t._count })) };
}
