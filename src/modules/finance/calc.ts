import type { CommissionKind } from "@/generated/prisma/enums";
import { addDays } from "@/lib/clock";
import { DomainError } from "@/lib/errors";
import { applyBps, splitByBps } from "@/lib/money";

/** Pure finance calculations, shared by services, seed data and the integrity checker. */

export type PlanStage = { seq: number; label: string; bps: number; dueOffsetDays: number };

export type ScheduleLine = { seq: number; label: string; bps: number; dueDate: Date; amountDue: number };

export function generateSchedule(agreementValue: number, stages: PlanStage[], bookedAt: Date): ScheduleLine[] {
  const sorted = [...stages].sort((a, b) => a.seq - b.seq);
  const totalBps = sorted.reduce((sum, s) => sum + s.bps, 0);
  if (totalBps !== 10_000) {
    throw new DomainError("PLAN_INVALID", `Payment plan stages add up to ${totalBps / 100}% instead of 100%.`);
  }
  const amounts = splitByBps(
    agreementValue,
    sorted.map((s) => s.bps),
  );
  return sorted.map((s, i) => ({
    seq: s.seq,
    label: s.label,
    bps: s.bps,
    dueDate: addDays(bookedAt, s.dueOffsetDays),
    amountDue: amounts[i],
  }));
}

export type MandateTerms = {
  soleXFeeBps: number;
  feeTierUnits: number | null;
  feeTierBps: number | null;
  brokerPayoutBps: number;
  incentiveBps: number;
};

/** Performance tier: once the mandate has `feeTierUnits` confirmed bookings, later ones earn the tier rate. */
export function feeRateFor(terms: MandateTerms, priorConfirmedBookings: number): number {
  if (terms.feeTierUnits != null && terms.feeTierBps != null && priorConfirmedBookings >= terms.feeTierUnits) {
    return terms.feeTierBps;
  }
  return terms.soleXFeeBps;
}

export type CommissionLine = {
  kind: CommissionKind;
  brokerId: string | null;
  userId: string | null;
  baseAmount: number;
  rateBps: number;
  amount: number;
};

/**
 * One booking produces up to three ledger lines:
 *  - DEVELOPER_FEE: what soleX invoices the developer (receivable)
 *  - BROKER_PAYOUT: what soleX owes the attributed channel partner (payable)
 *  - EMPLOYEE_INCENTIVE: what soleX owes the closing sales exec (payable)
 */
export function commissionLines(
  booking: { agreementValue: number; brokerId: string | null; salesExecId: string },
  terms: MandateTerms,
  priorConfirmedBookings: number,
): CommissionLine[] {
  const base = booking.agreementValue;
  const feeBps = feeRateFor(terms, priorConfirmedBookings);
  const lines: CommissionLine[] = [
    { kind: "DEVELOPER_FEE", brokerId: null, userId: null, baseAmount: base, rateBps: feeBps, amount: applyBps(base, feeBps) },
  ];
  if (booking.brokerId) {
    lines.push({
      kind: "BROKER_PAYOUT",
      brokerId: booking.brokerId,
      userId: null,
      baseAmount: base,
      rateBps: terms.brokerPayoutBps,
      amount: applyBps(base, terms.brokerPayoutBps),
    });
  }
  if (terms.incentiveBps > 0) {
    lines.push({
      kind: "EMPLOYEE_INCENTIVE",
      brokerId: null,
      userId: booking.salesExecId,
      baseAmount: base,
      rateBps: terms.incentiveBps,
      amount: applyBps(base, terms.incentiveBps),
    });
  }
  return lines;
}

/** Collection threshold at which the booking reaches agreement stage and commissions are earned. */
export function earningThreshold(agreementValue: number, earningTriggerBps: number): number {
  return applyBps(agreementValue, earningTriggerBps);
}

export function cancellationSettlement(agreementValue: number, received: number, forfeitureBps: number) {
  const forfeited = Math.min(received, applyBps(agreementValue, forfeitureBps));
  return { forfeited, refundDue: received - forfeited };
}

export type DiscountBands = { execMaxDiscountBps: number; mgmtMaxDiscountBps: number };
export const HARD_DISCOUNT_CAP_BPS = 1500;

export function approvalLevelFor(discountBps: number, bands: DiscountBands): "NONE" | "MANAGEMENT" | "DEVELOPER" {
  if (discountBps <= bands.execMaxDiscountBps) return "NONE";
  if (discountBps <= bands.mgmtMaxDiscountBps) return "MANAGEMENT";
  return "DEVELOPER";
}
