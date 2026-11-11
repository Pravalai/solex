import type { Prisma } from "@/generated/prisma/client";
import type { LeadSource } from "@/generated/prisma/enums";
import { db } from "@/lib/db";
import { addDays, addMinutes, daysBetween, now, startOfDay, startOfMonth } from "@/lib/clock";
import type { Actor } from "@/modules/identity/actor";
import { assertCan } from "@/modules/identity/permissions";
import { effectiveStatus } from "@/modules/inventory/units";
import { CLOSED_STAGES } from "@/modules/crm/leads";

/** Fixed chart slot per project, so a project keeps its colour across every chart and filter. */
export const PROJECT_SERIES = ["#3b64a8", "#b07f2c", "#2a9d8f"] as const;

const LIVE = ["CONFIRMED", "AGREEMENT"] as const;

function sum<T>(rows: T[], pick: (r: T) => number) {
  return rows.reduce((s, r) => s + pick(r), 0);
}

/**
 * Management command centre. Everything is computed from the source tables on
 * each request: there are no denormalised counters that could drift from the
 * underlying bookings, payments and ledger lines.
 */
export async function getCommandCentre(actor: Actor, opts: { projectId?: string } = {}) {
  assertCan(actor, "command.view");
  const at = now();
  const today = startOfDay(at);
  const monthStart = startOfMonth(at);
  const prevMonthStart = startOfMonth(addDays(monthStart, -1));
  const projectFilter: Prisma.ProjectWhereInput = opts.projectId ? { id: opts.projectId } : {};
  const pf = opts.projectId ? { projectId: opts.projectId } : {};

  // Colour slots are assigned over ALL projects so a filter never repaints the survivors.
  const allProjects = await db.project.findMany({ orderBy: { code: "asc" }, select: { id: true } });
  const slotOf = new Map(allProjects.map((p, i) => [p.id, PROJECT_SERIES[i % PROJECT_SERIES.length]]));
  const [projects, bookings, installments, payments, commissions, leads, visits, brokers, execs] = await Promise.all([
    db.project.findMany({
      where: projectFilter,
      orderBy: { name: "asc" },
      include: {
        developer: { select: { name: true } },
        mandates: { where: { status: "ACTIVE" } },
        units: { select: { status: true, holdExpiresAt: true, mandateId: true, listPrice: true, unitNo: true, id: true, holdById: true } },
      },
    }),
    db.booking.findMany({
      where: pf,
      select: {
        id: true,
        code: true,
        projectId: true,
        status: true,
        agreementValue: true,
        bookedAt: true,
        brokerId: true,
        salesExecId: true,
        refundDue: true,
        cancelledAt: true,
        discountBps: true,
        unit: { select: { unitNo: true } },
        customer: { select: { name: true } },
        lead: { select: { source: true } },
      },
    }),
    db.installment.findMany({
      where: { booking: { ...pf, status: { in: [...LIVE] } }, status: { not: "CANCELLED" } },
      select: { amountDue: true, amountReceived: true, dueDate: true, bookingId: true, label: true },
    }),
    db.payment.findMany({ where: { booking: pf }, select: { amount: true, receivedAt: true, bookingId: true } }),
    db.commission.findMany({ where: pf, select: { kind: true, status: true, amount: true, projectId: true, brokerId: true, isAdjustment: true } }),
    db.lead.findMany({
      where: pf,
      select: { id: true, projectId: true, source: true, stage: true, createdAt: true, nextFollowUpAt: true, lastContactAt: true, brokerId: true, assignedToId: true },
    }),
    db.siteVisit.findMany({ where: pf, select: { status: true, leadId: true, completedAt: true, projectId: true } }),
    db.broker.findMany({ select: { id: true, firmName: true, code: true } }),
    db.user.findMany({ where: { role: "SALES" }, select: { id: true, name: true } }),
  ]);

  const liveBookings = bookings.filter((b) => (LIVE as readonly string[]).includes(b.status));
  const receivedByBooking = new Map<string, number>();
  for (const p of payments) receivedByBooking.set(p.bookingId, (receivedByBooking.get(p.bookingId) ?? 0) + p.amount);
  const liveIds = new Set(liveBookings.map((b) => b.id));
  const overdueInst = installments.filter((i) => i.dueDate < today && i.amountReceived < i.amountDue);
  const overdueAmount = sum(overdueInst, (i) => i.amountDue - i.amountReceived);
  const dueNext30 = sum(
    installments.filter((i) => i.dueDate >= today && i.dueDate < addDays(today, 30)),
    (i) => i.amountDue - i.amountReceived,
  );

  // ---- commissions --------------------------------------------------------
  const fee = commissions.filter((c) => c.kind === "DEVELOPER_FEE" && c.status !== "REVERSED");
  const payouts = commissions.filter((c) => c.kind === "BROKER_PAYOUT" && c.status !== "REVERSED");
  const incentives = commissions.filter((c) => c.kind === "EMPLOYEE_INCENTIVE" && c.status !== "REVERSED");
  const feeTotals = {
    expected: sum(fee, (c) => c.amount),
    accrued: sum(fee.filter((c) => c.status === "ACCRUED"), (c) => c.amount),
    earned: sum(fee.filter((c) => c.status === "EARNED" || c.status === "INVOICED"), (c) => c.amount),
    received: sum(fee.filter((c) => c.status === "RECEIVED"), (c) => c.amount),
  };
  const payoutTotals = {
    expected: sum(payouts, (c) => c.amount),
    payable: sum(payouts.filter((c) => !c.isAdjustment && (c.status === "EARNED" || c.status === "APPROVED")), (c) => c.amount),
    clawbackDue: -sum(payouts.filter((c) => c.isAdjustment && c.status !== "PAID"), (c) => c.amount),
    paid: sum(payouts.filter((c) => c.status === "PAID"), (c) => c.amount),
  };
  const incentiveTotal = sum(incentives, (c) => c.amount);

  // ---- mandate health -----------------------------------------------------
  const mandates = projects
    .filter((p) => p.mandates[0])
    .map((p) => {
      const m = p.mandates[0];
      const appointed = p.units.filter((u) => u.mandateId);
      const statuses = appointed.map((u) => effectiveStatus(u, at));
      const absorbed = statuses.filter((s) => s === "BOOKED" || s === "SOLD").length;
      const pb = liveBookings.filter((b) => b.projectId === p.id);
      const value = sum(pb, (b) => b.agreementValue);
      const collected = sum(pb, (b) => receivedByBooking.get(b.id) ?? 0);
      const elapsed = Math.max(0, Math.min(1, (at.getTime() - m.startDate.getTime()) / (m.endDate.getTime() - m.startDate.getTime())));
      const expectedByNow = Math.round(m.targetUnits * elapsed);
      const pace = expectedByNow > 0 ? absorbed / expectedByNow : 1;
      const daysLeft = daysBetween(at, m.endDate);
      const projFee = sum(fee.filter((c) => c.projectId === p.id), (c) => c.amount);
      const projPayout = sum(payouts.filter((c) => c.projectId === p.id), (c) => c.amount);
      const projIncentive = sum(incentives.filter((c) => c.projectId === p.id), (c) => c.amount);
      const health: "ON_TRACK" | "BEHIND" | "AT_RISK" =
        pace >= 0.9 ? "ON_TRACK" : pace >= 0.6 && daysLeft > 60 ? "BEHIND" : "AT_RISK";
      return {
        projectId: p.id,
        projectName: p.name,
        projectCode: p.code,
        developerName: p.developer.name,
        city: p.city,
        color: slotOf.get(p.id) ?? PROJECT_SERIES[0],
        mandateCode: m.code,
        daysLeft,
        targetUnits: m.targetUnits,
        absorbed,
        expectedByNow,
        health,
        available: statuses.filter((s) => s === "AVAILABLE").length,
        unsoldValue: sum(appointed.filter((_, idx) => statuses[idx] === "AVAILABLE"), (u) => u.listPrice),
        bookingValue: value,
        collected,
        fee: projFee,
        partnerCost: projPayout,
        incentiveCost: projIncentive,
        net: projFee - projPayout - projIncentive,
        pendingApprovals: bookings.filter((b) => b.projectId === p.id && b.status.startsWith("PENDING")).length,
        overdue: sum(overdueInst.filter((i) => pb.some((b) => b.id === i.bookingId)), (i) => i.amountDue - i.amountReceived),
      };
    });
  const colorByProject = new Map(mandates.map((m) => [m.projectId, m.color]));

  // ---- trend: confirmed booking value by month and project ----------------
  const months = Array.from({ length: 6 }, (_, k) => startOfMonth(new Date(at.getFullYear(), at.getMonth() - 5 + k, 1)));
  const trend = months.map((start, k) => {
    const end = k < months.length - 1 ? months[k + 1] : addDays(at, 1);
    const row: Record<string, string | number> = { month: start.toLocaleString("en-IN", { month: "short" }) };
    for (const m of mandates) {
      const inMonth = bookings.filter(
        (b) => b.projectId === m.projectId && b.bookedAt >= start && b.bookedAt < end && b.status !== "REJECTED" && !b.status.startsWith("PENDING"),
      );
      row[m.projectCode] = Math.round(sum(inMonth, (b) => b.agreementValue) / 1e5) / 100; // ₹ Cr, 2 dp
      row[`${m.projectCode}_n`] = inMonth.length;
    }
    return row;
  });

  // ---- funnel (all leads in scope) ----------------------------------------
  const visitedLeads = new Set(visits.filter((v) => v.status === "COMPLETED").map((v) => v.leadId));
  const [bookedRows, qualifiedRows] = await Promise.all([
    db.booking.findMany({ where: { ...pf, status: { notIn: ["REJECTED"] } }, select: { leadId: true } }),
    // "Ever qualified" comes from the stage history, so leads that were later lost still count.
    db.leadActivity.findMany({ where: { type: "STAGE_CHANGE", note: { endsWith: "QUALIFIED" }, lead: pf }, select: { leadId: true } }),
  ]);
  const leadBooked = new Set(bookedRows.map((b) => b.leadId));
  const qualified = new Set([...qualifiedRows.map((r) => r.leadId), ...visitedLeads, ...leadBooked]);
  const funnel = [
    { stage: "Leads", n: leads.length },
    { stage: "Contacted", n: leads.filter((l) => l.lastContactAt).length },
    { stage: "Qualified", n: leads.filter((l) => qualified.has(l.id)).length },
    { stage: "Site visit done", n: visitedLeads.size },
    { stage: "Booked", n: leadBooked.size },
  ];

  // ---- source & partner performance ---------------------------------------
  const sources = (["BROKER", "META_ADS", "GOOGLE_ADS", "WEBSITE", "WALK_IN", "REFERRAL", "DIRECT"] as LeadSource[]).map((source) => {
    const ls = leads.filter((l) => l.source === source);
    const bs = liveBookings.filter((b) => b.lead.source === source);
    return { source, leads: ls.length, bookings: bs.length, value: sum(bs, (b) => b.agreementValue), conversion: ls.length ? bs.length / ls.length : 0 };
  });
  const partners = brokers
    .map((br) => {
      const ls = leads.filter((l) => l.brokerId === br.id);
      const bs = liveBookings.filter((b) => b.brokerId === br.id);
      return {
        id: br.id,
        firmName: br.firmName,
        code: br.code,
        leads: ls.length,
        visits: ls.filter((l) => visitedLeads.has(l.id)).length,
        bookings: bs.length,
        value: sum(bs, (b) => b.agreementValue),
        brokerage: sum(payouts.filter((c) => c.brokerId === br.id), (c) => c.amount),
        paid: sum(payouts.filter((c) => c.brokerId === br.id && c.status === "PAID"), (c) => c.amount),
      };
    })
    .filter((p) => p.leads > 0)
    .sort((a, b) => b.value - a.value);
  const team = execs
    .map((e) => {
      const ls = leads.filter((l) => l.assignedToId === e.id);
      const bs = liveBookings.filter((b) => b.salesExecId === e.id);
      return {
        id: e.id,
        name: e.name,
        open: ls.filter((l) => !CLOSED_STAGES.includes(l.stage)).length,
        overdue: ls.filter((l) => !CLOSED_STAGES.includes(l.stage) && l.nextFollowUpAt && l.nextFollowUpAt < at).length,
        bookings: bs.length,
        value: sum(bs, (b) => b.agreementValue),
      };
    })
    .filter((t) => t.open + t.bookings > 0);

  // ---- alerts -------------------------------------------------------------
  const pending = bookings
    .filter((b) => b.status === "PENDING_MGMT_APPROVAL" || b.status === "PENDING_DEV_APPROVAL")
    .map((b) => ({ id: b.id, code: b.code, unitNo: b.unit.unitNo, customer: b.customer.name, discountBps: b.discountBps, status: b.status, bookedAt: b.bookedAt }));
  const overdueByBooking = new Map<string, { amount: number; oldest: Date }>();
  for (const i of overdueInst) {
    const cur = overdueByBooking.get(i.bookingId);
    overdueByBooking.set(i.bookingId, { amount: (cur?.amount ?? 0) + i.amountDue - i.amountReceived, oldest: cur && cur.oldest < i.dueDate ? cur.oldest : i.dueDate });
  }
  const overdueCollections = [...overdueByBooking.entries()]
    .map(([id, v]) => {
      const b = liveBookings.find((x) => x.id === id)!;
      return { id, code: b.code, customer: b.customer.name, amount: v.amount, daysLate: daysBetween(v.oldest, at) };
    })
    .sort((a, b) => b.amount - a.amount);
  const expiringHolds = projects.flatMap((p) =>
    p.units
      .filter((u) => u.status === "HOLD" && u.holdExpiresAt && u.holdExpiresAt > at && u.holdExpiresAt < addMinutes(at, 60))
      .map((u) => ({ id: u.id, unitNo: u.unitNo, projectId: p.id, expiresAt: u.holdExpiresAt! })),
  );
  const refunds = bookings.filter((b) => b.status === "CANCELLED" && b.refundDue > 0).map((b) => ({ id: b.id, code: b.code, customer: b.customer.name, refundDue: b.refundDue }));

  const bookingsThisMonth = bookings.filter((b) => b.bookedAt >= monthStart && liveIds.has(b.id));
  const bookingsPrevMonth = bookings.filter((b) => b.bookedAt >= prevMonthStart && b.bookedAt < monthStart && liveIds.has(b.id));
  const appointedUnits = mandates.reduce((s, m) => s + m.targetUnits, 0);

  return {
    asOf: at,
    projects: projects.map((p) => ({ id: p.id, name: p.name })),
    kpis: {
      activeMandates: mandates.length,
      expiringMandates: mandates.filter((m) => m.daysLeft < 60).length,
      appointedTarget: appointedUnits,
      absorbed: sum(mandates, (m) => m.absorbed),
      available: sum(mandates, (m) => m.available),
      unsoldValue: sum(mandates, (m) => m.unsoldValue),
      soldValue: sum(liveBookings, (b) => b.agreementValue),
      bookingsThisMonth: { count: bookingsThisMonth.length, value: sum(bookingsThisMonth, (b) => b.agreementValue) },
      bookingsPrevMonth: { count: bookingsPrevMonth.length, value: sum(bookingsPrevMonth, (b) => b.agreementValue) },
      collected: sum(payments.filter((p) => liveIds.has(p.bookingId)), (p) => p.amount),
      collectedThisMonth: sum(payments.filter((p) => p.receivedAt >= monthStart && liveIds.has(p.bookingId)), (p) => p.amount),
      overdueAmount,
      overdueCount: overdueByBooking.size,
      dueNext30,
      fee: feeTotals,
      payouts: payoutTotals,
      incentives: incentiveTotal,
      netMargin: feeTotals.expected - payoutTotals.expected - incentiveTotal,
      openLeads: leads.filter((l) => !CLOSED_STAGES.includes(l.stage)).length,
      newLeadsThisMonth: leads.filter((l) => l.createdAt >= monthStart).length,
      overdueFollowUps: leads.filter((l) => !CLOSED_STAGES.includes(l.stage) && l.nextFollowUpAt && l.nextFollowUpAt < at).length,
      visitsLast30: visits.filter((v) => v.status === "COMPLETED" && v.completedAt && v.completedAt >= addDays(at, -30)).length,
    },
    mandates,
    trend,
    trendSeries: mandates.map((m) => ({ key: m.projectCode, name: m.projectName, color: m.color })),
    funnel,
    sources,
    partners,
    team,
    alerts: { pending, overdueCollections, expiringHolds, refunds, expiringMandates: mandates.filter((m) => m.daysLeft < 60) },
    colorByProject: Object.fromEntries(colorByProject),
  };
}
