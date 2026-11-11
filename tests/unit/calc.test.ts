import { describe, expect, it } from "vitest";
import { applyBps, formatINR, formatINRCompact, splitByBps, toBps } from "@/lib/money";
import { maskPhone, normalizePhone, isValidIndianMobile } from "@/lib/phone";
import { canTransition } from "@/lib/state";
import { priceUnit } from "@/modules/inventory/pricing";
import { UNIT_MACHINE, effectiveStatus } from "@/modules/inventory/units";
import { LEAD_MACHINE } from "@/modules/crm/leads";
import { BOOKING_MACHINE, quoteBooking } from "@/modules/sales/bookings";
import { FEE_MACHINE, PAYOUT_MACHINE } from "@/modules/finance/commissions";
import {
  approvalLevelFor,
  cancellationSettlement,
  commissionLines,
  feeRateFor,
  generateSchedule,
} from "@/modules/finance/calc";

const terms = { soleXFeeBps: 300, feeTierUnits: 10, feeTierBps: 350, brokerPayoutBps: 150, incentiveBps: 25 };
const plan = [
  { seq: 1, label: "Booking", bps: 1000, dueOffsetDays: 0 },
  { seq: 2, label: "30 days", bps: 1000, dueOffsetDays: 30 },
  { seq: 3, label: "Slab", bps: 3000, dueOffsetDays: 180 },
  { seq: 4, label: "Possession", bps: 5000, dueOffsetDays: 720 },
];

describe("money", () => {
  it("applies basis points with rounding", () => {
    expect(applyBps(1_00_00_000, 300)).toBe(3_00_000);
    expect(applyBps(333, 3333)).toBe(111);
    expect(toBps(3_00_000, 1_00_00_000)).toBe(300);
  });

  it("splits totals so parts always sum exactly", () => {
    for (const total of [1, 7, 99_99_999, 1_23_45_679]) {
      const parts = splitByBps(total, [3333, 3333, 3334]);
      expect(parts.reduce((a, b) => a + b, 0)).toBe(total);
    }
  });

  it("formats Indian currency", () => {
    expect(formatINR(12345678)).toBe("₹1,23,45,678");
    expect(formatINRCompact(1_25_00_000)).toBe("₹1.25 Cr");
    expect(formatINRCompact(45_60_000)).toBe("₹45.6 L");
    expect(formatINRCompact(-2_00_000)).toBe("-₹2 L");
  });
});

describe("phone", () => {
  it("normalises and validates Indian mobiles", () => {
    expect(normalizePhone("+91 98765 43210")).toBe("9876543210");
    expect(normalizePhone("09876543210")).toBe("9876543210");
    expect(isValidIndianMobile("98765-43210")).toBe(true);
    expect(isValidIndianMobile("12345")).toBe(false);
    expect(maskPhone("9876543210")).toBe("98xxxxxx10");
  });
});

describe("pricing", () => {
  it("prices a unit from its components", () => {
    const p = priceUnit({ superSqft: 1500, floor: 10, facing: "Park facing", config: "3BHK", baseRatePerSqft: 10_000 });
    expect(p.basicAmount).toBe(1_50_00_000);
    expect(p.floorRiseAmount).toBe(6 * 40 * 1500);
    expect(p.plcAmount).toBe(150 * 1500);
    expect(p.parkingAmount).toBe(7_00_000);
    expect(p.listPrice).toBe(p.basicAmount + p.floorRiseAmount + p.plcAmount + p.parkingAmount + p.otherCharges);
  });
});

describe("payment schedule", () => {
  it("sums exactly to the agreement value with due dates from the booking date", () => {
    const bookedAt = new Date("2026-01-01T00:00:00Z");
    const s = generateSchedule(1_23_45_679, plan, bookedAt);
    expect(s.reduce((a, l) => a + l.amountDue, 0)).toBe(1_23_45_679);
    expect(s[1].dueDate.toISOString()).toBe("2026-01-31T00:00:00.000Z");
  });

  it("rejects plans that do not add to 100%", () => {
    expect(() => generateSchedule(100, plan.slice(0, 3), new Date())).toThrow(/instead of 100%/);
  });
});

describe("commissions", () => {
  it("produces fee, broker payout and incentive lines", () => {
    const lines = commissionLines({ agreementValue: 2_00_00_000, brokerId: "b1", salesExecId: "u1" }, terms, 0);
    expect(lines).toEqual([
      expect.objectContaining({ kind: "DEVELOPER_FEE", amount: 6_00_000, rateBps: 300 }),
      expect.objectContaining({ kind: "BROKER_PAYOUT", amount: 3_00_000, brokerId: "b1" }),
      expect.objectContaining({ kind: "EMPLOYEE_INCENTIVE", amount: 50_000, userId: "u1" }),
    ]);
  });

  it("omits the broker line for direct sales", () => {
    const lines = commissionLines({ agreementValue: 1_00_00_000, brokerId: null, salesExecId: "u1" }, terms, 0);
    expect(lines.map((l) => l.kind)).toEqual(["DEVELOPER_FEE", "EMPLOYEE_INCENTIVE"]);
  });

  it("switches to the tier rate once the tier threshold is reached", () => {
    expect(feeRateFor(terms, 9)).toBe(300);
    expect(feeRateFor(terms, 10)).toBe(350);
    expect(feeRateFor({ ...terms, feeTierUnits: null, feeTierBps: null }, 99)).toBe(300);
  });

  it("computes cancellation forfeiture capped at what was received", () => {
    expect(cancellationSettlement(1_00_00_000, 20_00_000, 200)).toEqual({ forfeited: 2_00_000, refundDue: 18_00_000 });
    expect(cancellationSettlement(1_00_00_000, 1_00_000, 200)).toEqual({ forfeited: 1_00_000, refundDue: 0 });
  });
});

describe("discount approval", () => {
  const bands = { execMaxDiscountBps: 100, mgmtMaxDiscountBps: 300 };
  it("routes by discount band", () => {
    expect(approvalLevelFor(0, bands)).toBe("NONE");
    expect(approvalLevelFor(100, bands)).toBe("NONE");
    expect(approvalLevelFor(101, bands)).toBe("MANAGEMENT");
    expect(approvalLevelFor(300, bands)).toBe("MANAGEMENT");
    expect(approvalLevelFor(301, bands)).toBe("DEVELOPER");
  });

  it("quotes agreement value and rejects invalid discounts", () => {
    expect(quoteBooking(1_00_00_000, 2_00_000, bands)).toMatchObject({ discountBps: 200, agreementValue: 98_00_000, approvalLevel: "MANAGEMENT" });
    expect(() => quoteBooking(1_00_00_000, -1, bands)).toThrow();
    expect(() => quoteBooking(1_00_00_000, 20_00_000, bands)).toThrow(/cannot exceed/);
  });
});

describe("state machines", () => {
  it("forbids illegal unit transitions", () => {
    expect(canTransition(UNIT_MACHINE, "AVAILABLE", "BOOKED")).toBe(true);
    expect(canTransition(UNIT_MACHINE, "BOOKED", "HOLD")).toBe(false);
    expect(canTransition(UNIT_MACHINE, "SOLD", "BOOKED")).toBe(false);
    expect(canTransition(UNIT_MACHINE, "BLOCKED", "BOOKED")).toBe(false);
  });

  it("treats expired holds as available", () => {
    const past = new Date(Date.now() - 1000);
    expect(effectiveStatus({ status: "HOLD", holdExpiresAt: past })).toBe("AVAILABLE");
    expect(effectiveStatus({ status: "HOLD", holdExpiresAt: null })).toBe("HOLD");
  });

  it("keeps booking, lead and commission lifecycles one-way", () => {
    expect(canTransition(BOOKING_MACHINE, "CANCELLED", "CONFIRMED")).toBe(false);
    expect(canTransition(BOOKING_MACHINE, "AGREEMENT", "CONFIRMED")).toBe(false);
    expect(canTransition(LEAD_MACHINE, "INVALID", "NEW")).toBe(false);
    expect(canTransition(LEAD_MACHINE, "LOST", "FOLLOW_UP")).toBe(true);
    expect(canTransition(FEE_MACHINE, "ACCRUED", "RECEIVED")).toBe(false);
    expect(canTransition(PAYOUT_MACHINE, "EARNED", "PAID")).toBe(false);
  });
});
