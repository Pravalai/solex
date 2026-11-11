import type { Lead } from "@/generated/prisma/client";
import type { LeadSource, LeadStage } from "@/generated/prisma/enums";
import { db, withTx, type Tx } from "@/lib/db";
import { addDays, now } from "@/lib/clock";
import { DomainError, NotFoundError } from "@/lib/errors";
import { normalizePhone, isValidIndianMobile } from "@/lib/phone";
import { assertTransition, canTransition, type Machine } from "@/lib/state";
import type { Actor } from "@/modules/identity/actor";
import { assertCan } from "@/modules/identity/permissions";
import { leadScope, projectScope } from "@/modules/identity/scope";
import { notify, recordEvent } from "@/modules/audit/audit";

export const LEAD_MACHINE: Machine<LeadStage> = {
  NEW: ["CONTACTED", "QUALIFIED", "FOLLOW_UP", "VISIT_PLANNED", "LOST", "INVALID"],
  CONTACTED: ["QUALIFIED", "FOLLOW_UP", "VISIT_PLANNED", "NEGOTIATION", "LOST", "INVALID"],
  QUALIFIED: ["FOLLOW_UP", "VISIT_PLANNED", "NEGOTIATION", "BOOKING_INITIATED", "BOOKED", "LOST"],
  FOLLOW_UP: ["CONTACTED", "QUALIFIED", "VISIT_PLANNED", "NEGOTIATION", "BOOKING_INITIATED", "BOOKED", "LOST"],
  VISIT_PLANNED: ["VISIT_PLANNED", "VISIT_DONE", "FOLLOW_UP", "LOST"],
  VISIT_DONE: ["FOLLOW_UP", "NEGOTIATION", "VISIT_PLANNED", "BOOKING_INITIATED", "BOOKED", "LOST"],
  NEGOTIATION: ["FOLLOW_UP", "VISIT_PLANNED", "BOOKING_INITIATED", "BOOKED", "LOST"],
  BOOKING_INITIATED: ["BOOKED", "NEGOTIATION", "LOST"],
  // A booked lead only moves again if its booking is cancelled.
  BOOKED: ["LOST"],
  // Reactivation.
  LOST: ["FOLLOW_UP"],
  INVALID: [],
};

/** Stages a user may set by hand; the rest are driven by visits and bookings. */
export const MANUAL_STAGES: LeadStage[] = ["CONTACTED", "QUALIFIED", "FOLLOW_UP", "NEGOTIATION", "LOST", "INVALID"];
export const BOOKABLE_STAGES: LeadStage[] = ["QUALIFIED", "FOLLOW_UP", "VISIT_DONE", "NEGOTIATION"];
export const CLOSED_STAGES: LeadStage[] = ["BOOKED", "LOST", "INVALID"];

export class DuplicateLeadError extends DomainError {
  /** Only populated for internal users; brokers must not learn who holds the lead. */
  readonly existingLeadId: string | null;
  constructor(message: string, existingLeadId: string | null) {
    super("DUPLICATE_LEAD", message);
    this.name = "DuplicateLeadError";
    this.existingLeadId = existingLeadId;
  }
}

export type CreateLeadInput = {
  projectId: string;
  name: string;
  phone: string;
  email?: string | null;
  budgetMin?: number | null;
  budgetMax?: number | null;
  configPref?: string | null;
  source?: LeadSource;
  campaign?: string | null;
  note?: string | null;
};

export async function getScopedLead(actor: Actor, leadId: string, client: Tx = db) {
  const lead = await client.lead.findFirst({
    where: { AND: [{ id: leadId }, leadScope(actor)] },
    include: { project: { include: { mandates: { where: { status: "ACTIVE" } } } } },
  });
  if (!lead) throw new NotFoundError("Lead");
  return lead;
}

async function activeMandateFor(tx: Tx, projectId: string) {
  const mandate = await tx.mandate.findFirst({ where: { projectId, status: "ACTIVE" } });
  if (!mandate) throw new DomainError("NO_MANDATE", "This project has no active soleX mandate.");
  return mandate;
}

/** Load-balanced assignment: the allocated sales exec with the fewest open leads on the project. */
async function pickAssignee(tx: Tx, projectId: string): Promise<string | null> {
  const execs = await tx.user.findMany({
    where: { role: "SALES", active: true, allocations: { some: { projectId } } },
    orderBy: { name: "asc" },
    select: {
      id: true,
      _count: { select: { assignedLeads: { where: { projectId, stage: { notIn: CLOSED_STAGES } } } } },
    },
  });
  if (execs.length === 0) return null;
  execs.sort((a, b) => a._count.assignedLeads - b._count.assignedLeads);
  return execs[0].id;
}

/**
 * Captures a lead from any channel. Within the mandate's attribution window a
 * phone number can only be claimed once per project, which protects both the
 * broker who introduced the customer and soleX's own marketing spend.
 */
export async function createLead(actor: Actor, input: CreateLeadInput): Promise<Lead> {
  const isBroker = actor.role === "BROKER";
  assertCan(actor, isBroker ? "lead.register" : "lead.create");

  const name = input.name.trim();
  if (name.length < 2) throw new DomainError("VALIDATION", "Enter the customer's name.");
  if (!isValidIndianMobile(input.phone)) throw new DomainError("VALIDATION", "Enter a valid 10-digit mobile number.");
  const phoneNormalized = normalizePhone(input.phone);
  const source: LeadSource = isBroker ? "BROKER" : (input.source ?? "DIRECT");
  if (!isBroker && source === "BROKER") {
    throw new DomainError("VALIDATION", "Broker leads must be registered by the broker through the partner portal.");
  }

  return withTx(async (tx) => {
    const project = await tx.project.findFirst({ where: { AND: [{ id: input.projectId }, projectScope(actor)] } });
    if (!project) throw new NotFoundError("Project");
    const mandate = await activeMandateFor(tx, project.id);
    const at = now();

    const existing = await tx.lead.findFirst({
      where: {
        projectId: project.id,
        phoneNormalized,
        OR: [{ stage: "BOOKED" }, { stage: { notIn: ["LOST", "INVALID"] }, attributionExpiresAt: { gt: at } }],
      },
      include: { assignedTo: { select: { name: true } } },
    });
    if (existing) {
      if (isBroker) {
        throw new DuplicateLeadError(
          "This customer is already registered for this project, so attribution cannot be granted. Contact your soleX channel manager if you believe this is wrong.",
          null,
        );
      }
      throw new DuplicateLeadError(
        `Duplicate: this customer is already lead ${existing.code}${existing.assignedTo ? ` (owned by ${existing.assignedTo.name})` : ""}.`,
        existing.id,
      );
    }

    const assignedToId = actor.role === "SALES" ? actor.userId : await pickAssignee(tx, project.id);
    const seq = (await tx.lead.count({ where: { projectId: project.id } })) + 1;
    const lead = await tx.lead.create({
      data: {
        code: `${project.code}-L${String(seq).padStart(4, "0")}`,
        projectId: project.id,
        name,
        phone: input.phone.trim(),
        phoneNormalized,
        email: input.email?.trim() || null,
        budgetMin: input.budgetMin ?? null,
        budgetMax: input.budgetMax ?? null,
        configPref: input.configPref ?? null,
        source,
        campaign: input.campaign?.trim() || null,
        brokerId: isBroker ? actor.brokerId : null,
        attributionExpiresAt: addDays(at, mandate.attributionWindowDays),
        assignedToId,
        stage: "NEW",
        nextFollowUpAt: addDays(at, 1),
        createdAt: at,
        updatedAt: at,
      },
      include: { assignedTo: true, broker: true },
    });
    await tx.leadActivity.create({
      data: {
        leadId: lead.id,
        userId: actor.userId,
        type: "CREATED",
        note: input.note?.trim() || `Lead captured via ${source.toLowerCase().replace("_", " ")}`,
        at,
      },
    });
    await recordEvent(tx, actor, {
      type: "LEAD_CREATED",
      entityType: "Lead",
      entityId: lead.id,
      projectId: project.id,
      summary: `${lead.code} ${lead.name} captured (${source})${lead.broker ? ` by ${lead.broker.firmName}` : ""}, assigned to ${lead.assignedTo?.name ?? "nobody"}`,
      data: { source, brokerId: lead.brokerId, assignedToId, attributionExpiresAt: lead.attributionExpiresAt },
    });
    if (lead.assignedTo) {
      await notify(tx, {
        channel: "WHATSAPP",
        recipient: lead.assignedTo.name,
        body: `New lead ${lead.code} assigned to you: ${lead.name}, ${project.name}. First call due within 24h.`,
        entityType: "Lead",
        entityId: lead.id,
      });
    }
    return lead;
  });
}

async function setStage(tx: Tx, actor: Actor, lead: Lead, to: LeadStage, extra: { lostReason?: string } = {}) {
  if (lead.stage === to) return lead;
  assertTransition(LEAD_MACHINE, "Lead", lead.stage, to);
  const at = now();
  const updated = await tx.lead.update({
    where: { id: lead.id },
    data: { stage: to, updatedAt: at, lostReason: to === "LOST" ? (extra.lostReason ?? null) : null },
  });
  await tx.leadActivity.create({
    data: { leadId: lead.id, userId: actor.userId, type: "STAGE_CHANGE", note: `${lead.stage} → ${to}`, at },
  });
  await recordEvent(tx, actor, {
    type: "LEAD_STAGE_CHANGED",
    entityType: "Lead",
    entityId: lead.id,
    projectId: lead.projectId,
    summary: `${lead.code} moved ${lead.stage} → ${to}`,
    data: { from: lead.stage, to, lostReason: extra.lostReason },
  });
  return updated;
}

/** Used by other modules (visits, bookings) inside their own transaction. */
export async function moveLeadStage(
  tx: Tx,
  actor: Actor,
  leadId: string,
  to: LeadStage,
  opts: { onlyIfAllowed?: boolean; lostReason?: string } = {},
) {
  const lead = await tx.lead.findUniqueOrThrow({ where: { id: leadId } });
  if (opts.onlyIfAllowed && !canTransition(LEAD_MACHINE, lead.stage, to)) return lead;
  return setStage(tx, actor, lead, to, { lostReason: opts.lostReason });
}

export async function changeLeadStage(actor: Actor, leadId: string, to: LeadStage, reason?: string) {
  assertCan(actor, "lead.update");
  if (!MANUAL_STAGES.includes(to)) {
    throw new DomainError("VALIDATION", "That stage is set automatically by site visits and bookings.");
  }
  if (to === "LOST" && !reason?.trim()) throw new DomainError("VALIDATION", "Give a reason for marking the lead lost.");
  return withTx(async (tx) => {
    const lead = await getScopedLead(actor, leadId, tx);
    return setStage(tx, actor, lead, to, { lostReason: reason?.trim() });
  });
}

export const ACTIVITY_TYPES = ["CALL", "WHATSAPP", "EMAIL", "MEETING", "NOTE"] as const;
export type ActivityType = (typeof ACTIVITY_TYPES)[number];

export async function logActivity(
  actor: Actor,
  leadId: string,
  input: { type: ActivityType; note: string; nextFollowUpAt?: Date | null },
) {
  assertCan(actor, "lead.update");
  if (!input.note.trim()) throw new DomainError("VALIDATION", "Add a short note about the interaction.");
  return withTx(async (tx) => {
    const lead = await getScopedLead(actor, leadId, tx);
    const at = now();
    const isContact = input.type !== "NOTE";
    await tx.leadActivity.create({
      data: { leadId: lead.id, userId: actor.userId, type: input.type, note: input.note.trim(), at },
    });
    await tx.lead.update({
      where: { id: lead.id },
      data: {
        updatedAt: at,
        ...(isContact ? { lastContactAt: at } : {}),
        ...(input.nextFollowUpAt !== undefined ? { nextFollowUpAt: input.nextFollowUpAt } : {}),
      },
    });
    if (isContact && lead.stage === "NEW") await setStage(tx, actor, lead, "CONTACTED");
    await recordEvent(tx, actor, {
      type: "LEAD_ACTIVITY",
      entityType: "Lead",
      entityId: lead.id,
      projectId: lead.projectId,
      summary: `${input.type.toLowerCase()} logged on ${lead.code}`,
    });
  });
}

export async function reassignLead(actor: Actor, leadId: string, toUserId: string) {
  assertCan(actor, "lead.reassign");
  return withTx(async (tx) => {
    const lead = await getScopedLead(actor, leadId, tx);
    const target = await tx.user.findFirst({
      where: { id: toUserId, role: "SALES", active: true, allocations: { some: { projectId: lead.projectId } } },
    });
    if (!target) throw new DomainError("VALIDATION", "Leads can only go to a sales exec allocated to this project.");
    if (lead.assignedToId === target.id) return lead;
    const at = now();
    const updated = await tx.lead.update({ where: { id: lead.id }, data: { assignedToId: target.id, updatedAt: at } });
    await tx.leadActivity.create({
      data: { leadId: lead.id, userId: actor.userId, type: "ASSIGNMENT", note: `Reassigned to ${target.name}`, at },
    });
    await recordEvent(tx, actor, {
      type: "LEAD_REASSIGNED",
      entityType: "Lead",
      entityId: lead.id,
      projectId: lead.projectId,
      summary: `${lead.code} reassigned to ${target.name}`,
      data: { from: lead.assignedToId, to: target.id },
    });
    await notify(tx, {
      channel: "WHATSAPP",
      recipient: target.name,
      body: `Lead ${lead.code} (${lead.name}) has been reassigned to you.`,
      entityType: "Lead",
      entityId: lead.id,
    });
    return updated;
  });
}

export async function scheduleVisit(actor: Actor, leadId: string, input: { scheduledAt: Date; note?: string }) {
  assertCan(actor, "visit.manage");
  return withTx(async (tx) => {
    const lead = await getScopedLead(actor, leadId, tx);
    if (CLOSED_STAGES.includes(lead.stage)) throw new DomainError("VALIDATION", "This lead is closed.");
    const at = now();
    if (input.scheduledAt.getTime() < at.getTime() - 60 * 60_000) {
      throw new DomainError("VALIDATION", "A site visit cannot be scheduled in the past.");
    }
    const visit = await tx.siteVisit.create({
      data: {
        leadId: lead.id,
        projectId: lead.projectId,
        scheduledAt: input.scheduledAt,
        assignedToId: lead.assignedToId ?? actor.userId,
        brokerId: lead.brokerId,
        createdAt: at,
      },
    });
    await tx.lead.update({ where: { id: lead.id }, data: { nextFollowUpAt: input.scheduledAt, updatedAt: at } });
    await tx.leadActivity.create({
      data: {
        leadId: lead.id,
        userId: actor.userId,
        type: "VISIT_SCHEDULED",
        note: input.note?.trim() || "Site visit scheduled",
        at,
      },
    });
    await moveLeadStage(tx, actor, lead.id, "VISIT_PLANNED", { onlyIfAllowed: true });
    await recordEvent(tx, actor, {
      type: "VISIT_SCHEDULED",
      entityType: "SiteVisit",
      entityId: visit.id,
      projectId: lead.projectId,
      summary: `Site visit for ${lead.code} on ${input.scheduledAt.toDateString()}`,
    });
    await notify(tx, {
      channel: "WHATSAPP",
      recipient: `${lead.name} (customer)`,
      body: `Your visit to ${lead.project.name} is confirmed for ${input.scheduledAt.toLocaleString("en-IN")}. Reply to reschedule.`,
      entityType: "SiteVisit",
      entityId: visit.id,
    });
    return visit;
  });
}

async function getScopedVisit(actor: Actor, visitId: string, tx: Tx) {
  const visit = await tx.siteVisit.findFirst({ where: { id: visitId, lead: leadScope(actor) }, include: { lead: true } });
  if (!visit) throw new NotFoundError("Site visit");
  return visit;
}

export async function completeVisit(
  actor: Actor,
  visitId: string,
  input: { feedback: string; rating: number; nextFollowUpAt?: Date | null },
) {
  assertCan(actor, "visit.manage");
  if (!input.feedback.trim()) throw new DomainError("VALIDATION", "Record the customer's feedback.");
  if (input.rating < 1 || input.rating > 5) throw new DomainError("VALIDATION", "Interest rating must be 1 to 5.");
  return withTx(async (tx) => {
    const visit = await getScopedVisit(actor, visitId, tx);
    if (visit.status !== "SCHEDULED") throw new DomainError("VALIDATION", "This visit is already closed.");
    const at = now();
    await tx.siteVisit.update({
      where: { id: visit.id },
      data: { status: "COMPLETED", feedback: input.feedback.trim(), rating: input.rating, completedAt: at },
    });
    await tx.lead.update({
      where: { id: visit.leadId },
      data: { lastContactAt: at, updatedAt: at, nextFollowUpAt: input.nextFollowUpAt ?? addDays(at, 2) },
    });
    await tx.leadActivity.create({
      data: {
        leadId: visit.leadId,
        userId: actor.userId,
        type: "VISIT_COMPLETED",
        note: `Visit completed (interest ${input.rating}/5): ${input.feedback.trim()}`,
        at,
      },
    });
    await moveLeadStage(tx, actor, visit.leadId, "VISIT_DONE", { onlyIfAllowed: true });
    await recordEvent(tx, actor, {
      type: "VISIT_COMPLETED",
      entityType: "SiteVisit",
      entityId: visit.id,
      projectId: visit.projectId,
      summary: `Site visit completed for ${visit.lead.code} (interest ${input.rating}/5)`,
    });
  });
}

export async function markNoShow(actor: Actor, visitId: string) {
  assertCan(actor, "visit.manage");
  return withTx(async (tx) => {
    const visit = await getScopedVisit(actor, visitId, tx);
    if (visit.status !== "SCHEDULED") throw new DomainError("VALIDATION", "This visit is already closed.");
    const at = now();
    await tx.siteVisit.update({ where: { id: visit.id }, data: { status: "NO_SHOW", completedAt: at } });
    await tx.leadActivity.create({
      data: { leadId: visit.leadId, userId: actor.userId, type: "VISIT_NO_SHOW", note: "Customer did not turn up", at },
    });
    await moveLeadStage(tx, actor, visit.leadId, "FOLLOW_UP", { onlyIfAllowed: true });
    await recordEvent(tx, actor, {
      type: "VISIT_NO_SHOW",
      entityType: "SiteVisit",
      entityId: visit.id,
      projectId: visit.projectId,
      summary: `No-show for ${visit.lead.code}`,
    });
  });
}
