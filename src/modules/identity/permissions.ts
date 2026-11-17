import type { Role } from "@/generated/prisma/enums";
import { ForbiddenError } from "@/lib/errors";
import type { Actor } from "./actor";

/**
 * Action-level permissions. Roles map to permission sets in one place, so adding
 * a role (e.g. "Sales Manager") is a data change here, not a code hunt. In
 * production this matrix would live in the database and be editable by admins.
 */
export type Permission =
  | "command.view"
  | "project.view"
  | "inventory.hold"
  | "lead.view"
  | "lead.create"
  | "lead.update"
  | "lead.reassign"
  | "lead.register"
  | "visit.manage"
  | "visit.request"
  | "call.place"
  | "call.view"
  | "booking.view"
  | "booking.create"
  | "discount.approve.management"
  | "discount.approve.developer"
  | "booking.cancel"
  | "payment.record"
  | "payment.remind"
  | "commission.view"
  | "commission.approve"
  | "commission.settle"
  | "finance.view"
  | "audit.view"
  | "report.export";

const MATRIX: Record<Role, readonly Permission[]> = {
  MANAGEMENT: [
    "command.view",
    "project.view",
    "inventory.hold",
    "lead.view",
    "lead.create",
    "lead.update",
    "lead.reassign",
    "visit.manage",
    "call.view",
    "booking.view",
    "booking.create",
    "discount.approve.management",
    "booking.cancel",
    "payment.remind",
    "commission.view",
    "commission.approve",
    "commission.settle",
    "finance.view",
    "audit.view",
    "report.export",
  ],
  SALES: [
    "project.view",
    "inventory.hold",
    "lead.view",
    "lead.create",
    "lead.update",
    "visit.manage",
    "call.place",
    "call.view",
    "booking.view",
    "booking.create",
  ],
  FINANCE: [
    "project.view",
    "booking.view",
    "payment.record",
    "payment.remind",
    "commission.view",
    "commission.settle",
    "finance.view",
    "audit.view",
  ],
  BROKER: ["project.view", "lead.view", "lead.register", "visit.request", "booking.view", "commission.view"],
  DEVELOPER: [
    "project.view",
    "booking.view",
    "discount.approve.developer",
    "commission.view",
    "report.export",
  ],
};

export function can(actor: Pick<Actor, "role">, permission: Permission): boolean {
  return MATRIX[actor.role].includes(permission);
}

export function assertCan(actor: Pick<Actor, "role">, permission: Permission): void {
  if (!can(actor, permission)) throw new ForbiddenError();
}

export function permissionsFor(role: Role): readonly Permission[] {
  return MATRIX[role];
}
