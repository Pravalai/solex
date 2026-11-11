import type { UnitStatus } from "@/generated/prisma/enums";
import { db } from "@/lib/db";
import { daysBetween, now } from "@/lib/clock";
import { NotFoundError } from "@/lib/errors";
import type { Actor } from "@/modules/identity/actor";
import { isInternal } from "@/modules/identity/roles";
import { projectScope, unitScope } from "@/modules/identity/scope";
import { effectiveStatus, isApprovalLock } from "@/modules/inventory/units";

/**
 * Inventory read models. The same stacking plan is served to internal users,
 * brokers and developers, but each gets a different projection:
 *  - brokers: appointed units only, status collapsed to available / unavailable, no holder or buyer
 *  - developers: all units incl. retained ones, real status, no holder names
 *  - internal: everything, including who holds a unit and the live booking
 */
export type InventoryCounts = Record<UnitStatus, number> & { total: number; retained: number };

function emptyCounts(): InventoryCounts {
  return { AVAILABLE: 0, HOLD: 0, BLOCKED: 0, BOOKED: 0, SOLD: 0, total: 0, retained: 0 };
}

export async function listProjects(actor: Actor) {
  const at = now();
  const projects = await db.project.findMany({
    where: projectScope(actor),
    orderBy: { name: "asc" },
    include: {
      developer: { select: { name: true } },
      mandates: { where: { status: "ACTIVE" } },
      units: { select: { status: true, holdExpiresAt: true, mandateId: true, listPrice: true } },
      bookings: { where: { status: { in: ["CONFIRMED", "AGREEMENT"] } }, select: { agreementValue: true } },
    },
  });
  return projects.map((p) => {
    const mandate = p.mandates[0] ?? null;
    const counts = emptyCounts();
    let appointedValue = 0;
    let availableValue = 0;
    for (const u of p.units) {
      if (!u.mandateId) {
        counts.retained++;
        continue;
      }
      const s = effectiveStatus(u, at);
      counts[s]++;
      counts.total++;
      appointedValue += u.listPrice;
      if (s === "AVAILABLE") availableValue += u.listPrice;
    }
    const soldValue = p.bookings.reduce((s, b) => s + b.agreementValue, 0);
    const absorbed = counts.BOOKED + counts.SOLD;
    const base = {
      id: p.id,
      code: p.code,
      name: p.name,
      city: p.city,
      locality: p.locality,
      reraNo: p.reraNo,
      developerName: p.developer.name,
      counts,
      availableValue,
      mandate: mandate && {
        code: mandate.code,
        endDate: mandate.endDate,
        daysLeft: daysBetween(at, mandate.endDate),
      },
    };
    if (actor.role === "BROKER") {
      // Partners see what they can sell, not soleX's targets, values or commercials.
      return { ...base, counts: { ...counts, retained: 0 }, appointedValue: null, soldValue: null, targetUnits: null, absorbed: null };
    }
    return { ...base, appointedValue, soldValue, targetUnits: mandate?.targetUnits ?? null, absorbed };
  });
}

export type StackUnit = {
  id: string;
  unitNo: string;
  floor: number;
  stack: number;
  config: string;
  superSqft: number;
  carpetSqft: number;
  facing: string;
  listPrice: number;
  /** For brokers: AVAILABLE or BLOCKED ("unavailable"); others: effective status. */
  status: UnitStatus;
  retained: boolean;
  approvalLock: boolean;
  heldByMe: boolean;
  holdExpiresAt: string | null;
  version: number;
};

export async function getStackingPlan(actor: Actor, projectId: string) {
  const project = await db.project.findFirst({
    where: { AND: [{ id: projectId }, projectScope(actor)] },
    include: {
      developer: { select: { name: true } },
      mandates: { where: { status: "ACTIVE" } },
      towers: { orderBy: { name: "asc" } },
      planStages: { orderBy: { seq: "asc" } },
    },
  });
  if (!project) throw new NotFoundError("Project");
  const at = now();
  const units = await db.unit.findMany({
    where: { AND: [{ projectId: project.id }, unitScope(actor)] },
    orderBy: [{ floor: "desc" }, { stack: "asc" }],
  });

  const towers = project.towers
    .map((t) => {
      const towerUnits = units.filter((u) => u.towerId === t.id);
      if (towerUnits.length === 0) return null;
      const floors = [...new Set(towerUnits.map((u) => u.floor))].sort((a, b) => b - a);
      return {
        id: t.id,
        name: t.name,
        retained: towerUnits.every((u) => !u.mandateId),
        floors: floors.map((floor) => ({
          floor,
          units: towerUnits
            .filter((u) => u.floor === floor)
            .map((u): StackUnit => {
              const s = effectiveStatus(u, at);
              return {
                id: u.id,
                unitNo: u.unitNo,
                floor: u.floor,
                stack: u.stack,
                config: u.config,
                superSqft: u.superSqft,
                carpetSqft: u.carpetSqft,
                facing: u.facing,
                listPrice: u.listPrice,
                status: actor.role === "BROKER" ? (s === "AVAILABLE" ? "AVAILABLE" : "BLOCKED") : s,
                retained: !u.mandateId,
                approvalLock: isInternal(actor) && isApprovalLock(u),
                heldByMe: s === "HOLD" && u.holdById === actor.userId,
                holdExpiresAt: isInternal(actor) && s === "HOLD" && u.holdExpiresAt ? u.holdExpiresAt.toISOString() : null,
                version: u.version,
              };
            }),
        })),
      };
    })
    .filter((t) => t !== null);

  const mandate = project.mandates[0] ?? null;
  return {
    project: {
      id: project.id,
      code: project.code,
      name: project.name,
      city: project.city,
      locality: project.locality,
      reraNo: project.reraNo,
      possessionDate: project.possessionDate,
      baseRatePerSqft: project.baseRatePerSqft,
      paymentPlanName: project.paymentPlanName,
      developerName: project.developer.name,
    },
    planStages: project.planStages.map((s) => ({ label: s.label, bps: s.bps, dueOffsetDays: s.dueOffsetDays })),
    // Commercial terms are soleX-internal; developers see them because they signed them; brokers never.
    mandate:
      mandate && actor.role !== "BROKER"
        ? {
            code: mandate.code,
            startDate: mandate.startDate,
            endDate: mandate.endDate,
            daysLeft: daysBetween(at, mandate.endDate),
            targetUnits: mandate.targetUnits,
            soleXFeeBps: mandate.soleXFeeBps,
            feeTierUnits: mandate.feeTierUnits,
            feeTierBps: mandate.feeTierBps,
            earningTriggerBps: mandate.earningTriggerBps,
            execMaxDiscountBps: mandate.execMaxDiscountBps,
            mgmtMaxDiscountBps: mandate.mgmtMaxDiscountBps,
            holdMinutes: mandate.holdMinutes,
            attributionWindowDays: mandate.attributionWindowDays,
            forfeitureBps: mandate.forfeitureBps,
            // Broker payout and staff incentive rates are soleX's own cost structure.
            brokerPayoutBps: isInternal(actor) ? mandate.brokerPayoutBps : null,
            incentiveBps: isInternal(actor) ? mandate.incentiveBps : null,
          }
        : null,
    towers,
  };
}

/** Internal unit drawer: price breakdown, live booking, hold owner and full history. */
export async function getUnitDetail(actor: Actor, unitId: string) {
  if (!isInternal(actor)) throw new NotFoundError("Unit");
  const unit = await db.unit.findFirst({
    where: { AND: [{ id: unitId }, unitScope(actor)] },
    include: {
      tower: { select: { name: true } },
      holdBy: { select: { name: true } },
      mandate: { select: { code: true } },
      bookings: {
        orderBy: { bookedAt: "desc" },
        select: { id: true, code: true, status: true, agreementValue: true, bookedAt: true, customer: { select: { name: true } } },
      },
    },
  });
  if (!unit) throw new NotFoundError("Unit");
  const bookingIds = unit.bookings.map((b) => b.id);
  const history = await db.auditEvent.findMany({
    where: { OR: [{ entityType: "Unit", entityId: unit.id }, { entityType: "Booking", entityId: { in: bookingIds } }] },
    orderBy: { at: "desc" },
    take: 25,
    select: { id: true, at: true, actorName: true, type: true, summary: true },
  });
  const at = now();
  return {
    id: unit.id,
    unitNo: unit.unitNo,
    tower: unit.tower.name,
    floor: unit.floor,
    config: unit.config,
    carpetSqft: unit.carpetSqft,
    superSqft: unit.superSqft,
    facing: unit.facing,
    status: effectiveStatus(unit, at),
    retained: !unit.mandateId,
    mandateCode: unit.mandate?.code ?? null,
    approvalLock: isApprovalLock(unit),
    holdBy: effectiveStatus(unit, at) === "HOLD" ? (unit.holdBy?.name ?? null) : null,
    heldByMe: effectiveStatus(unit, at) === "HOLD" && unit.holdById === actor.userId,
    holdExpiresAt: effectiveStatus(unit, at) === "HOLD" ? (unit.holdExpiresAt?.toISOString() ?? null) : null,
    version: unit.version,
    price: {
      basicAmount: unit.basicAmount,
      floorRiseAmount: unit.floorRiseAmount,
      plcAmount: unit.plcAmount,
      parkingAmount: unit.parkingAmount,
      otherCharges: unit.otherCharges,
      listPrice: unit.listPrice,
    },
    bookings: unit.bookings.map((b) => ({ ...b, customerName: b.customer.name })),
    history,
  };
}
