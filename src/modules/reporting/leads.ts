import type { Prisma } from "@/generated/prisma/client";
import type { LeadSource, LeadStage } from "@/generated/prisma/enums";
import { db } from "@/lib/db";
import { now, startOfDay, addDays } from "@/lib/clock";
import { NotFoundError } from "@/lib/errors";
import type { Actor } from "@/modules/identity/actor";
import { can } from "@/modules/identity/permissions";
import { leadScope } from "@/modules/identity/scope";
import { BOOKABLE_STAGES, CLOSED_STAGES } from "@/modules/crm/leads";
import { decodeNextAction, type CallLine, type Insight, type NextAction } from "@/modules/calls/types";
import { draftFollowUp } from "@/modules/calls/messages";
import { fromPriceFor } from "@/modules/calls/calls";

/** Leads closest to a booking: worth a manager's attention when a mandate is behind pace. */
export const HOT_STAGES: LeadStage[] = ["VISIT_DONE", "NEGOTIATION", "BOOKING_INITIATED"];
/** A partner lead whose protection ends within this many days, with no visit yet, is at risk of a dispute. */
export const ATTRIBUTION_WARN_DAYS = 7;

export type LeadFilters = {
  q?: string;
  stage?: LeadStage | "OPEN" | "OVERDUE" | "HOT" | "EXPIRING";
  projectId?: string;
  source?: LeadSource;
  ownerId?: string;
};

/** Open partner leads whose attribution lapses within the warning window and that have had no completed visit. */
export function expiringAttributionWhere(at: Date): Prisma.LeadWhereInput {
  return {
    brokerId: { not: null },
    stage: { notIn: CLOSED_STAGES },
    attributionExpiresAt: { gt: at, lt: addDays(at, ATTRIBUTION_WARN_DAYS) },
    visits: { none: { status: "COMPLETED" } },
  };
}

export async function listLeads(actor: Actor, filters: LeadFilters = {}) {
  const at = now();
  const where: Prisma.LeadWhereInput = { AND: [leadScope(actor)] };
  const and = where.AND as Prisma.LeadWhereInput[];
  if (filters.projectId) and.push({ projectId: filters.projectId });
  if (filters.source) and.push({ source: filters.source });
  if (filters.ownerId) and.push({ assignedToId: filters.ownerId });
  if (filters.stage === "OPEN") and.push({ stage: { notIn: CLOSED_STAGES } });
  else if (filters.stage === "OVERDUE") and.push({ stage: { notIn: CLOSED_STAGES }, nextFollowUpAt: { lt: at } });
  else if (filters.stage === "HOT") and.push({ stage: { in: HOT_STAGES } });
  else if (filters.stage === "EXPIRING") and.push(expiringAttributionWhere(at));
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
      project: { select: { id: true, code: true, name: true, locality: true, mandates: { where: { status: "ACTIVE" }, select: { attributionWindowDays: true } } } },
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
  // Call recordings, transcripts and insights are internal: never projected for partners or developers.
  const canViewCalls = can(actor, "call.view");
  const calls = canViewCalls
    ? await db.call.findMany({
        where: { leadId: lead.id, status: { in: ["COMPLETED", "NO_ANSWER"] } },
        orderBy: { startedAt: "desc" },
        select: {
          id: true,
          attempt: true,
          status: true,
          startedAt: true,
          talkSec: true,
          transcript: true,
          summary: true,
          sentiment: true,
          interestScore: true,
          execTalkPct: true,
          nextStep: true,
          nextAction: true,
          endedAt: true,
          activityId: true,
          user: { select: { name: true } },
          insights: { orderBy: { seq: "asc" }, select: { polarity: true, category: true, text: true, quote: true, atSec: true } },
        },
      })
    : [];
  const parsedCalls = calls.map(({ transcript, ...c }) => ({
    ...c,
    insights: c.insights as Insight[],
    transcript: transcript ? (JSON.parse(transcript) as CallLine[]) : [],
  }));
  const callByActivity = new Map(parsedCalls.filter((c) => c.activityId).map((c) => [c.activityId!, c]));
  const reassignTo = can(actor, "lead.reassign")
    ? await db.user.findMany({
        where: { role: "SALES", active: true, allocations: { some: { projectId: lead.projectId } } },
        select: { id: true, name: true },
        orderBy: { name: "asc" },
      })
    : [];
  const at = now();
  const closed = CLOSED_STAGES.includes(lead.stage);
  const latest = parsedCalls[0];
  const nextAction =
    !closed && latest
      ? openCallAction(latest, {
          visitsCreatedAt: lead.visits.map((v) => v.createdAt),
          messagesAt: lead.activities.filter((a) => a.type === "WHATSAPP").map((a) => a.at),
        })
      : null;
  const needsUnits = !closed && can(actor, "booking.create");
  const [bestFit, fromPrice] = await Promise.all([
    needsUnits ? bestFitUnits(lead.projectId, lead.configPref, lead.budgetMax) : Promise.resolve([]),
    nextAction && (nextAction.kind === "SEND_INFO" || nextAction.kind === "NURTURE") ? fromPriceFor(db, lead.projectId, lead.configPref) : Promise.resolve(null),
  ]);
  return {
    ...lead,
    activities: lead.activities.map((a) => ({ ...a, call: callByActivity.get(a.id) ?? null })),
    calls: parsedCalls,
    nextAction,
    nextStep: nextAction ? (latest?.nextStep ?? null) : null,
    draft: nextAction
      ? draftFollowUp(nextAction, {
          customerName: lead.name,
          execName: actor.name,
          projectName: lead.project.name,
          locality: lead.project.locality,
          configPref: lead.configPref,
          fromPrice,
        })
      : null,
    bestFit,
    bookable: BOOKABLE_STAGES.includes(lead.stage),
    closed,
    attributionActive: !!lead.attributionExpiresAt && lead.attributionExpiresAt > at,
    reassignTo,
  };
}

/**
 * The latest call's suggested action, unless it has already been done: a visit
 * scheduled after the call resolves SCHEDULE_VISIT, a WhatsApp sent after it
 * resolves SEND_INFO / NURTURE. Call-backs stay open until the next call.
 */
export function openCallAction(
  call: { nextAction: string | null; startedAt: Date; endedAt: Date | null },
  after: { visitsCreatedAt: Date[]; messagesAt: Date[] },
): NextAction | null {
  const action = decodeNextAction(call.nextAction);
  if (!action) return null;
  const since = call.endedAt ?? call.startedAt;
  if (action.kind === "SCHEDULE_VISIT" && after.visitsCreatedAt.some((d) => d >= since)) return null;
  if ((action.kind === "SEND_INFO" || action.kind === "NURTURE") && after.messagesAt.some((d) => d >= since)) return null;
  return action;
}

/**
 * Up to `take` bookable units for a lead: available appointed units of the
 * preferred configuration priced within budget (+5%), closest to budget first.
 * Falls back to the cheapest matching units when nothing fits the budget.
 */
export async function bestFitUnits(projectId: string, configPref: string | null, budgetMax: number | null, take = 3) {
  const at = now();
  const where: Prisma.UnitWhereInput = {
    projectId,
    mandateId: { not: null },
    OR: [{ status: "AVAILABLE" }, { status: "HOLD", holdExpiresAt: { lt: at } }],
    ...(configPref ? { config: configPref } : {}),
  };
  const select = { id: true, unitNo: true, config: true, floor: true, facing: true, superSqft: true, listPrice: true } as const;
  const cap = budgetMax ? Math.round(budgetMax * 1.05) : null;
  const within = cap ? await db.unit.findMany({ where: { ...where, listPrice: { lte: cap } }, orderBy: { listPrice: "desc" }, take, select }) : [];
  if (within.length > 0) return within.map((u) => ({ ...u, overBudget: false }));
  const cheapest = await db.unit.findMany({ where, orderBy: { listPrice: "asc" }, take, select });
  return cheapest.map((u) => ({ ...u, overBudget: !!budgetMax && u.listPrice > budgetMax }));
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
