import { db, type Tx } from "@/lib/db";
import { applyBps } from "@/lib/money";
import { earningThreshold } from "@/modules/finance/calc";

export type IntegrityCheck = { key: string; label: string; ok: boolean; violations: string[] };

const LIVE = new Set(["CONFIRMED", "AGREEMENT"]);
const PENDING = new Set(["PENDING_MGMT_APPROVAL", "PENDING_DEV_APPROVAL"]);

/**
 * Invariants that must hold across inventory, bookings and finance at all times.
 * They run on demand (Activity screen) and after every integration-test scenario.
 */
export async function runIntegrityChecks(client: Tx = db): Promise<IntegrityCheck[]> {
  const [units, bookings, payments, commissions] = await Promise.all([
    client.unit.findMany({ select: { id: true, unitNo: true, status: true, holdExpiresAt: true, mandateId: true } }),
    client.booking.findMany({
      select: {
        id: true,
        code: true,
        unitId: true,
        unitLockKey: true,
        status: true,
        agreementValue: true,
        mandate: { select: { earningTriggerBps: true } },
        installments: { select: { amountDue: true, amountReceived: true } },
      },
    }),
    client.payment.groupBy({ by: ["bookingId"], _sum: { amount: true } }),
    client.commission.findMany({
      select: { id: true, bookingId: true, baseAmount: true, rateBps: true, amount: true, status: true, isAdjustment: true, reversesId: true },
    }),
  ]);
  const paid = new Map(payments.map((p) => [p.bookingId, p._sum.amount ?? 0]));
  const bookingsByUnit = new Map<string, typeof bookings>();
  for (const b of bookings) bookingsByUnit.set(b.unitId, [...(bookingsByUnit.get(b.unitId) ?? []), b]);
  const bookingById = new Map(bookings.map((b) => [b.id, b]));

  const checks: IntegrityCheck[] = [];
  const add = (key: string, label: string, violations: string[]) =>
    checks.push({ key, label, ok: violations.length === 0, violations: violations.slice(0, 20) });

  // 1. One live booking per unit, and unit status agrees with booking status.
  {
    const v: string[] = [];
    for (const u of units) {
      const active = (bookingsByUnit.get(u.id) ?? []).filter((b) => LIVE.has(b.status) || PENDING.has(b.status));
      if (active.length > 1) v.push(`${u.unitNo} has ${active.length} live bookings`);
      const b = active[0];
      if (u.status === "BOOKED" && b?.status !== "CONFIRMED") v.push(`${u.unitNo} is BOOKED without a confirmed booking`);
      if (u.status === "SOLD" && b?.status !== "AGREEMENT") v.push(`${u.unitNo} is SOLD without an agreement-stage booking`);
      if (u.status === "HOLD" && u.holdExpiresAt === null && !(b && PENDING.has(b.status))) {
        v.push(`${u.unitNo} is approval-locked with no pending booking`);
      }
      if (b && LIVE.has(b.status) && u.status !== (b.status === "CONFIRMED" ? "BOOKED" : "SOLD")) {
        v.push(`${u.unitNo} is ${u.status} but booking ${b.code} is ${b.status}`);
      }
      if (b && PENDING.has(b.status) && !(u.status === "HOLD" && u.holdExpiresAt === null)) {
        v.push(`${u.unitNo} is not locked although ${b.code} awaits approval`);
      }
      if (!u.mandateId && (bookingsByUnit.get(u.id)?.length ?? 0) > 0) v.push(`${u.unitNo} is outside the mandate but has bookings`);
    }
    add("one-booking-per-unit", "Each booked/sold unit has exactly one live booking, and statuses agree", v);
  }

  // 2. The database lock key mirrors booking liveness.
  {
    const v = bookings
      .filter((b) => ((LIVE.has(b.status) || PENDING.has(b.status)) ? b.unitLockKey !== b.unitId : b.unitLockKey !== null))
      .map((b) => `${b.code} (${b.status}) has lock key ${b.unitLockKey ?? "null"}`);
    add("lock-key", "Unit lock key is set only while a booking is live", v);
  }

  // 3. Payment schedules add up exactly to the agreement value.
  {
    const v = bookings
      .filter((b) => LIVE.has(b.status))
      .filter((b) => b.installments.reduce((s, i) => s + i.amountDue, 0) !== b.agreementValue)
      .map((b) => `${b.code} schedule ≠ agreement value`);
    add("schedule-sum", "Payment schedule totals equal the agreement value", v);
  }

  // 4. Money received is fully allocated, with nothing invented.
  {
    const v = bookings
      .filter((b) => b.installments.reduce((s, i) => s + i.amountReceived, 0) !== (paid.get(b.id) ?? 0))
      .map((b) => `${b.code}: allocated ≠ payments recorded`);
    add("allocation", "Instalment receipts equal recorded payments", v);
  }

  // 5. Agreement stage only once the earning trigger is met.
  {
    const v = bookings
      .filter((b) => b.status === "AGREEMENT")
      .filter((b) => (paid.get(b.id) ?? 0) < earningThreshold(b.agreementValue, b.mandate.earningTriggerBps))
      .map((b) => `${b.code} is at agreement stage below the collection trigger`);
    add("earning-trigger", "Agreement stage is reached only after the collection trigger", v);
  }

  // 6. Commission lines are arithmetically correct and consistent with booking state.
  {
    const v: string[] = [];
    for (const c of commissions) {
      const b = bookingById.get(c.bookingId);
      if (!b) continue;
      if (!c.isAdjustment) {
        if (c.amount !== applyBps(c.baseAmount, c.rateBps)) v.push(`${b.code}: commission ${c.id} amount ≠ base × rate`);
        if (c.baseAmount !== b.agreementValue) v.push(`${b.code}: commission base ≠ agreement value`);
        if (b.status === "CANCELLED" && !["REVERSED", "RECEIVED", "PAID"].includes(c.status)) {
          v.push(`${b.code} is cancelled but commission ${c.id} is still ${c.status}`);
        }
        if (b.status === "CANCELLED" && ["RECEIVED", "PAID"].includes(c.status)) {
          const hasAdj = commissions.some((a) => a.isAdjustment && a.reversesId === c.id && a.amount === -c.amount);
          if (!hasAdj) v.push(`${b.code}: settled commission ${c.id} has no clawback adjustment`);
        }
        if (b.status === "AGREEMENT" && c.status === "ACCRUED") v.push(`${b.code}: commission not earned at agreement stage`);
        if (b.status === "CONFIRMED" && c.status !== "ACCRUED") v.push(`${b.code}: commission earned before trigger`);
      }
      if ((PENDING.has(b.status) || b.status === "REJECTED") && !c.isAdjustment) v.push(`${b.code}: commission exists before confirmation`);
    }
    add("commission-math", "Commission lines equal base × snapshotted rate, and follow booking state", v);
  }

  return checks;
}
