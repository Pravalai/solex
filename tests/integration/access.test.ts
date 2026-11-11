import { beforeAll, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { ForbiddenError, NotFoundError } from "@/lib/errors";
import { changeLeadStage, createLead, logActivity, DuplicateLeadError } from "@/modules/crm/leads";
import { createBooking } from "@/modules/sales/bookings";
import { recordPayment } from "@/modules/finance/payments";
import { getStackingPlan, getUnitDetail, listProjects } from "@/modules/reporting/inventory";
import { getLeadDetail, listLeads } from "@/modules/reporting/leads";
import { getBookingDetail, listBookings } from "@/modules/reporting/bookings";
import { buildWorld, nextPhone, type World } from "../fixtures";

let w: World;
let brokerALeadId: string;
let p1BookingId: string;
let p2BookingId: string;
const sharedPhone = "9123456780";

beforeAll(async () => {
  w = await buildWorld();
  const { brokerA, sales1, sales2 } = w.actors;
  const lead = await createLead(brokerA, { projectId: w.p1.project.id, name: "Shared Buyer", phone: sharedPhone });
  brokerALeadId = lead.id;
  await logActivity(sales1, lead.id, { type: "CALL", note: "ok" });
  await changeLeadStage(sales1, lead.id, "QUALIFIED");
  const unit = w.p1Units[0];
  p1BookingId = (await createBooking(sales1, { unitId: unit.id, leadId: lead.id, discountAmount: 0, expectedVersion: unit.version })).id;

  const lead2 = await createLead(sales2, { projectId: w.p2.project.id, name: "P2 Buyer", phone: nextPhone(), source: "WEBSITE" });
  await logActivity(sales2, lead2.id, { type: "CALL", note: "ok" });
  await changeLeadStage(sales2, lead2.id, "QUALIFIED");
  const u2 = w.p2Units[0];
  p2BookingId = (await createBooking(sales2, { unitId: u2.id, leadId: lead2.id, discountAmount: 0, expectedVersion: u2.version })).id;
});

describe("broker separation", () => {
  it("protects attribution without revealing the existing lead", async () => {
    const err = await createLead(w.actors.brokerB, { projectId: w.p1.project.id, name: "Same Person", phone: `+91 ${sharedPhone}` }).catch((e) => e);
    expect(err).toBeInstanceOf(DuplicateLeadError);
    expect(err.existingLeadId).toBeNull();
    expect(err.message).not.toMatch(/P1-L|Alpha|sales1/);
    // An internal user is told exactly which lead it duplicates.
    const internal = await createLead(w.actors.mgmt, { projectId: w.p1.project.id, name: "Same", phone: sharedPhone, source: "WEBSITE" }).catch((e) => e);
    expect(internal.existingLeadId).toBe(brokerALeadId);
  });

  it("only ever lists the broker's own leads and bookings", async () => {
    expect((await listLeads(w.actors.brokerA)).map((l) => l.id)).toEqual([brokerALeadId]);
    expect(await listLeads(w.actors.brokerB)).toEqual([]);
    await expect(getLeadDetail(w.actors.brokerB, brokerALeadId)).rejects.toBeInstanceOf(NotFoundError);
    expect((await listBookings(w.actors.brokerA)).map((b) => b.id)).toEqual([p1BookingId]);
    expect(await listBookings(w.actors.brokerB)).toEqual([]);
    await expect(getBookingDetail(w.actors.brokerB, p1BookingId)).rejects.toBeInstanceOf(NotFoundError);
  });

  it("shows a broker only their own brokerage on their booking", async () => {
    const b = await getBookingDetail(w.actors.brokerA, p1BookingId);
    expect(b.commissions.map((c) => c.kind)).toEqual(["BROKER_PAYOUT"]);
    expect(b.customer.phone).toBeNull();
    expect(b.timeline).toEqual([]);
  });

  it("serves only appointed inventory, collapsed to available/unavailable, with no commercials", async () => {
    const plan = await getStackingPlan(w.actors.brokerA, w.p1.project.id);
    const units = plan.towers.flatMap((t) => t.floors.flatMap((f) => f.units));
    expect(units).toHaveLength(5); // A-302 is retained by the developer
    expect(units.some((u) => u.retained)).toBe(false);
    expect(new Set(units.map((u) => u.status))).toEqual(new Set(["AVAILABLE", "BLOCKED"]));
    expect(plan.mandate).toBeNull();
    const json = JSON.stringify(plan);
    expect(json).not.toMatch(/soleXFeeBps|brokerPayoutBps|holdBy/);
    const projects = await listProjects(w.actors.brokerA);
    expect(projects.map((p) => p.code)).toEqual(["P1"]);
    expect(projects[0].soldValue).toBeNull();
    await expect(getStackingPlan(w.actors.brokerA, w.p2.project.id)).rejects.toBeInstanceOf(NotFoundError);
    await expect(getUnitDetail(w.actors.brokerA, w.p1Units[1].id)).rejects.toBeInstanceOf(NotFoundError);
  });

  it("cannot perform internal actions", async () => {
    const unit = w.p1Units[1];
    await expect(
      createBooking(w.actors.brokerA, { unitId: unit.id, leadId: brokerALeadId, discountAmount: 0, expectedVersion: unit.version }),
    ).rejects.toBeInstanceOf(ForbiddenError);
  });
});

describe("developer separation", () => {
  it("cannot reach another developer's projects or bookings", async () => {
    await expect(getStackingPlan(w.actors.devA, w.p2.project.id)).rejects.toBeInstanceOf(NotFoundError);
    await expect(getBookingDetail(w.actors.devA, p2BookingId)).rejects.toBeInstanceOf(NotFoundError);
    expect((await listProjects(w.actors.devA)).map((p) => p.code)).toEqual(["P1"]);
    expect((await listBookings(w.actors.devA)).map((b) => b.id)).toEqual([p1BookingId]);
  });

  it("sees the soleX fee on its bookings but never broker payouts, incentives or the partner's identity", async () => {
    const b = await getBookingDetail(w.actors.devA, p1BookingId);
    expect(b.commissions.map((c) => c.kind)).toEqual(["DEVELOPER_FEE"]);
    expect(b.broker).toBeNull();
    expect(b.channel).toBe("Channel partner");
    expect(b.customer.phone).toBeNull();
    const list = await listBookings(w.actors.devA);
    expect(list[0].channel).toBe("Channel partner");
    expect(JSON.stringify(list)).not.toContain("Alpha Realty");
    const plan = await getStackingPlan(w.actors.devA, w.p1.project.id);
    expect(plan.mandate?.soleXFeeBps).toBe(300);
    expect(plan.mandate?.brokerPayoutBps).toBeNull();
    expect(plan.mandate?.incentiveBps).toBeNull();
    // Developers see their whole project, including inventory retained outside the mandate.
    expect(plan.towers.flatMap((t) => t.floors.flatMap((f) => f.units)).some((u) => u.retained)).toBe(true);
  });

  it("has no access to the lead pipeline or payment recording", async () => {
    expect(await listLeads(w.actors.devA)).toEqual([]);
    await expect(getLeadDetail(w.actors.devA, brokerALeadId)).rejects.toBeInstanceOf(NotFoundError);
    await expect(
      recordPayment(w.actors.devA, { bookingId: p1BookingId, amount: 1000, mode: "NEFT", reference: "X-1234" }),
    ).rejects.toBeInstanceOf(ForbiddenError);
  });
});

describe("internal separation", () => {
  it("confines a sales exec to allocated projects and own leads", async () => {
    expect((await listProjects(w.actors.sales1)).map((p) => p.code)).toEqual(["P1"]);
    await expect(getStackingPlan(w.actors.sales1, w.p2.project.id)).rejects.toBeInstanceOf(NotFoundError);
    await expect(getBookingDetail(w.actors.sales1, p2BookingId)).rejects.toBeInstanceOf(NotFoundError);
    const leads = await listLeads(w.actors.sales1);
    expect(leads.every((l) => l.project.code === "P1")).toBe(true);
    const p2Lead = await db.lead.findFirstOrThrow({ where: { projectId: w.p2.project.id } });
    await expect(getLeadDetail(w.actors.sales1, p2Lead.id)).rejects.toBeInstanceOf(NotFoundError);
  });

  it("gives management everything and finance no lead pipeline", async () => {
    expect((await listProjects(w.actors.mgmt)).length).toBe(2);
    expect((await listBookings(w.actors.mgmt)).length).toBe(2);
    expect(await listLeads(w.actors.finance)).toEqual([]);
    const b = await getBookingDetail(w.actors.mgmt, p1BookingId);
    expect(b.commissions.map((c) => c.kind).sort()).toEqual(["BROKER_PAYOUT", "DEVELOPER_FEE", "EMPLOYEE_INCENTIVE"]);
    expect(b.timeline.length).toBeGreaterThan(0);
  });
});
