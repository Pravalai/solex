import type { Prisma } from "@/generated/prisma/client";
import type { LeadSource, LeadStage } from "@/generated/prisma/enums";
import { db } from "@/lib/db";
import { now, startOfDay, addDays } from "@/lib/clock";
import { NotFoundError } from "@/lib/errors";
import type { Actor } from "@/modules/identity/actor";
import { can } from "@/modules/identity/permissions";
import { leadScope } from "@/modules/identity/scope";
import { BOOKABLE_STAGES, CLOSED_STAGES } from "@/modules/crm/leads";

export type LeadFilters = {
  q?: string;
  stage?: LeadStage | "OPEN" | "OVERDUE";
  projectId?: string;
  source?: LeadSource;
};

export async function listLeads(actor: Actor, filters: LeadFilters = {}) {
  const at = now();
  const where: Prisma.LeadWhereInput = { AND: [leadScope(actor)] };
  const and = where.AND as Prisma.LeadWhereInput[];
  if (filters.projectId) and.push({ projectId: filters.projectId });
  if (filters.source) and.push({ source: filters.source });
  if (filters.stage === "OPEN") and.push({ stage: { notIn: CLOSED_STAGES } });
  else if (filters.stage === "OVERDUE") and.push({ stage: { notIn: CLOSED_STAGES }, nextFollowUpAt: { lt: at } });
  else if (filters.stage) and.push({ stage: filters.stage });
  if (filters.q) {
    const q = filters.q.trim();
    and.push({ OR: [{ name: { contains: q } }, { code: { contains: q } }, { phoneNormalized: { contains: q.replace(/\D/g, "") || q } }] });
  }
  const leads = await db.lead.findMany({
    where,
    orderBy: [{ nextFollowUpAt: "asc" }],
    take: 300,
    include: {
      project: { select: { code: true, name: true } },
      broker: { select: { firmName: true } },
      assignedTo: { select: { name: true } },
    },
  });
  return leads.map((l) => ({
    id: l.id,
    code: l.code,
    name: l.name,
    phone: l.phone,
    project: l.project,
    source: l.source,
    campaign: l.campaign,
    brokerName: l.broker?.firmName ?? null,
    assignedTo: l.assignedTo?.name ?? null,
    stage: l.stage,
    configPref: l.configPref,
    budgetMax: l.budgetMax,
    nextFollowUpAt: l.nextFollowUpAt,
    lastContactAt: l.lastContactAt,
    createdAt: l.createdAt,
    overdue: !CLOSED_STAGES.includes(l.stage) && !!l.nextFollowUpAt && l.nextFollowUpAt < at,
  }));
}

export async function leadStageCounts(actor: Actor) {
  const rows = await db.lead.groupBy({ by: ["stage"], where: leadScope(actor), _count: true });
  return Object.fromEntries(rows.map((r) => [r.stage, r._count])) as Partial<Record<LeadStage, number>>;
}

/** Today's work for a sales exec: overdue follow-ups and visits in the next 48 hours. */
export async function myAgenda(actor: Actor) {
  const at = now();
  const [overdue, visits] = await Promise.all([
    db.lead.count({ where: { AND: [leadScope(actor), { stage: { notIn: CLOSED_STAGES }, nextFollowUpAt: { lt: at } }] } }),
    db.siteVisit.findMany({
      where: { lead: leadScope(actor), status: "SCHEDULED", scheduledAt: { gte: startOfDay(at), lt: addDays(startOfDay(at), 3) } },
      orderBy: { scheduledAt: "asc" },
      include: { lead: { select: { id: true, name: true, code: true } }, project: { select: { name: true } } },
    }),
  ]);
  return { overdue, visits };
}

export async function getLeadDetail(actor: Actor, leadId: string) {
  const lead = await db.lead.findFirst({
    where: { AND: [{ id: leadId }, leadScope(actor)] },
    include: {
      project: { select: { id: true, code: true, name: true, mandates: { where: { status: "ACTIVE" }, select: { attributionWindowDays: true } } } },
      broker: { select: { id: true, firmName: true, code: true, contactName: true } },
      assignedTo: { select: { id: true, name: true } },
      activities: { orderBy: { at: "desc" }, include: { user: { select: { name: true } } } },
      visits: { orderBy: { scheduledAt: "desc" }, include: { assignedTo: { select: { name: true } } } },
      bookings: {
        orderBy: { bookedAt: "desc" },
        select: { id: true, code: true, status: true, agreementValue: true, bookedAt: true, unit: { select: { unitNo: true } } },
      },
    },
  });
  if (!lead) throw new NotFoundError("Lead");
  const reassignTo = can(actor, "lead.reassign")
    ? await db.user.findMany({
        where: { role: "SALES", active: true, allocations: { some: { projectId: lead.projectId } } },
        select: { id: true, name: true },
        orderBy: { name: "asc" },
      })
    : [];
  const at = now();
  return {
    ...lead,
    bookable: BOOKABLE_STAGES.includes(lead.stage),
    closed: CLOSED_STAGES.includes(lead.stage),
    attributionActive: !!lead.attributionExpiresAt && lead.attributionExpiresAt > at,
    reassignTo,
  };
}

/** Leads an internal user could book against a given unit's project (for the unit drawer). */
export async function bookableLeadsFor(actor: Actor, projectId: string) {
  return db.lead.findMany({
    where: { AND: [leadScope(actor), { projectId, stage: { in: BOOKABLE_STAGES } }] },
    orderBy: { updatedAt: "desc" },
    take: 50,
    select: { id: true, code: true, name: true, stage: true, broker: { select: { firmName: true } } },
  });
}
