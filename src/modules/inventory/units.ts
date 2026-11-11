import type { Prisma, Unit } from "@/generated/prisma/client";
import type { UnitStatus } from "@/generated/prisma/enums";
import { db, withTx, type Tx } from "@/lib/db";
import { addMinutes, now } from "@/lib/clock";
import { ConflictError, DomainError, NotFoundError } from "@/lib/errors";
import { assertTransition, type Machine } from "@/lib/state";
import type { Actor } from "@/modules/identity/actor";
import { assertCan } from "@/modules/identity/permissions";
import { unitScope } from "@/modules/identity/scope";
import { recordEvent } from "@/modules/audit/audit";

export const UNIT_MACHINE: Machine<UnitStatus> = {
  AVAILABLE: ["HOLD", "BLOCKED", "BOOKED"],
  HOLD: ["AVAILABLE", "HOLD", "BOOKED"],
  BLOCKED: ["AVAILABLE"],
  BOOKED: ["SOLD", "AVAILABLE"],
  SOLD: ["AVAILABLE"],
};

type HoldFields = Pick<Unit, "status" | "holdExpiresAt">;

/** Holds lapse lazily: an expired hold is treated as AVAILABLE everywhere. */
export function effectiveStatus(unit: HoldFields, at: Date = now()): UnitStatus {
  if (unit.status === "HOLD" && unit.holdExpiresAt && unit.holdExpiresAt.getTime() <= at.getTime()) {
    return "AVAILABLE";
  }
  return unit.status;
}

/** A HOLD with no expiry is the lock placed by a booking that is awaiting discount approval. */
export function isApprovalLock(unit: HoldFields): boolean {
  return unit.status === "HOLD" && unit.holdExpiresAt === null;
}

/**
 * Filter for units that `actorId` may take right now: available, holding an
 * expired hold, or holding this actor's own live hold.
 */
export function takeableBy(actorId: string, at: Date): Prisma.UnitWhereInput {
  return {
    OR: [
      { status: "AVAILABLE" },
      { status: "HOLD", holdExpiresAt: { lte: at } },
      { status: "HOLD", holdById: actorId, holdExpiresAt: { not: null } },
    ],
  };
}

/**
 * The only way unit status changes. A conditional update matches the expected
 * version (optimistic lock) plus any extra guard. If another user got there
 * first, zero rows match and the command fails with a ConflictError: no
 * last-writer-wins, no double booking.
 */
export async function transitionUnit(
  tx: Tx,
  unit: Unit,
  to: UnitStatus,
  opts: {
    where?: Prisma.UnitWhereInput;
    data?: Prisma.UnitUncheckedUpdateManyInput;
    conflictMessage?: string;
  } = {},
): Promise<Unit> {
  assertTransition(UNIT_MACHINE, "Unit", effectiveStatus(unit), to);
  const result = await tx.unit.updateMany({
    where: { id: unit.id, version: unit.version, ...opts.where },
    data: {
      status: to,
      version: { increment: 1 },
      ...(to === "HOLD" ? {} : { holdById: null, holdExpiresAt: null }),
      ...opts.data,
    },
  });
  if (result.count !== 1) {
    throw new ConflictError(
      opts.conflictMessage ?? `Unit ${unit.unitNo} was changed by someone else. Refresh and try again.`,
    );
  }
  return tx.unit.findUniqueOrThrow({ where: { id: unit.id } });
}

export async function getScopedUnit(actor: Actor, unitId: string, client: Tx = db) {
  const unit = await client.unit.findFirst({
    where: { AND: [{ id: unitId }, unitScope(actor)] },
    include: { mandate: true, tower: true, project: true },
  });
  if (!unit) throw new NotFoundError("Unit");
  return unit;
}

type MandateWindow = { status: string; startDate: Date; endDate: Date };

export function assertSellable(unit: { unitNo: string; mandate: MandateWindow | null }, at: Date): void {
  if (!unit.mandate) {
    throw new DomainError("NOT_IN_MANDATE", `Unit ${unit.unitNo} is not part of the soleX appointed inventory.`);
  }
  if (unit.mandate.status !== "ACTIVE" || at < unit.mandate.startDate || at > unit.mandate.endDate) {
    throw new DomainError("MANDATE_INACTIVE", "The mandate covering this unit is not active.");
  }
}

/** Places (or extends) a time-boxed hold so a sales exec can close with a customer. */
export async function holdUnit(actor: Actor, unitId: string, expectedVersion: number): Promise<Unit> {
  assertCan(actor, "inventory.hold");
  return withTx(async (tx) => {
    const unit = await getScopedUnit(actor, unitId, tx);
    const at = now();
    assertSellable(unit, at);
    if (unit.version !== expectedVersion) {
      throw new ConflictError(`Unit ${unit.unitNo} was changed by someone else. Refresh and try again.`);
    }
    const current = effectiveStatus(unit, at);
    if (current === "HOLD" && unit.holdById !== actor.userId) {
      throw new ConflictError(`Unit ${unit.unitNo} is already on hold for another customer.`);
    }
    if (current !== "AVAILABLE" && current !== "HOLD") {
      throw new ConflictError(`Unit ${unit.unitNo} is no longer available.`);
    }
    if (isApprovalLock(unit)) {
      throw new ConflictError(`Unit ${unit.unitNo} is locked by a booking awaiting approval.`);
    }
    const holdMinutes = unit.mandate!.holdMinutes;
    const expiresAt = addMinutes(at, holdMinutes);
    const updated = await transitionUnit(tx, unit, "HOLD", {
      where: takeableBy(actor.userId, at),
      data: { holdById: actor.userId, holdExpiresAt: expiresAt },
      conflictMessage: `Unit ${unit.unitNo} is no longer available.`,
    });
    await recordEvent(tx, actor, {
      type: "UNIT_HELD",
      entityType: "Unit",
      entityId: unit.id,
      projectId: unit.projectId,
      summary: `${unit.unitNo} put on hold for ${holdMinutes} min`,
      data: { from: current, to: "HOLD", holdExpiresAt: expiresAt.toISOString() },
    });
    return updated;
  });
}

export async function releaseHold(actor: Actor, unitId: string): Promise<Unit> {
  assertCan(actor, "inventory.hold");
  return withTx(async (tx) => {
    const unit = await getScopedUnit(actor, unitId, tx);
    if (effectiveStatus(unit) !== "HOLD") {
      throw new DomainError("NOT_HELD", `Unit ${unit.unitNo} is not on hold.`);
    }
    if (isApprovalLock(unit)) {
      throw new DomainError("APPROVAL_LOCK", `Unit ${unit.unitNo} is locked by a booking awaiting approval.`);
    }
    if (unit.holdById !== actor.userId && actor.role !== "MANAGEMENT") {
      throw new DomainError("NOT_YOUR_HOLD", "Only the person who placed the hold, or management, can release it.");
    }
    const updated = await transitionUnit(tx, unit, "AVAILABLE");
    await recordEvent(tx, actor, {
      type: "UNIT_RELEASED",
      entityType: "Unit",
      entityId: unit.id,
      projectId: unit.projectId,
      summary: `${unit.unitNo} hold released`,
      data: { from: "HOLD", to: "AVAILABLE" },
    });
    return updated;
  });
}
