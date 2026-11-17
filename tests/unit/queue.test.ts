import { describe, expect, it } from "vitest";
import { addDays } from "@/lib/clock";
import { financeQueue, managementQueue, salesQueue, type FinanceInput, type ManagementInput, type OverdueBooking, type SalesLeadRow } from "@/modules/reporting/queue";

const AT = new Date(2026, 10, 16, 10, 0, 0);
const hoursAgo = (h: number) => new Date(AT.getTime() - h * 3_600_000);

function lead(over: Partial<SalesLeadRow> = {}): SalesLeadRow {
  return {
    id: over.id ?? "L1",
    code: "AGR-L0001",
    name: "Kavya Raghavan",
    phone: "9810012345",
    stage: "FOLLOW_UP",
    source: "WEBSITE",
    createdAt: addDays(AT, -20),
    lastContactAt: addDays(AT, -5),
    nextFollowUpAt: addDays(AT, 2),
    attributionExpiresAt: addDays(AT, 40),
    brokerName: null,
    projectId: "P1",
    projectName: "Aravali Greens",
    visits: [],
    messagesAt: [],
    lastCall: null,
    ...over,
  };
}

const ids = (q: { items: { id: string }[] }) => q.items.map((i) => i.id.replace(/-L\d+$/, ""));

describe("sales queue", () => {
  it("is empty when nothing is due", () => {
    expect(salesQueue({ leads: [lead()], holds: [] }, AT).total).toBe(0);
  });

  it("raises a new partner lead against the 24-hour call promise", () => {
    const q = salesQueue({ leads: [lead({ stage: "NEW", lastContactAt: null, createdAt: hoursAgo(20), brokerName: "Prime Estates" })], holds: [] }, AT);
    expect(q.items[0]).toMatchObject({ severity: "high" });
    expect(q.items[0].why).toContain("Prime Estates");
    expect(q.items[0].why).toContain("4 h left");
    expect(q.items[0].actions[0].kind).toBe("call");
  });

  it("offers to schedule the visit a customer agreed to on the last call, until one is scheduled", () => {
    const lastCall = { nextAction: "SCHEDULE_VISIT", nextStep: "Schedule the visit.", startedAt: hoursAgo(20), endedAt: hoursAgo(20) };
    const open = salesQueue({ leads: [lead({ lastCall })], holds: [] }, AT);
    expect(ids(open)).toEqual(["call-visit"]);
    expect(open.items[0].actions[0].kind).toBe("scheduleVisit");

    const done = salesQueue(
      { leads: [lead({ lastCall, visits: [{ id: "V1", status: "SCHEDULED", scheduledAt: addDays(AT, 5), createdAt: hoursAgo(2), completedAt: null }] })], holds: [] },
      AT,
    );
    expect(done.total).toBe(0);
  });

  it("treats promised information as done once a WhatsApp has been sent", () => {
    const lastCall = { nextAction: "SEND_INFO:PAYMENT_PLAN", nextStep: null, startedAt: hoursAgo(5), endedAt: hoursAgo(5) };
    expect(ids(salesQueue({ leads: [lead({ lastCall })], holds: [] }, AT))).toEqual(["call-info"]);
    expect(salesQueue({ leads: [lead({ lastCall, messagesAt: [hoursAgo(1)] })], holds: [] }, AT).total).toBe(0);
  });

  it("puts a partner's visit request ahead of everything for that lead", () => {
    const q = salesQueue(
      {
        leads: [lead({ brokerName: "UrbanKey", nextFollowUpAt: addDays(AT, -3), visits: [{ id: "V9", status: "REQUESTED", scheduledAt: addDays(AT, 2), createdAt: hoursAgo(1), completedAt: null }] })],
        holds: [],
      },
      AT,
    );
    expect(ids(q)).toEqual(["visit-request"]);
    expect(q.items[0].actions[0]).toMatchObject({ kind: "confirmVisit", visitId: "V9" });
  });

  it("ranks hot overdue leads above cold ones, and rolls month-old leads into one clean-up item", () => {
    const q = salesQueue(
      {
        leads: [
          lead({ id: "L1", stage: "FOLLOW_UP", nextFollowUpAt: addDays(AT, -2) }),
          lead({ id: "L2", stage: "NEGOTIATION", nextFollowUpAt: addDays(AT, -1) }),
          lead({ id: "L3", stage: "QUALIFIED", nextFollowUpAt: addDays(AT, -60) }),
          lead({ id: "L4", stage: "NEGOTIATION", nextFollowUpAt: addDays(AT, -90) }),
        ],
        holds: [],
      },
      AT,
    );
    expect(q.items.map((i) => i.id)).toEqual(["overdue-L2", "overdue-L1", "stale"]);
    expect(q.items[2].title).toBe("2 leads untouched for 30+ days");
    expect(q.items[2].why).toContain("1 of them reached visit or negotiation");
  });

  it("puts the best-fit unit in front of a lead that visited but did not book", () => {
    const q = salesQueue(
      {
        leads: [
          lead({
            stage: "VISIT_DONE",
            visits: [{ id: "V1", status: "COMPLETED", scheduledAt: addDays(AT, -4), createdAt: addDays(AT, -6), completedAt: addDays(AT, -4) }],
            bestFit: { id: "U7", unitNo: "A-704", listPrice: 1_95_00_000, overBudget: false },
          }),
        ],
        holds: [],
      },
      AT,
    );
    expect(q.items[0].why).toContain("A-704 at ₹1.95 Cr fits their budget");
    expect(q.items[0].actions[0]).toEqual({ kind: "link", href: "/projects/P1?lead=L1&unit=U7", label: "Book A-704" });
  });

  it("warns about own holds about to lapse", () => {
    const q = salesQueue({ leads: [], holds: [{ unitId: "U1", unitNo: "B-302", projectId: "P1", expiresAt: new Date(AT.getTime() + 12 * 60_000) }] }, AT);
    expect(q.items[0]).toMatchObject({ severity: "high", title: "Your hold on B-302 ends in 12 min" });
  });

  it("caps the list but reports the full count", () => {
    const leads = Array.from({ length: 12 }, (_, i) => lead({ id: `L${i}`, nextFollowUpAt: addDays(AT, -1) }));
    const q = salesQueue({ leads, holds: [] }, AT, 8);
    expect(q.items).toHaveLength(8);
    expect(q.total).toBe(12);
  });
});

function overdue(over: Partial<OverdueBooking> = {}): OverdueBooking {
  return {
    bookingId: "B1",
    code: "BK-AGR-0008",
    customer: "Tara Rao",
    unitNo: "A-1001",
    projectName: "Aravali Greens",
    overdue: 22_50_000,
    daysLate: 15,
    oldestInstallmentId: "I1",
    oldestLabel: "Within 30 days of booking",
    triggerPct: "20%",
    crossesTrigger: true,
    unlocksFee: 6_80_000,
    unlocksPayouts: 3_90_000,
    remindedToday: false,
    ...over,
  };
}

function mgmt(over: Partial<ManagementInput> = {}): ManagementInput {
  return { mandates: [], approvals: [], overdue: [], hotLeads: {}, execBacklog: [], expiringAttribution: 0, refunds: [], ...over };
}

describe("management queue", () => {
  it("offers inline approval for discounts waiting on soleX, and only a link for those with the developer", () => {
    const base = { code: "BK-1", unitNo: "A-1001", customer: "Aarav Das", execName: "Arjun Mehta", developerName: "Aravali Habitats", discountAmount: 5_80_000, mgmtMaxDiscountBps: 300, bookedAt: addDays(AT, -1), mgmtApprovedAt: null };
    const q = managementQueue(
      mgmt({
        approvals: [
          { ...base, id: "B1", status: "PENDING_MGMT_APPROVAL", discountBps: 250 },
          { ...base, id: "B2", status: "PENDING_DEV_APPROVAL", discountBps: 450, mgmtApprovedAt: addDays(AT, -2) },
        ],
      }),
      AT,
    );
    expect(q.items[0]).toMatchObject({ id: "approve-B1", severity: "high" });
    expect(q.items[0].actions[0].kind).toBe("approve");
    expect(q.items[0].why).toContain("within your band");
    expect(q.items.at(-1)).toMatchObject({ id: "dev-B2", severity: "low" });
  });

  it("flags fee held up by late payments, one row each or a single roll-up when there are many", () => {
    const one = managementQueue(mgmt({ overdue: [overdue()] }), AT);
    expect(one.items[0].title).toBe("₹22.5 L overdue on BK-AGR-0008 is holding back ₹6.8 L of fee");
    expect(one.items[0].actions[0]).toEqual({ kind: "remind", installmentId: "I1" });

    const many = managementQueue(mgmt({ overdue: [overdue(), overdue({ bookingId: "B2", unlocksFee: 3_00_000 }), overdue({ bookingId: "B3", unlocksFee: 1_20_000 })] }), AT);
    expect(many.items.map((i) => i.id)).toEqual(["fee-blocked"]);
    expect(many.items[0].title).toBe("₹11 L of soleX fee held up by 3 late payments");
  });

  it("does not offer a second reminder on the same day", () => {
    const q = managementQueue(mgmt({ overdue: [overdue({ remindedToday: true })] }), AT);
    expect(q.items[0].actions.map((a) => a.kind)).toEqual(["link"]);
  });

  it("states the bookings a slipping mandate needs and the hot leads available", () => {
    const m = { projectId: "P1", projectName: "Aravali Courtyard", health: "AT_RISK", daysLeft: 40, targetUnits: 25, absorbed: 7, expectedByNow: 20 } as unknown as ManagementInput["mandates"][number];
    const q = managementQueue(mgmt({ mandates: [m], hotLeads: { P1: 6 } }), AT);
    expect(q.items[0].title).toBe("Aravali Courtyard: 18 more bookings needed in 40 days");
    expect(q.items[0].why).toContain("3.1 a week");
    expect(q.items[0].why).toContain("6 leads at visit-done or negotiation");
  });

  it("only flags execs with a real backlog", () => {
    const q = managementQueue(mgmt({ execBacklog: [{ id: "u1", name: "Rohit", overdue: 3, hot: 1 }, { id: "u2", name: "Sara", overdue: 9, hot: 2 }] }), AT);
    expect(q.items.map((i) => i.id)).toEqual(["backlog-u2"]);
  });
});

function fin(over: Partial<FinanceInput> = {}): FinanceInput {
  return { overdue: [], ledger: [], awaitingApproval: { count: 0, amount: 0 }, refunds: [], failedChecks: [], can: { recordPayment: true, remind: true, settle: true }, ...over };
}

describe("finance queue", () => {
  it("lets finance record the receipt or remind, and explains the commission it unlocks", () => {
    const q = financeQueue(fin({ overdue: [overdue()] }), AT);
    expect(q.items[0].actions.map((a) => a.kind)).toEqual(["recordPayment", "remind"]);
    expect(q.items[0].why).toContain("unlocks ₹6.8 L fee and ₹3.9 L payouts");
  });

  it("never offers an action the viewer is not allowed to take", () => {
    const q = financeQueue(fin({ overdue: [overdue()], can: { recordPayment: false, remind: true, settle: false }, ledger: [{ id: "C1", kind: "BROKER_PAYOUT", status: "APPROVED", isAdjustment: false, amount: 2_20_000, bookingId: "B1", bookingCode: "BK-1", party: "UrbanKey", since: AT }] }), AT);
    expect(q.items).toHaveLength(1);
    expect(q.items[0].actions.map((a) => a.kind)).toEqual(["remind"]);
  });

  it("puts money in before money out", () => {
    const row = (id: string, kind: "DEVELOPER_FEE" | "BROKER_PAYOUT", status: "EARNED" | "INVOICED" | "APPROVED") => ({ id, kind, status, isAdjustment: false, amount: 1_00_000, bookingId: "B", bookingCode: "BK", party: "X", since: AT });
    const q = financeQueue(fin({ ledger: [row("pay", "BROKER_PAYOUT", "APPROVED"), row("recv", "DEVELOPER_FEE", "INVOICED"), row("inv", "DEVELOPER_FEE", "EARNED")] }), AT);
    expect(q.items.map((i) => i.id)).toEqual(["invoice-inv", "pay-pay", "receive-recv"]);
  });

  it("leads with a failing integrity check", () => {
    const q = financeQueue(fin({ overdue: [overdue()], failedChecks: ["One live booking per unit"] }), AT);
    expect(q.items[0]).toMatchObject({ id: "integrity", severity: "high" });
  });
});
