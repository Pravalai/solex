import { db } from "@/lib/db";
import { daysBetween, now, startOfDay } from "@/lib/clock";
import { NotFoundError } from "@/lib/errors";
import type { Actor } from "@/modules/identity/actor";
import { assertCan } from "@/modules/identity/permissions";
import { bookingScope, commissionScope, leadScope, projectScope } from "@/modules/identity/scope";
import { effectiveStatus } from "@/modules/inventory/units";
import { CLOSED_STAGES } from "@/modules/crm/leads";

/**
 * Read models for the two external portals. Each returns a deliberately narrow
 * DTO (explicit selects), so internal fields cannot leak by accident.
 */

// ------------------------------------------------------------------ broker
function requireBroker(actor: Actor) {
  if (actor.role !== "BROKER" || !actor.brokerId) throw new NotFoundError("Partner");
}

export async function listBrokerLeads(actor: Actor) {
  requireBroker(actor);
  const at = now();
  const leads = await db.lead.findMany({
    where: leadScope(actor),
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      code: true,
      name: true,
      phone: true,
      stage: true,
      createdAt: true,
      attributionExpiresAt: true,
      project: { select: { name: true } },
      assignedTo: { select: { name: true } },
      visits: { orderBy: { scheduledAt: "desc" }, take: 1, select: { scheduledAt: true, status: true } },
      bookings: { where: { brokerId: actor.brokerId }, select: { code: true, status: true, unit: { select: { unitNo: true } } } },
    },
  });
  return leads.map((l) => ({
    id: l.id,
    code: l.code,
    name: l.name,
    phone: l.phone,
    stage: l.stage,
    createdAt: l.createdAt,
    project: l.project.name,
    // Partners see who their soleX relationship manager is, not internal notes or activity.
    relationshipManager: l.assignedTo?.name ?? null,
    lastVisit: l.visits[0] ?? null,
    booking: l.bookings[0] ? { code: l.bookings[0].code, status: l.bookings[0].status, unitNo: l.bookings[0].unit.unitNo } : null,
    protectedDaysLeft: l.attributionExpiresAt && !CLOSED_STAGES.includes(l.stage) ? Math.max(0, daysBetween(at, l.attributionExpiresAt)) : null,
  }));
}

export async function getBrokerHome(actor: Actor) {
  requireBroker(actor);
  const [broker, leads, bookings, lines, projects] = await Promise.all([
    db.broker.findUniqueOrThrow({ where: { id: actor.brokerId! }, select: { firmName: true, code: true, reraAgentNo: true } }),
    db.lead.findMany({ where: leadScope(actor), select: { stage: true, visits: { where: { status: "COMPLETED" }, select: { id: true } } } }),
    db.booking.findMany({ where: { AND: [bookingScope(actor), { status: { in: ["CONFIRMED", "AGREEMENT"] } }] }, select: { agreementValue: true } }),
    db.commission.findMany({ where: commissionScope(actor), select: { status: true, amount: true } }),
    db.project.findMany({
      where: projectScope(actor),
      orderBy: { name: "asc" },
      select: {
        id: true,
        name: true,
        city: true,
        locality: true,
        units: { where: { mandateId: { not: null } }, select: { status: true, holdExpiresAt: true, listPrice: true, config: true } },
      },
    }),
  ]);
  const at = now();
  const amount = (statuses: string[]) => lines.filter((l) => statuses.includes(l.status)).reduce((s, l) => s + l.amount, 0);
  return {
    broker,
    stats: {
      leads: leads.length,
      active: leads.filter((l) => !CLOSED_STAGES.includes(l.stage)).length,
      visits: leads.filter((l) => l.visits.length > 0).length,
      bookings: bookings.length,
      salesValue: bookings.reduce((s, b) => s + b.agreementValue, 0),
      conversion: leads.length ? bookings.length / leads.length : 0,
    },
    brokerage: {
      accrued: amount(["ACCRUED"]),
      payable: amount(["EARNED", "APPROVED"]),
      paid: amount(["PAID"]),
    },
    projects: projects.map((p) => {
      const available = p.units.filter((u) => effectiveStatus(u, at) === "AVAILABLE");
      return {
        id: p.id,
        name: p.name,
        city: p.city,
        locality: p.locality,
        available: available.length,
        fromPrice: available.length ? Math.min(...available.map((u) => u.listPrice)) : null,
        configs: [...new Set(available.map((u) => u.config))].sort(),
      };
    }),
  };
}

export async function getBrokerCommissions(actor: Actor) {
  requireBroker(actor);
  const lines = await db.commission.findMany({
    where: commissionScope(actor),
    orderBy: { accruedAt: "desc" },
    select: {
      id: true,
      status: true,
      amount: true,
      rateBps: true,
      baseAmount: true,
      isAdjustment: true,
      reference: true,
      accruedAt: true,
      earnedAt: true,
      settledAt: true,
      booking: { select: { code: true, status: true, bookedAt: true, customer: { select: { name: true } }, unit: { select: { unitNo: true } }, project: { select: { name: true } } } },
    },
  });
  return lines;
}

// --------------------------------------------------------------- developer
function requireDeveloper(actor: Actor) {
  if (actor.role !== "DEVELOPER" || !actor.developerId) throw new NotFoundError("Developer");
}

export async function getDeveloperPortfolio(actor: Actor) {
  requireDeveloper(actor);
  const at = now();
  const today = startOfDay(at);
  const projects = await db.project.findMany({
    where: projectScope(actor),
    orderBy: { name: "asc" },
    select: {
      id: true,
      name: true,
      city: true,
      locality: true,
      mandates: { where: { status: "ACTIVE" }, select: { code: true, targetUnits: true, endDate: true, soleXFeeBps: true } },
      units: { select: { status: true, holdExpiresAt: true, mandateId: true } },
      bookings: {
        select: {
          status: true,
          agreementValue: true,
          installments: { where: { status: { not: "CANCELLED" } }, select: { amountDue: true, amountReceived: true, dueDate: true } },
        },
      },
      commissions: { where: { kind: "DEVELOPER_FEE", status: { not: "REVERSED" } }, select: { status: true, amount: true } },
      _count: { select: { leads: true } },
    },
  });
  const funnelRows = await db.lead.groupBy({ by: ["projectId", "stage"], where: { project: projectScope(actor) }, _count: true });
  const visitRows = await db.siteVisit.groupBy({ by: ["projectId"], where: { project: projectScope(actor), status: "COMPLETED" }, _count: true });

  return projects.map((p) => {
    const counts = { AVAILABLE: 0, HOLD: 0, BLOCKED: 0, BOOKED: 0, SOLD: 0, retained: 0 };
    for (const u of p.units) {
      if (!u.mandateId) counts.retained++;
      else counts[effectiveStatus(u, at)]++;
    }
    const live = p.bookings.filter((b) => b.status === "CONFIRMED" || b.status === "AGREEMENT");
    const inst = live.flatMap((b) => b.installments);
    const fee = (statuses: string[]) => p.commissions.filter((c) => statuses.includes(c.status)).reduce((s, c) => s + c.amount, 0);
    const stage = (s: string[]) => funnelRows.filter((r) => r.projectId === p.id && s.includes(r.stage)).reduce((a, r) => a + r._count, 0);
    const m = p.mandates[0];
    return {
      id: p.id,
      name: p.name,
      city: p.city,
      locality: p.locality,
      mandate: m ? { code: m.code, targetUnits: m.targetUnits, daysLeft: daysBetween(at, m.endDate), soleXFeeBps: m.soleXFeeBps } : null,
      counts,
      bookedValue: live.reduce((s, b) => s + b.agreementValue, 0),
      liveBookings: live.length,
      cancellations: p.bookings.filter((b) => b.status === "CANCELLED").length,
      pendingApprovals: p.bookings.filter((b) => b.status === "PENDING_DEV_APPROVAL").length,
      collected: inst.reduce((s, i) => s + i.amountReceived, 0),
      overdue: inst.filter((i) => i.dueDate < today).reduce((s, i) => s + Math.max(0, i.amountDue - i.amountReceived), 0),
      fee: { accrued: fee(["ACCRUED"]), payable: fee(["EARNED", "INVOICED"]), paid: fee(["RECEIVED"]) },
      // Aggregate counts only: developers do not see individual leads or who brought them.
      funnel: {
        enquiries: p._count.leads,
        active: stage(["NEW", "CONTACTED", "QUALIFIED", "FOLLOW_UP", "VISIT_PLANNED", "VISIT_DONE", "NEGOTIATION", "BOOKING_INITIATED"]),
        visits: visitRows.find((v) => v.projectId === p.id)?._count ?? 0,
        booked: stage(["BOOKED"]),
      },
    };
  });
}

export async function getDeveloperFeeStatement(actor: Actor, projectId: string) {
  requireDeveloper(actor);
  return db.commission.findMany({
    where: { AND: [commissionScope(actor), { projectId }] },
    orderBy: { accruedAt: "desc" },
    select: {
      id: true,
      kind: true,
      status: true,
      rateBps: true,
      baseAmount: true,
      amount: true,
      isAdjustment: true,
      reference: true,
      booking: { select: { code: true, unit: { select: { unitNo: true } } } },
    },
  });
}

export async function listDeveloperApprovals(actor: Actor) {
  requireDeveloper(actor);
  assertCan(actor, "discount.approve.developer");
  return db.booking.findMany({
    where: { AND: [bookingScope(actor), { status: "PENDING_DEV_APPROVAL" }] },
    orderBy: { bookedAt: "asc" },
    select: {
      id: true,
      code: true,
      listPrice: true,
      discountAmount: true,
      discountBps: true,
      agreementValue: true,
      bookedAt: true,
      mgmtApprovedBy: true,
      mgmtApprovedAt: true,
      unit: { select: { unitNo: true, config: true, superSqft: true } },
      project: { select: { name: true } },
      mandate: { select: { mgmtMaxDiscountBps: true } },
      customer: { select: { name: true } },
    },
  });
}
