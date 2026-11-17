import type { CommissionKind, CommissionStatus, LeadSource, LeadStage } from "@/generated/prisma/enums";
import { db } from "@/lib/db";
import { addDays, daysBetween, now, startOfDay } from "@/lib/clock";
import { formatDateTime, humanize } from "@/lib/format";
import { formatBps, formatINRCompact } from "@/lib/money";
import { maskPhone } from "@/lib/phone";
import type { Actor } from "@/modules/identity/actor";
import { assertCan, can } from "@/modules/identity/permissions";
import { leadScope } from "@/modules/identity/scope";
import { CLOSED_STAGES } from "@/modules/crm/leads";
import { earningThreshold } from "@/modules/finance/calc";
import { nextActionLabel } from "@/modules/calls/types";
import type { getCommandCentre } from "./command";
import { runIntegrityChecks } from "./integrity";
import { ATTRIBUTION_WARN_DAYS, HOT_STAGES, bestFitUnits, expiringAttributionWhere, openCallAction } from "./leads";
import type { Queue, QueueAction, QueueItem, Severity } from "./queue-types";

/**
 * Action queues: for each persona, the short list of things that need them now.
 * Every item comes from a fixed, named rule over live records (no scoring model,
 * no AI), so each insight can say exactly why it is there.
 *
 * The rule functions are pure (rows in, items out) so they are unit-tested
 * without a database; the loaders fetch scoped rows and call them.
 */

const SEVERITY_ORDER: Record<Severity, number> = { high: 0, medium: 1, low: 2 };

/** Orders by severity, then by rule rank (if given), then by the order rows arrived in. */
function finish(items: QueueItem[], limit: number, rank?: Map<string, number>): Queue {
  const sorted = items
    .map((item, i) => ({ item, i, r: rank?.get(item.id) ?? 0 }))
    .sort((a, b) => SEVERITY_ORDER[a.item.severity] - SEVERITY_ORDER[b.item.severity] || a.r - b.r || a.i - b.i)
    .map((x) => x.item);
  return { items: sorted.slice(0, limit), total: sorted.length };
}

/** An open lead whose follow-up date passed this long ago is stale: a clean-up job, not today's call list. */
export const STALE_DAYS = 30;

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

function hoursBetween(from: Date, to: Date) {
  return Math.round((to.getTime() - from.getTime()) / 3_600_000);
}

function relDays(d: Date, at: Date) {
  const days = daysBetween(startOfDay(at), startOfDay(d));
  if (days === 0) return "today";
  if (days === 1) return "tomorrow";
  if (days === -1) return "yesterday";
  return days > 0 ? `in ${days} days` : `${-days} days ago`;
}

const STAGE_LABEL: Partial<Record<LeadStage, string>> = { VISIT_DONE: "Visit done", VISIT_PLANNED: "Visit planned", FOLLOW_UP: "Follow-up" };
const stageLabel = (s: LeadStage) => STAGE_LABEL[s] ?? humanize(s);

/** 11:00 tomorrow: the default slot offered when an action needs a date. */
export function defaultSlot(at: Date): Date {
  const d = addDays(at, 1);
  d.setHours(11, 0, 0, 0);
  return d;
}

// =================================================================== SALES

export type SalesLeadRow = {
  id: string;
  code: string;
  name: string;
  phone: string;
  stage: LeadStage;
  source: LeadSource;
  createdAt: Date;
  lastContactAt: Date | null;
  nextFollowUpAt: Date | null;
  attributionExpiresAt: Date | null;
  brokerName: string | null;
  projectId: string;
  projectName: string;
  visits: { id: string; status: string; scheduledAt: Date; createdAt: Date; completedAt: Date | null }[];
  messagesAt: Date[];
  lastCall: { nextAction: string | null; nextStep: string | null; startedAt: Date; endedAt: Date | null } | null;
  /** Best-fit unit, loaded only for leads that have visited but not booked. */
  bestFit?: { id: string; unitNo: string; listPrice: number; overBudget: boolean } | null;
};

export type SalesHoldRow = { unitId: string; unitNo: string; projectId: string; expiresAt: Date };

export function salesQueue(input: { leads: SalesLeadRow[]; holds: SalesHoldRow[] }, at: Date, limit = 8): Queue {
  const items: QueueItem[] = [];
  const rank = new Map<string, number>();
  const stale: SalesLeadRow[] = [];
  const endOfTomorrow = addDays(startOfDay(at), 2);
  const staleBefore = addDays(at, -STALE_DAYS);

  for (const h of input.holds) {
    const mins = Math.max(0, Math.round((h.expiresAt.getTime() - at.getTime()) / 60_000));
    items.push({
      id: `hold-${h.unitId}`,
      severity: mins <= 30 ? "high" : "medium",
      title: `Your hold on ${h.unitNo} ends in ${mins} min`,
      href: `/projects/${h.projectId}?unit=${h.unitId}`,
      why: "Book it now or release it so others can sell it.",
      rule: "A unit you are holding whose hold has not yet lapsed.",
      actions: [{ kind: "link", href: `/projects/${h.projectId}?unit=${h.unitId}`, label: "Book now" }],
    });
  }

  for (const l of input.leads) {
    const call: QueueAction = { kind: "call", leadId: l.id, customerName: l.name, phoneMasked: maskPhone(l.phone), projectName: l.projectName };
    const base = { href: `/leads/${l.id}`, title: `${l.name} · ${l.projectName}` };
    const push = (r: number, id: string, severity: Severity, why: string, rule: string, actions: QueueAction[]) => {
      items.push({ id: `${id}-${l.id}`, severity, ...base, why, rule, actions });
      rank.set(`${id}-${l.id}`, r);
    };

    // 1. A partner asked for a site visit: confirm a slot.
    const requested = l.visits.find((v) => v.status === "REQUESTED");
    if (requested) {
      push(1, "visit-request", "high", `${l.brokerName ?? "The partner"} asked for a site visit ${relDays(requested.scheduledAt, at)} (${formatDateTime(requested.scheduledAt)}).`, "A channel partner requested a site visit that nobody has confirmed yet.", [
        { kind: "confirmVisit", visitId: requested.id, defaultAt: requested.scheduledAt.toISOString() },
        call,
      ]);
      continue;
    }

    // 2. A visit is due today or tomorrow, or its time has passed without an outcome.
    const due = l.visits.filter((v) => v.status === "SCHEDULED" && v.scheduledAt < endOfTomorrow).sort((a, b) => +a.scheduledAt - +b.scheduledAt)[0];
    if (due) {
      if (due.scheduledAt < at) {
        push(2, "visit-outcome", "high", `Visit was due ${relDays(due.scheduledAt, at)} at ${formatDateTime(due.scheduledAt)}: record whether it happened.`, "A scheduled site visit whose time has passed with no outcome recorded.", [
          { kind: "link", href: `/leads/${l.id}#visits`, label: "Record outcome" },
        ]);
      } else {
        push(2, "visit-due", "medium", `Site visit ${relDays(due.scheduledAt, at)} at ${formatDateTime(due.scheduledAt)}. Call to confirm they are coming.`, "A site visit scheduled for today or tomorrow.", [call]);
      }
      continue;
    }

    // 3–4. The last call ended with a promise that has not been kept yet.
    const open = l.lastCall ? openCallAction(l.lastCall, { visitsCreatedAt: l.visits.map((v) => v.createdAt), messagesAt: l.messagesAt }) : null;
    if (open?.kind === "SCHEDULE_VISIT") {
      push(3, "call-visit", "high", `Agreed to a site visit on your call ${relDays(l.lastCall!.startedAt, at)}, but none is scheduled yet.`, "The last call ended with the customer agreeing to visit, and no visit has been scheduled since.", [
        { kind: "scheduleVisit", leadId: l.id, defaultAt: defaultSlot(at).toISOString() },
      ]);
      continue;
    }
    if (open?.kind === "SEND_INFO" || open?.kind === "NURTURE") {
      push(4, "call-info", "medium", `${nextActionLabel(open)}: promised on your call ${relDays(l.lastCall!.startedAt, at)}. A draft is ready.`, "The last call ended with information to send, and no WhatsApp has been sent since.", [
        { kind: "link", href: `/leads/${l.id}#next`, label: "Review & send" },
      ]);
      continue;
    }

    // 5. A new lead nobody has called. Partners are promised a call within 24 hours.
    if (l.stage === "NEW" && !l.lastContactAt) {
      const left = 24 - hoursBetween(l.createdAt, at);
      const sla = left > 0 ? `${left} h left` : `${-left} h late`;
      push(
        5,
        "new",
        l.brokerName || left <= 0 ? "high" : "medium",
        l.brokerName ? `Registered by ${l.brokerName}: the partner was promised a call within 24 h (${sla}).` : `New ${humanize(l.source).toLowerCase()} enquiry, not called yet (${sla}).`,
        "A new lead with no contact yet; first call is due within 24 hours of capture.",
        [call],
      );
      continue;
    }

    // Untouched for a month or more: rolled up into one clean-up item below.
    if (l.nextFollowUpAt && l.nextFollowUpAt < staleBefore) {
      stale.push(l);
      continue;
    }

    // 6. Visited, but no booking two days later: put the best-fit unit in front of them.
    const lastVisit = l.visits.filter((v) => v.status === "COMPLETED" && v.completedAt).sort((a, b) => +b.completedAt! - +a.completedAt!)[0];
    if (l.stage === "VISIT_DONE" && lastVisit && daysBetween(lastVisit.completedAt!, at) >= 2) {
      const fit = l.bestFit;
      push(
        6,
        "visited",
        "medium",
        `Visited ${relDays(lastVisit.completedAt!, at)} with no booking yet.${fit ? ` ${fit.unitNo} at ${formatINRCompact(fit.listPrice)} ${fit.overBudget ? "is the closest match" : "fits their budget"}.` : ""}`,
        "Site visit completed two or more days ago and the lead has not moved to booking.",
        [fit ? { kind: "link", href: `/projects/${l.projectId}?lead=${l.id}&unit=${fit.id}`, label: `Book ${fit.unitNo}` } : { kind: "link", href: `/projects/${l.projectId}?lead=${l.id}`, label: "Pick a unit" }, call],
      );
      continue;
    }

    // 7. Follow-up overdue: leads closest to booking first.
    if (l.nextFollowUpAt && l.nextFollowUpAt < at) {
      const late = daysBetween(l.nextFollowUpAt, at);
      push(
        7,
        "overdue",
        HOT_STAGES.includes(l.stage) ? "high" : "medium",
        `${stageLabel(l.stage)} · follow-up ${late === 0 ? "due earlier today" : `${plural(late, "day")} overdue`}${l.lastCall?.nextStep ? ` · last call: ${l.lastCall.nextStep.replace(/\.$/, "").toLowerCase()}` : ""}.`,
        "Follow-up date has passed on an open lead. Negotiation and post-visit leads rank first.",
        [call],
      );
      continue;
    }

    // 8. Partner protection about to lapse with no visit: likely dispute and lost brokerage.
    if (l.brokerName && l.attributionExpiresAt && l.attributionExpiresAt > at && l.attributionExpiresAt < addDays(at, ATTRIBUTION_WARN_DAYS) && !lastVisit) {
      push(8, "attribution", "low", `${l.brokerName}'s protection ends ${relDays(l.attributionExpiresAt, at)} and there has been no site visit.`, `A partner lead whose attribution lapses within ${ATTRIBUTION_WARN_DAYS} days with no completed visit.`, [call]);
    }
  }

  if (stale.length > 0) {
    const oldest = stale.reduce((a, b) => (a.nextFollowUpAt! < b.nextFollowUpAt! ? a : b));
    const hot = stale.filter((l) => HOT_STAGES.includes(l.stage)).length;
    items.push({
      id: "stale",
      severity: "low",
      title: `${plural(stale.length, "lead")} untouched for ${STALE_DAYS}+ days`,
      href: "/leads?view=pipeline&tab=OVERDUE",
      why: `${hot > 0 ? `${hot} of them reached visit or negotiation. ` : ""}Re-engage or close them so your pipeline stays real. Oldest: ${oldest.name} (${stageLabel(oldest.stage)}).`,
      rule: `Open leads whose follow-up date passed more than ${STALE_DAYS} days ago.`,
      actions: [{ kind: "link", href: "/leads?view=pipeline&tab=OVERDUE", label: "Review" }],
    });
    rank.set("stale", 9);
  }

  // Ranked by severity, then by the rule order above.
  return finish(items, limit, rank);
}

export async function getSalesQueue(actor: Actor, limit = 8): Promise<Queue> {
  const at = now();
  const [rows, holds] = await Promise.all([
    db.lead.findMany({
      where: { AND: [leadScope(actor), { stage: { notIn: CLOSED_STAGES } }] },
      orderBy: [{ nextFollowUpAt: "asc" }],
      select: {
        id: true,
        code: true,
        name: true,
        phone: true,
        stage: true,
        source: true,
        createdAt: true,
        lastContactAt: true,
        nextFollowUpAt: true,
        attributionExpiresAt: true,
        projectId: true,
        configPref: true,
        budgetMax: true,
        project: { select: { name: true } },
        broker: { select: { firmName: true } },
        visits: { select: { id: true, status: true, scheduledAt: true, createdAt: true, completedAt: true } },
        activities: { where: { type: "WHATSAPP" }, select: { at: true } },
        calls: {
          where: { status: { in: ["COMPLETED", "NO_ANSWER"] } },
          orderBy: { startedAt: "desc" },
          take: 1,
          select: { nextAction: true, nextStep: true, startedAt: true, endedAt: true },
        },
      },
    }),
    db.unit.findMany({
      where: { holdById: actor.userId, status: "HOLD", holdExpiresAt: { gt: at } },
      select: { id: true, unitNo: true, projectId: true, holdExpiresAt: true },
    }),
  ]);
  const leads: SalesLeadRow[] = await Promise.all(
    rows.map(async (l) => ({
      id: l.id,
      code: l.code,
      name: l.name,
      phone: l.phone,
      stage: l.stage,
      source: l.source,
      createdAt: l.createdAt,
      lastContactAt: l.lastContactAt,
      nextFollowUpAt: l.nextFollowUpAt,
      attributionExpiresAt: l.attributionExpiresAt,
      brokerName: l.broker?.firmName ?? null,
      projectId: l.projectId,
      projectName: l.project.name,
      visits: l.visits,
      messagesAt: l.activities.map((a) => a.at),
      lastCall: l.calls[0] ?? null,
      bestFit: l.stage === "VISIT_DONE" ? ((await bestFitUnits(l.projectId, l.configPref, l.budgetMax, 1))[0] ?? null) : undefined,
    })),
  );
  return salesQueue({ leads, holds: holds.map((h) => ({ unitId: h.id, unitNo: h.unitNo, projectId: h.projectId, expiresAt: h.holdExpiresAt! })) }, at, limit);
}

// ========================================================= OVERDUE MONEY

/**
 * Live bookings with overdue instalments, with the commission effect of
 * collecting them: if paying the overdue amount crosses the mandate's earning
 * trigger, it unlocks soleX's fee (and the payouts that ride on it).
 */
export type OverdueBooking = {
  bookingId: string;
  code: string;
  customer: string;
  unitNo: string;
  projectName: string;
  overdue: number;
  daysLate: number;
  oldestInstallmentId: string;
  oldestLabel: string;
  triggerPct: string;
  crossesTrigger: boolean;
  unlocksFee: number;
  unlocksPayouts: number;
  remindedToday: boolean;
};

export async function loadOverdueBookings(): Promise<OverdueBooking[]> {
  const at = now();
  const today = startOfDay(at);
  const bookings = await db.booking.findMany({
    where: { status: { in: ["CONFIRMED", "AGREEMENT"] }, installments: { some: { status: { in: ["DUE", "PARTIAL"] }, dueDate: { lt: today } } } },
    select: {
      id: true,
      code: true,
      status: true,
      agreementValue: true,
      customer: { select: { name: true } },
      unit: { select: { unitNo: true } },
      project: { select: { name: true } },
      mandate: { select: { earningTriggerBps: true } },
      installments: { where: { status: { not: "CANCELLED" } }, orderBy: { seq: "asc" }, select: { id: true, label: true, dueDate: true, amountDue: true, amountReceived: true } },
      commissions: { where: { status: "ACCRUED", isAdjustment: false }, select: { kind: true, amount: true } },
    },
  });
  const overdueInstIds = bookings.flatMap((b) => b.installments.filter((i) => i.dueDate < today && i.amountReceived < i.amountDue).map((i) => i.id));
  const reminded = new Set(
    (
      await db.auditEvent.findMany({
        where: { type: "PAYMENT_REMINDER_SENT", entityType: "Installment", entityId: { in: overdueInstIds }, at: { gte: today } },
        select: { entityId: true },
      })
    ).map((e) => e.entityId),
  );
  return bookings
    .map((b) => {
      const late = b.installments.filter((i) => i.dueDate < today && i.amountReceived < i.amountDue);
      const received = b.installments.reduce((s, i) => s + i.amountReceived, 0);
      const overdue = late.reduce((s, i) => s + i.amountDue - i.amountReceived, 0);
      const threshold = earningThreshold(b.agreementValue, b.mandate.earningTriggerBps);
      const crossesTrigger = b.status === "CONFIRMED" && received < threshold && received + overdue >= threshold;
      return {
        bookingId: b.id,
        code: b.code,
        customer: b.customer.name,
        unitNo: b.unit.unitNo,
        projectName: b.project.name,
        overdue,
        daysLate: daysBetween(late[0].dueDate, at),
        oldestInstallmentId: late[0].id,
        oldestLabel: late[0].label,
        triggerPct: formatBps(b.mandate.earningTriggerBps),
        crossesTrigger,
        unlocksFee: crossesTrigger ? b.commissions.filter((c) => c.kind === "DEVELOPER_FEE").reduce((s, c) => s + c.amount, 0) : 0,
        unlocksPayouts: crossesTrigger ? b.commissions.filter((c) => c.kind !== "DEVELOPER_FEE").reduce((s, c) => s + c.amount, 0) : 0,
        remindedToday: reminded.has(late[0].id),
      };
    })
    .sort((a, b) => Number(b.crossesTrigger) - Number(a.crossesTrigger) || b.daysLate - a.daysLate);
}

function remindAction(o: OverdueBooking): QueueAction | null {
  return o.remindedToday ? null : { kind: "remind", installmentId: o.oldestInstallmentId };
}

// ============================================================== MANAGEMENT

export type PendingApprovalRow = {
  id: string;
  code: string;
  status: "PENDING_MGMT_APPROVAL" | "PENDING_DEV_APPROVAL";
  unitNo: string;
  customer: string;
  execName: string;
  developerName: string;
  discountBps: number;
  discountAmount: number;
  mgmtMaxDiscountBps: number;
  bookedAt: Date;
  mgmtApprovedAt: Date | null;
};

export type ManagementInput = {
  mandates: Awaited<ReturnType<typeof getCommandCentre>>["mandates"];
  approvals: PendingApprovalRow[];
  overdue: OverdueBooking[];
  hotLeads: Record<string, number>;
  execBacklog: { id: string; name: string; overdue: number; hot: number }[];
  expiringAttribution: number;
  refunds: { id: string; code: string; customer: string; refundDue: number }[];
};

/** An exec with at least this many overdue follow-ups is flagged to their manager. */
export const BACKLOG_THRESHOLD = 5;

export function managementQueue(input: ManagementInput, at: Date, limit = 8): Queue {
  const items: QueueItem[] = [];

  for (const a of input.approvals) {
    if (a.status === "PENDING_MGMT_APPROVAL") {
      const band = a.discountBps > a.mgmtMaxDiscountBps ? "above your band: goes to the developer next" : "within your band";
      items.push({
        id: `approve-${a.id}`,
        severity: "high",
        title: `Discount ${formatBps(a.discountBps)} on ${a.unitNo} · ${a.customer}`,
        href: `/bookings/${a.id}`,
        why: `${formatINRCompact(a.discountAmount)} off list, ${band}. Requested by ${a.execName} ${relDays(a.bookedAt, at)}; the unit is locked meanwhile.`,
        rule: "A booking whose discount exceeds the sales exec's band waits for soleX management.",
        actions: [{ kind: "approve", bookingId: a.id, title: `${a.code} · ${a.unitNo}`, detail: `${formatBps(a.discountBps)} (${formatINRCompact(a.discountAmount)}) for ${a.customer}` }],
      });
    } else {
      items.push({
        id: `dev-${a.id}`,
        severity: "low",
        title: `${a.code} waiting on ${a.developerName}`,
        href: `/bookings/${a.id}`,
        why: `${formatBps(a.discountBps)} discount endorsed by soleX ${a.mgmtApprovedAt ? relDays(a.mgmtApprovedAt, at) : ""}; the developer has not decided yet.`,
        rule: "A discount above the mandate band also needs the developer's approval.",
        actions: [{ kind: "link", href: `/bookings/${a.id}`, label: "Open booking" }],
      });
    }
  }

  for (const m of input.mandates) {
    if (m.health === "ON_TRACK" && m.daysLeft >= 60) continue;
    const needed = Math.max(0, m.targetUnits - m.absorbed);
    if (needed === 0) continue;
    const weeksLeft = Math.max(1, m.daysLeft / 7);
    const hot = input.hotLeads[m.projectId] ?? 0;
    items.push({
      id: `pace-${m.projectId}`,
      severity: m.health === "AT_RISK" ? "high" : "medium",
      title: `${m.projectName}: ${needed} more bookings needed in ${m.daysLeft} days`,
      href: `/projects/${m.projectId}`,
      why: `That is ${(needed / weeksLeft).toFixed(1)} a week; pace today is ${m.absorbed} of the ${m.expectedByNow} expected by now. ${plural(hot, "lead")} at visit-done or negotiation.`,
      rule: "Absorption below 90% of the straight-line pace to target, or fewer than 60 days left on the mandate.",
      actions: [{ kind: "link", href: `/leads?tab=HOT&project=${m.projectId}`, label: hot > 0 ? "Review hot leads" : "Open pipeline" }],
    });
  }

  const blocking = input.overdue.filter((x) => x.crossesTrigger);
  const blockRule = "Overdue instalment on a confirmed booking where paying it would cross the mandate's earning trigger.";
  if (blocking.length >= 3) {
    // Several at once: one decision-level line, not a wall of near-identical rows.
    const worst = blocking[0];
    items.push({
      id: "fee-blocked",
      severity: "high",
      title: `${formatINRCompact(blocking.reduce((s, o) => s + o.unlocksFee, 0))} of soleX fee held up by ${blocking.length} late payments`,
      href: "/finance",
      why: `Each crosses its agreement trigger once paid. Longest wait: ${worst.code} (${worst.customer}), ${plural(worst.daysLate, "day")} late, ${formatINRCompact(worst.overdue)}.`,
      rule: blockRule,
      actions: [{ kind: "link", href: "/finance", label: "See and chase" }],
    });
  } else {
    for (const o of blocking) {
      const remind = remindAction(o);
      items.push({
        id: `fee-${o.bookingId}`,
        severity: "high",
        title: `${formatINRCompact(o.overdue)} overdue on ${o.code} is holding back ${formatINRCompact(o.unlocksFee)} of fee`,
        href: `/bookings/${o.bookingId}`,
        why: `${o.customer} is ${plural(o.daysLate, "day")} late. Collecting it crosses the ${o.triggerPct} agreement trigger, so the fee becomes billable.${o.remindedToday ? " Reminder already sent today." : ""}`,
        rule: blockRule,
        actions: [...(remind ? [remind] : []), { kind: "link", href: `/bookings/${o.bookingId}`, label: "Open booking" }],
      });
    }
  }
  const otherOverdue = input.overdue.filter((x) => !x.crossesTrigger);
  if (otherOverdue.length > 0) {
    items.push({
      id: "overdue-other",
      severity: "low",
      title: `${plural(otherOverdue.length, "other booking")} behind on payments`,
      href: "/finance",
      why: `${formatINRCompact(otherOverdue.reduce((s, o) => s + o.overdue, 0))} overdue in total; the oldest is ${plural(Math.max(...otherOverdue.map((o) => o.daysLate)), "day")} late. Finance is chasing these.`,
      rule: "Overdue instalments that do not affect when commission is earned.",
      actions: [{ kind: "link", href: "/finance", label: "Finance queue" }],
    });
  }

  for (const e of input.execBacklog.filter((x) => x.overdue >= BACKLOG_THRESHOLD)) {
    items.push({
      id: `backlog-${e.id}`,
      severity: e.hot > 0 ? "medium" : "low",
      title: `${e.name}: ${e.overdue} overdue follow-ups`,
      href: `/leads?tab=OVERDUE&owner=${e.id}`,
      why:
        e.hot > 0
          ? `${e.hot === 1 ? "One of them is" : `${e.hot} of them are`} close to booking. Reassign or check in before they go cold.`
          : "None are close to booking yet, but the backlog is growing.",
      rule: `A sales exec with ${BACKLOG_THRESHOLD} or more open leads past their follow-up date.`,
      actions: [{ kind: "link", href: `/leads?tab=OVERDUE&owner=${e.id}`, label: "Review & reassign" }],
    });
  }

  if (input.expiringAttribution > 0) {
    items.push({
      id: "attribution",
      severity: "medium",
      title: `${plural(input.expiringAttribution, "partner lead")} lose protection this week`,
      href: "/leads?tab=EXPIRING",
      why: "No site visit yet. If they book after protection lapses, expect a brokerage dispute with the partner.",
      rule: `Partner leads whose attribution ends within ${ATTRIBUTION_WARN_DAYS} days with no completed site visit.`,
      actions: [{ kind: "link", href: "/leads?tab=EXPIRING", label: "See leads" }],
    });
  }

  for (const r of input.refunds) {
    items.push({
      id: `refund-${r.id}`,
      severity: "medium",
      title: `Refund ${formatINRCompact(r.refundDue)} to ${r.customer}`,
      href: `/bookings/${r.id}`,
      why: `${r.code} was cancelled; the balance after forfeiture is owed back to the customer.`,
      rule: "A cancelled booking with a refund still due.",
      actions: [{ kind: "link", href: `/bookings/${r.id}`, label: "Open booking" }],
    });
  }

  return finish(items, limit);
}

export async function getManagementQueue(actor: Actor, mandates: ManagementInput["mandates"], limit = 8): Promise<Queue> {
  assertCan(actor, "command.view");
  const at = now();
  const [pending, overdue, hotRows, execs, expiringAttribution, refunds] = await Promise.all([
    db.booking.findMany({
      where: { status: { in: ["PENDING_MGMT_APPROVAL", "PENDING_DEV_APPROVAL"] } },
      orderBy: { bookedAt: "asc" },
      select: {
        id: true,
        code: true,
        status: true,
        discountBps: true,
        discountAmount: true,
        bookedAt: true,
        mgmtApprovedAt: true,
        unit: { select: { unitNo: true } },
        customer: { select: { name: true } },
        salesExec: { select: { name: true } },
        mandate: { select: { mgmtMaxDiscountBps: true } },
        project: { select: { developer: { select: { name: true } } } },
      },
    }),
    loadOverdueBookings(),
    db.lead.groupBy({ by: ["projectId"], where: { stage: { in: HOT_STAGES } }, _count: true }),
    db.user.findMany({
      where: { role: "SALES", active: true },
      select: {
        id: true,
        name: true,
        assignedLeads: { where: { stage: { notIn: CLOSED_STAGES }, nextFollowUpAt: { lt: at } }, select: { stage: true } },
      },
    }),
    db.lead.count({ where: expiringAttributionWhere(at) }),
    db.booking.findMany({ where: { status: "CANCELLED", refundDue: { gt: 0 } }, select: { id: true, code: true, refundDue: true, customer: { select: { name: true } } } }),
  ]);
  return managementQueue(
    {
      mandates,
      approvals: pending.map((b) => ({
        id: b.id,
        code: b.code,
        status: b.status as PendingApprovalRow["status"],
        unitNo: b.unit.unitNo,
        customer: b.customer.name,
        execName: b.salesExec.name,
        developerName: b.project.developer.name,
        discountBps: b.discountBps,
        discountAmount: b.discountAmount,
        mgmtMaxDiscountBps: b.mandate.mgmtMaxDiscountBps,
        bookedAt: b.bookedAt,
        mgmtApprovedAt: b.mgmtApprovedAt,
      })),
      overdue,
      hotLeads: Object.fromEntries(hotRows.map((r) => [r.projectId, r._count])),
      execBacklog: execs.map((e) => ({ id: e.id, name: e.name, overdue: e.assignedLeads.length, hot: e.assignedLeads.filter((l) => HOT_STAGES.includes(l.stage)).length })),
      expiringAttribution,
      refunds: refunds.map((r) => ({ id: r.id, code: r.code, customer: r.customer.name, refundDue: r.refundDue })),
    },
    at,
    limit,
  );
}

// ================================================================= FINANCE

export type LedgerTaskRow = {
  id: string;
  kind: CommissionKind;
  status: CommissionStatus;
  isAdjustment: boolean;
  amount: number;
  bookingId: string;
  bookingCode: string;
  party: string;
  since: Date | null;
};

export type FinanceInput = {
  overdue: OverdueBooking[];
  ledger: LedgerTaskRow[];
  awaitingApproval: { count: number; amount: number };
  refunds: { id: string; code: string; customer: string; refundDue: number }[];
  failedChecks: string[];
  /** Only offer the actions the viewer may take (management sees this queue too, but does not record receipts). */
  can: { recordPayment: boolean; remind: boolean; settle: boolean };
};

/** Money in before money out: invoice earned fee, chase invoiced fee, then pay approved payouts. */
const LEDGER_ORDER = (l: LedgerTaskRow) => (l.kind === "DEVELOPER_FEE" ? (l.status === "EARNED" ? 0 : 1) : 2);

export function financeQueue(input: FinanceInput, at: Date, limit = 10): Queue {
  const items: QueueItem[] = [];

  if (input.failedChecks.length > 0) {
    items.push({
      id: "integrity",
      severity: "high",
      title: `${plural(input.failedChecks.length, "integrity check")} failing`,
      href: "/activity",
      why: `${input.failedChecks.join(", ")}. Resolve before any money moves.`,
      rule: "The live integrity checker found records that disagree with each other.",
      actions: [{ kind: "link", href: "/activity", label: "See details" }],
    });
  }

  for (const o of input.overdue) {
    const remind = input.can.remind ? remindAction(o) : null;
    const actions: QueueAction[] = [];
    if (input.can.recordPayment) actions.push({ kind: "recordPayment", bookingId: o.bookingId, amount: o.overdue });
    if (remind) actions.push(remind);
    if (actions.length === 0) actions.push({ kind: "link", href: `/bookings/${o.bookingId}`, label: "Open booking" });
    items.push({
      id: `collect-${o.bookingId}`,
      severity: o.crossesTrigger || o.daysLate > 30 ? "high" : "medium",
      title: `Collect ${formatINRCompact(o.overdue)} · ${o.customer}`,
      href: `/bookings/${o.bookingId}`,
      why: `${o.code} · ${o.oldestLabel} · ${plural(o.daysLate, "day")} late.${o.crossesTrigger ? ` Paying it crosses the ${o.triggerPct} trigger: unlocks ${formatINRCompact(o.unlocksFee)} fee and ${formatINRCompact(o.unlocksPayouts)} payouts.` : ""}${o.remindedToday ? " Reminded today." : ""}`,
      rule: o.crossesTrigger ? "Overdue instalment where collection would cross the mandate's earning trigger." : "Instalment past its due date on a live booking.",
      actions,
    });
  }

  for (const l of input.can.settle ? [...input.ledger].sort((a, b) => LEDGER_ORDER(a) - LEDGER_ORDER(b)) : []) {
    const line = { id: l.id, kind: l.kind, status: l.status, isAdjustment: l.isAdjustment };
    const age = l.since ? relDays(l.since, at) : "";
    if (l.kind === "DEVELOPER_FEE" && l.status === "EARNED") {
      items.push({
        id: `invoice-${l.id}`,
        severity: "medium",
        title: l.isAdjustment ? `Credit note ${formatINRCompact(-l.amount)} to ${l.party}` : `Invoice ${l.party} ${formatINRCompact(l.amount)}`,
        href: `/bookings/${l.bookingId}`,
        why: l.isAdjustment ? `${l.bookingCode} was cancelled after the fee was earned.` : `${l.bookingCode} reached agreement stage ${age}; the soleX fee is now billable.`,
        rule: "soleX fee earned (collection trigger met) but not yet invoiced to the developer.",
        actions: [{ kind: "settle", line }],
      });
    } else if (l.kind === "DEVELOPER_FEE" && l.status === "INVOICED") {
      const days = l.since ? daysBetween(l.since, at) : 0;
      items.push({
        id: `receive-${l.id}`,
        severity: days > 30 ? "medium" : "low",
        title: `${l.party} owes ${formatINRCompact(l.amount)}`,
        href: `/bookings/${l.bookingId}`,
        why: `Invoiced for ${l.bookingCode} ${age}. Mark received when the money lands.`,
        rule: "soleX fee invoiced to the developer and not yet received.",
        actions: [{ kind: "settle", line }],
      });
    } else if (l.status === "APPROVED") {
      items.push({
        id: `pay-${l.id}`,
        severity: "medium",
        title: l.isAdjustment ? `Recover ${formatINRCompact(-l.amount)} from ${l.party}` : `Pay ${l.party} ${formatINRCompact(l.amount)}`,
        href: `/bookings/${l.bookingId}`,
        why: `${l.kind === "BROKER_PAYOUT" ? "Brokerage" : "Incentive"} for ${l.bookingCode}, approved by management ${age}.`,
        rule: "Payout approved by management and waiting for payment.",
        actions: [{ kind: "settle", line }],
      });
    }
  }

  if (input.awaitingApproval.count > 0) {
    items.push({
      id: "awaiting-approval",
      severity: "low",
      title: `${formatINRCompact(input.awaitingApproval.amount)} in payouts awaiting management`,
      href: "/finance?tab=commissions&status=EARNED",
      why: `${plural(input.awaitingApproval.count, "line")} earned and ready, but approval is a management duty. Nothing for you to do yet.`,
      rule: "Approval and payment are separate duties: management approves, finance pays.",
      actions: [{ kind: "link", href: "/finance?tab=commissions&status=EARNED", label: "View lines" }],
    });
  }

  for (const r of input.refunds) {
    items.push({
      id: `refund-${r.id}`,
      severity: "medium",
      title: `Refund ${formatINRCompact(r.refundDue)} to ${r.customer}`,
      href: `/bookings/${r.id}`,
      why: `${r.code} was cancelled; this is the balance after forfeiture.`,
      rule: "A cancelled booking with a refund still due.",
      actions: [{ kind: "link", href: `/bookings/${r.id}`, label: "Open booking" }],
    });
  }

  return finish(items, limit);
}

export async function getFinanceQueue(actor: Actor, limit = 10): Promise<Queue> {
  assertCan(actor, "finance.view");
  const at = now();
  const [overdue, ledger, awaiting, refunds, checks] = await Promise.all([
    loadOverdueBookings(),
    db.commission.findMany({
      where: {
        OR: [
          { kind: "DEVELOPER_FEE", status: { in: ["EARNED", "INVOICED"] } },
          { kind: { in: ["BROKER_PAYOUT", "EMPLOYEE_INCENTIVE"] }, status: "APPROVED" },
        ],
      },
      orderBy: [{ earnedAt: "asc" }],
      select: {
        id: true,
        kind: true,
        status: true,
        isAdjustment: true,
        amount: true,
        earnedAt: true,
        invoicedAt: true,
        approvedAt: true,
        booking: { select: { id: true, code: true } },
        project: { select: { developer: { select: { name: true } } } },
        broker: { select: { firmName: true } },
        user: { select: { name: true } },
      },
    }),
    db.commission.aggregate({ where: { kind: { in: ["BROKER_PAYOUT", "EMPLOYEE_INCENTIVE"] }, status: "EARNED", isAdjustment: false }, _sum: { amount: true }, _count: true }),
    db.booking.findMany({ where: { status: "CANCELLED", refundDue: { gt: 0 } }, select: { id: true, code: true, refundDue: true, customer: { select: { name: true } } } }),
    runIntegrityChecks(),
  ]);
  return financeQueue(
    {
      overdue,
      ledger: ledger.map((l) => ({
        id: l.id,
        kind: l.kind,
        status: l.status,
        isAdjustment: l.isAdjustment,
        amount: l.amount,
        bookingId: l.booking.id,
        bookingCode: l.booking.code,
        party: l.kind === "DEVELOPER_FEE" ? l.project.developer.name : (l.broker?.firmName ?? l.user?.name ?? "—"),
        since: l.status === "INVOICED" ? l.invoicedAt : l.status === "APPROVED" ? l.approvedAt : l.earnedAt,
      })),
      awaitingApproval: { count: awaiting._count, amount: awaiting._sum.amount ?? 0 },
      refunds: refunds.map((r) => ({ id: r.id, code: r.code, customer: r.customer.name, refundDue: r.refundDue })),
      failedChecks: checks.filter((c) => !c.ok).map((c) => c.label),
      can: { recordPayment: can(actor, "payment.record"), remind: can(actor, "payment.remind"), settle: can(actor, "commission.settle") },
    },
    at,
    limit,
  );
}

