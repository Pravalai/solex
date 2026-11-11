import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { addDays, addMinutes, now, setClock } from "@/lib/clock";
import { ConflictError, DomainError } from "@/lib/errors";
import { applyBps } from "@/lib/money";
import type { Actor } from "@/modules/identity/actor";
import { changeLeadStage, completeVisit, createLead, logActivity, scheduleVisit } from "@/modules/crm/leads";
import { holdUnit, releaseHold } from "@/modules/inventory/units";
import { approveBooking, cancelBooking, createBooking, rejectBooking } from "@/modules/sales/bookings";
import { recordPayment } from "@/modules/finance/payments";
import { settleCommission } from "@/modules/finance/commissions";
import { runIntegrityChecks } from "@/modules/reporting/integrity";
import { buildWorld, freshUnit, nextPhone, type World } from "../fixtures";

let w: World;

beforeAll(async () => {
  w = await buildWorld();
});

afterEach(async () => {
  setClock(null);
  const checks = await runIntegrityChecks();
  const failed = checks.filter((c) => !c.ok);
  expect(failed, JSON.stringify(failed, null, 2)).toEqual([]);
});

/** Creates a lead (optionally via a broker) and moves it to a bookable stage. */
async function qualifiedLead(projectId = w.p1.project.id, via: Actor = w.actors.sales1) {
  const lead = await createLead(via, { projectId, name: "Test Buyer", phone: nextPhone(), source: via.role === "BROKER" ? undefined : "WEBSITE" });
  const owner = via.role === "BROKER" ? w.actors.mgmt : via;
  await logActivity(owner, lead.id, { type: "CALL", note: "Interested" });
  await changeLeadStage(owner, lead.id, "QUALIFIED");
  return lead;
}

async function liveBookingsOn(unitId: string) {
  return db.booking.count({ where: { unitId, unitLockKey: { not: null } } });
}

describe("golden path: broker lead → visit → booking → collections → commission", () => {
  it("connects every module in one consistent flow", async () => {
    const { brokerA, sales1, finance, mgmt } = w.actors;
    const lead = await createLead(brokerA, { projectId: w.p1.project.id, name: "Kavya Rao", phone: nextPhone() });
    expect(lead.source).toBe("BROKER");
    expect(lead.brokerId).toBe(w.brokerA.id);
    expect(lead.assignedToId).toBe(sales1.userId); // auto-assigned to the allocated exec

    await logActivity(sales1, lead.id, { type: "CALL", note: "Wants a 3BHK, corner" });
    const visit = await scheduleVisit(sales1, lead.id, { scheduledAt: addDays(now(), 1) });
    expect((await db.lead.findUniqueOrThrow({ where: { id: lead.id } })).stage).toBe("VISIT_PLANNED");
    await completeVisit(sales1, visit.id, { feedback: "Liked A-101", rating: 5 });
    expect((await db.lead.findUniqueOrThrow({ where: { id: lead.id } })).stage).toBe("VISIT_DONE");

    const unit = w.p1Units[0];
    const held = await holdUnit(sales1, unit.id, unit.version);
    expect(held.status).toBe("HOLD");

    const booking = await createBooking(sales1, { unitId: unit.id, leadId: lead.id, discountAmount: 0, expectedVersion: held.version });
    expect(booking.status).toBe("CONFIRMED");
    expect(booking.brokerId).toBe(w.brokerA.id);
    expect((await freshUnit(unit.id)).status).toBe("BOOKED");
    expect((await db.lead.findUniqueOrThrow({ where: { id: lead.id } })).stage).toBe("BOOKED");

    const installments = await db.installment.findMany({ where: { bookingId: booking.id }, orderBy: { seq: "asc" } });
    expect(installments).toHaveLength(4);
    expect(installments.reduce((s, i) => s + i.amountDue, 0)).toBe(booking.agreementValue);

    const lines = await db.commission.findMany({ where: { bookingId: booking.id } });
    expect(lines.map((l) => l.kind).sort()).toEqual(["BROKER_PAYOUT", "DEVELOPER_FEE", "EMPLOYEE_INCENTIVE"]);
    expect(lines.every((l) => l.status === "ACCRUED")).toBe(true);
    const fee = lines.find((l) => l.kind === "DEVELOPER_FEE")!;
    expect(fee.amount).toBe(applyBps(booking.agreementValue, 300));

    // 10% booking amount: below the 20% trigger, nothing earned yet.
    await recordPayment(finance, { bookingId: booking.id, amount: installments[0].amountDue, mode: "NEFT", reference: "UTR0001" });
    expect((await db.booking.findUniqueOrThrow({ where: { id: booking.id } })).status).toBe("CONFIRMED");

    // Second 10% crosses the trigger → agreement, unit SOLD, commissions EARNED.
    await recordPayment(finance, { bookingId: booking.id, amount: installments[1].amountDue, mode: "RTGS", reference: "UTR0002" });
    expect((await db.booking.findUniqueOrThrow({ where: { id: booking.id } })).status).toBe("AGREEMENT");
    expect((await freshUnit(unit.id)).status).toBe("SOLD");
    const earned = await db.commission.findMany({ where: { bookingId: booking.id } });
    expect(earned.every((l) => l.status === "EARNED")).toBe(true);

    // Settlement: fee invoiced and received; payout approved (management) then paid (finance).
    await settleCommission(finance, fee.id, "INVOICE", "INV-001");
    await settleCommission(finance, fee.id, "RECEIVE");
    const payout = earned.find((l) => l.kind === "BROKER_PAYOUT")!;
    await expect(settleCommission(finance, payout.id, "APPROVE")).rejects.toThrow(/permission/);
    await settleCommission(mgmt, payout.id, "APPROVE");
    await settleCommission(finance, payout.id, "PAY", "UTR-PAY-1");
    expect((await db.commission.findUniqueOrThrow({ where: { id: payout.id } })).status).toBe("PAID");

    const events = await db.auditEvent.findMany({ where: { entityId: booking.id } });
    expect(events.map((e) => e.type)).toEqual(
      expect.arrayContaining(["BOOKING_CREATED", "SCHEDULE_CREATED", "COMMISSION_ACCRUED", "BOOKING_CONFIRMED", "PAYMENT_RECORDED", "BOOKING_AGREEMENT"]),
    );
  });
});

describe("transaction integrity", () => {
  it("allows exactly one of two simultaneous bookings of the same unit", async () => {
    const unit = await freshUnit(w.p1Units[1].id);
    const leadA = await qualifiedLead();
    const leadB = await qualifiedLead(w.p1.project.id, w.actors.mgmt);
    const results = await Promise.allSettled([
      createBooking(w.actors.sales1, { unitId: unit.id, leadId: leadA.id, discountAmount: 0, expectedVersion: unit.version }),
      createBooking(w.actors.mgmt, { unitId: unit.id, leadId: leadB.id, discountAmount: 0, expectedVersion: unit.version }),
    ]);
    const ok = results.filter((r) => r.status === "fulfilled");
    const failed = results.filter((r) => r.status === "rejected");
    expect(ok).toHaveLength(1);
    expect(failed).toHaveLength(1);
    expect((failed[0] as PromiseRejectedResult).reason).toBeInstanceOf(ConflictError);
    expect(await liveBookingsOn(unit.id)).toBe(1);
    // The losing lead must not have been touched.
    const loser = ok[0].status === "fulfilled" && (ok[0].value.leadId === leadA.id ? leadB : leadA);
    expect((await db.lead.findUniqueOrThrow({ where: { id: (loser as { id: string }).id } })).stage).toBe("QUALIFIED");
  });

  it("rejects a booking made from a stale view of the unit", async () => {
    const unit = await freshUnit(w.p1Units[2].id);
    const lead = await qualifiedLead();
    await holdUnit(w.actors.mgmt, unit.id, unit.version);
    await releaseHold(w.actors.mgmt, unit.id); // unit is available again, but its version moved on
    await expect(
      createBooking(w.actors.sales1, { unitId: unit.id, leadId: lead.id, discountAmount: 0, expectedVersion: unit.version }),
    ).rejects.toBeInstanceOf(ConflictError);
  });

  it("blocks booking a unit another exec is holding, until the hold expires", async () => {
    const unit = await freshUnit(w.p1Units[3].id);
    const lead = await qualifiedLead();
    const held = await holdUnit(w.actors.mgmt, unit.id, unit.version);
    await expect(
      createBooking(w.actors.sales1, { unitId: unit.id, leadId: lead.id, discountAmount: 0, expectedVersion: held.version }),
    ).rejects.toThrow(/on hold/);
    setClock(addMinutes(now(), 31)); // the 30-minute hold lapses
    const booking = await createBooking(w.actors.sales1, { unitId: unit.id, leadId: lead.id, discountAmount: 0, expectedVersion: held.version });
    expect(booking.status).toBe("CONFIRMED");
  });

  it("refuses units outside the mandate (developer-retained inventory)", async () => {
    const retained = w.p1Units[5];
    expect(retained.mandateId).toBeNull();
    const lead = await qualifiedLead();
    await expect(
      createBooking(w.actors.sales1, { unitId: retained.id, leadId: lead.id, discountAmount: 0, expectedVersion: retained.version }),
    ).rejects.toThrow(/appointed inventory/);
  });

  it("rejects duplicate payment references and overpayments", async () => {
    const unit = await freshUnit(w.p2Units[0].id);
    const lead = await qualifiedLead(w.p2.project.id, w.actors.sales2);
    const booking = await createBooking(w.actors.sales2, { unitId: unit.id, leadId: lead.id, discountAmount: 0, expectedVersion: unit.version });
    await recordPayment(w.actors.finance, { bookingId: booking.id, amount: 1_00_000, mode: "UPI", reference: "DUP-REF" });
    await expect(
      recordPayment(w.actors.finance, { bookingId: booking.id, amount: 1_00_000, mode: "UPI", reference: "DUP-REF" }),
    ).rejects.toThrow(/already recorded/);
    await expect(
      recordPayment(w.actors.finance, { bookingId: booking.id, amount: booking.agreementValue, mode: "UPI", reference: "TOO-MUCH" }),
    ).rejects.toThrow(/exceeds the outstanding/);
    const received = await db.installment.aggregate({ where: { bookingId: booking.id }, _sum: { amountReceived: true } });
    expect(received._sum.amountReceived).toBe(1_00_000);
  });
});

describe("discount approval chain", () => {
  it("routes discounts beyond the mandate band through management and then the developer", async () => {
    const unit = await freshUnit(w.p1Units[4].id);
    const lead = await qualifiedLead();
    const discount = applyBps(unit.listPrice, 500); // 5% > 3% management band
    const booking = await createBooking(w.actors.sales1, { unitId: unit.id, leadId: lead.id, discountAmount: discount, expectedVersion: unit.version });
    expect(booking.status).toBe("PENDING_MGMT_APPROVAL");
    expect(booking.approvalLevel).toBe("DEVELOPER");
    const locked = await freshUnit(unit.id);
    expect(locked.status).toBe("HOLD");
    expect(locked.holdExpiresAt).toBeNull();
    expect(await db.installment.count({ where: { bookingId: booking.id } })).toBe(0);

    // The approval lock cannot be released or booked by anyone else.
    await expect(releaseHold(w.actors.mgmt, unit.id)).rejects.toThrow(/awaiting approval/);

    // Wrong developer cannot see it; sales cannot approve.
    await expect(approveBooking(w.actors.devB, booking.id)).rejects.toThrow(/not found/);
    await expect(approveBooking(w.actors.sales1, booking.id)).rejects.toThrow(/permission/);

    await approveBooking(w.actors.mgmt, booking.id);
    expect((await db.booking.findUniqueOrThrow({ where: { id: booking.id } })).status).toBe("PENDING_DEV_APPROVAL");
    await approveBooking(w.actors.devA, booking.id);

    const confirmed = await db.booking.findUniqueOrThrow({ where: { id: booking.id } });
    expect(confirmed.status).toBe("CONFIRMED");
    expect(confirmed.agreementValue).toBe(unit.listPrice - discount);
    expect((await freshUnit(unit.id)).status).toBe("BOOKED");
    expect(await db.installment.count({ where: { bookingId: booking.id } })).toBe(4);
  });

  it("releases the unit when a discount is rejected", async () => {
    const unit = await freshUnit(w.p2Units[1].id);
    const lead = await qualifiedLead(w.p2.project.id, w.actors.sales2);
    const booking = await createBooking(w.actors.sales2, {
      unitId: unit.id,
      leadId: lead.id,
      discountAmount: applyBps(unit.listPrice, 200),
      expectedVersion: unit.version,
    });
    expect(booking.approvalLevel).toBe("MANAGEMENT");
    await rejectBooking(w.actors.mgmt, booking.id, "Below floor price");
    expect((await freshUnit(unit.id)).status).toBe("AVAILABLE");
    expect((await db.lead.findUniqueOrThrow({ where: { id: lead.id } })).stage).toBe("NEGOTIATION");
    expect(await db.commission.count({ where: { bookingId: booking.id } })).toBe(0);
  });

  it("rejects discounts above the hard cap outright", async () => {
    const unit = await freshUnit(w.p2Units[1].id);
    const lead = await qualifiedLead(w.p2.project.id, w.actors.sales2);
    await expect(
      createBooking(w.actors.sales2, { unitId: unit.id, leadId: lead.id, discountAmount: applyBps(unit.listPrice, 2000), expectedVersion: unit.version }),
    ).rejects.toBeInstanceOf(DomainError);
  });
});

describe("cancellation", () => {
  it("releases inventory, cancels open instalments and reverses or claws back commission", async () => {
    // Book P2's second unit (released by the rejection above) and drive it to agreement stage.
    const unit = await freshUnit(w.p2Units[1].id);
    const lead = await qualifiedLead(w.p2.project.id, w.actors.sales2);
    const booking = await createBooking(w.actors.sales2, { unitId: unit.id, leadId: lead.id, discountAmount: 0, expectedVersion: unit.version });
    const threshold = applyBps(booking.agreementValue, 2000);
    await recordPayment(w.actors.finance, { bookingId: booking.id, amount: threshold, mode: "NEFT", reference: "UTR-C1" });
    const fee = await db.commission.findFirstOrThrow({ where: { bookingId: booking.id, kind: "DEVELOPER_FEE" } });
    await settleCommission(w.actors.finance, fee.id, "INVOICE", "INV-C1");
    await settleCommission(w.actors.finance, fee.id, "RECEIVE");

    await expect(cancelBooking(w.actors.sales2, booking.id, "Customer withdrew")).rejects.toThrow(/permission/);
    await cancelBooking(w.actors.mgmt, booking.id, "Customer withdrew");

    const cancelled = await db.booking.findUniqueOrThrow({ where: { id: booking.id } });
    expect(cancelled.status).toBe("CANCELLED");
    expect(cancelled.unitLockKey).toBeNull();
    expect(cancelled.forfeitedAmount).toBe(applyBps(booking.agreementValue, 200));
    expect(cancelled.refundDue).toBe(threshold - cancelled.forfeitedAmount);
    expect((await freshUnit(unit.id)).status).toBe("AVAILABLE");
    const open = await db.installment.count({ where: { bookingId: booking.id, status: { in: ["DUE", "PARTIAL"] } } });
    expect(open).toBe(0);

    const lines = await db.commission.findMany({ where: { bookingId: booking.id } });
    const clawback = lines.find((l) => l.isAdjustment);
    expect(clawback?.amount).toBe(-fee.amount);
    expect(lines.filter((l) => !l.isAdjustment && l.kind !== "DEVELOPER_FEE").every((l) => l.status === "REVERSED")).toBe(true);
    expect((await db.lead.findUniqueOrThrow({ where: { id: lead.id } })).stage).toBe("LOST");

    // The released unit can be sold again.
    const again = await qualifiedLead(w.p2.project.id, w.actors.sales2);
    const relisted = await freshUnit(unit.id);
    const rebook = await createBooking(w.actors.sales2, { unitId: unit.id, leadId: again.id, discountAmount: 0, expectedVersion: relisted.version });
    expect(rebook.status).toBe("CONFIRMED");
  });
});

describe("commission tiers", () => {
  it("applies the higher fee tier once the mandate reaches its tier threshold", async () => {
    // P1 already has live bookings from earlier scenarios; the tier (2 bookings) is reached.
    const fees = await db.commission.findMany({
      where: { kind: "DEVELOPER_FEE", projectId: w.p1.project.id, isAdjustment: false },
      orderBy: { accruedAt: "asc" },
    });
    expect(fees.length).toBeGreaterThanOrEqual(3);
    expect(fees[0].rateBps).toBe(300);
    expect(fees[fees.length - 1].rateBps).toBe(350);
  });
});
