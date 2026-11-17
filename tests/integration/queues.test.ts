import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { addDays, now, setClock } from "@/lib/clock";
import { ConflictError, DomainError, ForbiddenError, NotFoundError } from "@/lib/errors";
import type { Actor } from "@/modules/identity/actor";
import { changeLeadStage, confirmVisit, createLead, logActivity, requestVisit, sendLeadMessage } from "@/modules/crm/leads";
import { endCall, startCall } from "@/modules/calls/calls";
import { createBooking } from "@/modules/sales/bookings";
import { sendPaymentReminder } from "@/modules/finance/payments";
import { getFinanceQueue, getSalesQueue } from "@/modules/reporting/queue";
import { getBrokerUpdates, listBrokerLeads } from "@/modules/reporting/portals";
import { runIntegrityChecks } from "@/modules/reporting/integrity";
import { buildWorld, freshUnit, nextPhone, type World } from "../fixtures";

let w: World;

beforeAll(async () => {
  w = await buildWorld();
});

afterEach(async () => {
  setClock(null);
  const failed = (await runIntegrityChecks()).filter((c) => !c.ok);
  expect(failed, JSON.stringify(failed, null, 2)).toEqual([]);
});

function newLead(via: Actor = w.actors.sales1, projectId = w.p1.project.id) {
  return createLead(via, { projectId, name: "Ritu Malhotra", phone: nextPhone(), configPref: "3BHK", budgetMax: 2_00_00_000, ...(via.role === "BROKER" ? {} : { source: "WEBSITE" as const }) });
}

async function confirmedBooking(unitIndex: number, bookedDaysAgo = 0) {
  setClock(addDays(now(), -bookedDaysAgo));
  const lead = await newLead();
  await logActivity(w.actors.sales1, lead.id, { type: "CALL", note: "Interested" });
  await changeLeadStage(w.actors.sales1, lead.id, "QUALIFIED");
  const unit = await freshUnit(w.p1Units[unitIndex].id);
  const booking = await createBooking(w.actors.sales1, { unitId: unit.id, leadId: lead.id, discountAmount: 0, expectedVersion: unit.version });
  setClock(null);
  return booking;
}

describe("WhatsApp follow-up from the lead", () => {
  it("lands in the outbox and on the timeline, and counts as a contact", async () => {
    const lead = await newLead();
    await sendLeadMessage(w.actors.sales1, lead.id, { body: "Hi Ritu, sharing the payment-plan options as promised." });
    const [outbox, activity, after] = await Promise.all([
      db.notification.findFirst({ where: { entityType: "Lead", entityId: lead.id, channel: "WHATSAPP", body: { contains: "payment-plan" } } }),
      db.leadActivity.findFirst({ where: { leadId: lead.id, type: "WHATSAPP" } }),
      db.lead.findUniqueOrThrow({ where: { id: lead.id } }),
    ]);
    expect(outbox?.status).toBe("SIMULATED");
    expect(activity?.note).toContain("payment-plan");
    expect(after.stage).toBe("CONTACTED");
    expect(after.lastContactAt).not.toBeNull();
  });

  it("is limited to the lead's own exec and to internal users", async () => {
    const lead = await newLead();
    await expect(sendLeadMessage(w.actors.sales2, lead.id, { body: "Hello from another exec" })).rejects.toBeInstanceOf(NotFoundError);
    await expect(sendLeadMessage(w.actors.brokerA, lead.id, { body: "Hello from a partner" })).rejects.toBeInstanceOf(ForbiddenError);
    await expect(sendLeadMessage(w.actors.sales1, lead.id, { body: "hi" })).rejects.toBeInstanceOf(DomainError);
  });
});

describe("call next action", () => {
  it("is stored on the call and offered until it is done", async () => {
    const lead = await newLead();
    const session = await startCall(w.actors.sales1, lead.id);
    const outcome = await endCall(w.actors.sales1, session.id, { talkSec: session.durationSec });
    expect(outcome.nextAction).not.toBeNull();
    const stored = await db.call.findUniqueOrThrow({ where: { id: session.id } });
    expect(stored.nextAction).toMatch(/^(SCHEDULE_VISIT|SEND_INFO(:\w+)?|CALL_BACK|NURTURE|RETRY)$/);
    if (outcome.nextAction?.kind === "SEND_INFO" || outcome.nextAction?.kind === "NURTURE") {
      expect(outcome.draft).toContain("Ritu");
    } else {
      expect(outcome.draft).toBeNull();
    }
  });
});

describe("partner visit request", () => {
  it("goes from the partner to the exec's task list, and is confirmed into a scheduled visit", async () => {
    const lead = await newLead(w.actors.brokerA);
    const preferredAt = addDays(now(), 3);
    const visit = await requestVisit(w.actors.brokerA, lead.id, { preferredAt });
    expect(visit.status).toBe("REQUESTED");

    // Another partner cannot see it; a second request is refused while one is pending.
    await expect(requestVisit(w.actors.brokerB, lead.id, { preferredAt })).rejects.toBeInstanceOf(NotFoundError);
    await expect(requestVisit(w.actors.brokerA, lead.id, { preferredAt })).rejects.toBeInstanceOf(DomainError);
    await expect(requestVisit(w.actors.sales1, lead.id, { preferredAt })).rejects.toBeInstanceOf(ForbiddenError);

    const owner = await db.lead.findUniqueOrThrow({ where: { id: lead.id }, select: { assignedToId: true } });
    expect(owner.assignedToId).toBe(w.actors.sales1.userId);
    const queue = await getSalesQueue(w.actors.sales1, 100);
    const item = queue.items.find((i) => i.id === `visit-request-${lead.id}`);
    expect(item?.actions[0]).toMatchObject({ kind: "confirmVisit", visitId: visit.id });

    const slot = addDays(now(), 4);
    await confirmVisit(w.actors.sales1, visit.id, { scheduledAt: slot });
    const [confirmed, after] = await Promise.all([db.siteVisit.findUniqueOrThrow({ where: { id: visit.id } }), db.lead.findUniqueOrThrow({ where: { id: lead.id } })]);
    expect(confirmed.status).toBe("SCHEDULED");
    expect(confirmed.scheduledAt.getTime()).toBe(slot.getTime());
    expect(after.stage).toBe("VISIT_PLANNED");
    await expect(confirmVisit(w.actors.sales1, visit.id, { scheduledAt: slot })).rejects.toBeInstanceOf(DomainError);

    // The partner sees the milestone, never the internal notes.
    const feed = await getBrokerUpdates(w.actors.brokerA);
    expect(feed.updates.some((u) => u.text === "Site visit scheduled" && u.who.startsWith("Ritu Malhotra"))).toBe(true);
    expect((await listBrokerLeads(w.actors.brokerA)).find((l) => l.id === lead.id)?.canRequestVisit).toBe(false);
  });

  it("allows only one exec to confirm a request", async () => {
    const lead = await newLead(w.actors.brokerA);
    const visit = await requestVisit(w.actors.brokerA, lead.id, { preferredAt: addDays(now(), 2) });
    const results = await Promise.allSettled([
      confirmVisit(w.actors.sales1, visit.id, { scheduledAt: addDays(now(), 2) }),
      confirmVisit(w.actors.mgmt, visit.id, { scheduledAt: addDays(now(), 3) }),
    ]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    const reason = (results.find((r) => r.status === "rejected") as PromiseRejectedResult).reason;
    expect(reason instanceof ConflictError || reason instanceof DomainError).toBe(true);
  });

  it("keeps partner updates to the partner's own customers", async () => {
    await newLead(w.actors.brokerA);
    const feedB = await getBrokerUpdates(w.actors.brokerB);
    const ownB = new Set((await listBrokerLeads(w.actors.brokerB)).map((l) => l.name));
    for (const u of feedB.updates) expect(ownB.has(u.who.split(" · ")[0]) || u.text.startsWith("Brokerage")).toBe(true);
    await expect(getBrokerUpdates(w.actors.sales1)).rejects.toBeInstanceOf(NotFoundError);
  });
});

describe("payment reminders and the finance queue", () => {
  it("sends one reminder per instalment per day, to finance and management only", async () => {
    const booking = await confirmedBooking(0);
    const inst = await db.installment.findFirstOrThrow({ where: { bookingId: booking.id }, orderBy: { seq: "asc" } });
    await expect(sendPaymentReminder(w.actors.sales1, inst.id)).rejects.toBeInstanceOf(ForbiddenError);
    await sendPaymentReminder(w.actors.finance, inst.id);
    await expect(sendPaymentReminder(w.actors.mgmt, inst.id)).rejects.toMatchObject({ code: "ALREADY_REMINDED" });
    expect(await db.notification.count({ where: { entityId: booking.id, body: { contains: "gentle reminder" } } })).toBe(1);
    expect(await db.auditEvent.count({ where: { type: "PAYMENT_REMINDER_SENT", entityId: inst.id } })).toBe(1);
  });

  it("shows an overdue booking with the fee its collection would unlock", async () => {
    const booking = await confirmedBooking(1, 40);
    const queue = await getFinanceQueue(w.actors.finance, 100);
    const item = queue.items.find((i) => i.id === `collect-${booking.id}`);
    expect(item).toBeDefined();
    expect(item!.why).toMatch(/crosses the 20% trigger: unlocks ₹[\d.]+ L fee/);
    expect(item!.actions.map((a) => a.kind)).toEqual(["recordPayment", "remind"]);

    // Management sees the same queue but cannot record receipts.
    const mgmtQueue = await getFinanceQueue(w.actors.mgmt, 100);
    expect(mgmtQueue.items.find((i) => i.id === `collect-${booking.id}`)!.actions.map((a) => a.kind)).toEqual(["remind"]);
    await expect(getFinanceQueue(w.actors.sales1)).rejects.toBeInstanceOf(ForbiddenError);
  });
});
