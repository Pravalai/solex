import type { Prisma } from "@/generated/prisma/client";
import type { Actor } from "./actor";

/**
 * Row-level data scoping. Every read and write that touches tenant data composes
 * one of these `where` clauses, so confidentiality is enforced in one place on
 * the server, never by hiding things in the UI.
 */
const NOTHING = { id: "__no_access__" } as const;

export function projectScope(actor: Actor): Prisma.ProjectWhereInput {
  switch (actor.role) {
    case "MANAGEMENT":
    case "FINANCE":
      return {};
    case "SALES":
      return { id: { in: actor.projectIds } };
    case "BROKER":
      return { brokerAccess: { some: { brokerId: actor.brokerId ?? NOTHING.id } } };
    case "DEVELOPER":
      return { developerId: actor.developerId ?? NOTHING.id };
  }
}

export function unitScope(actor: Actor): Prisma.UnitWhereInput {
  const base: Prisma.UnitWhereInput = { project: projectScope(actor) };
  // Brokers only ever see soleX's appointed inventory, never developer-retained units.
  if (actor.role === "BROKER") return { ...base, mandateId: { not: null } };
  return base;
}

export function leadScope(actor: Actor): Prisma.LeadWhereInput {
  switch (actor.role) {
    case "MANAGEMENT":
      return {};
    case "SALES":
      return { projectId: { in: actor.projectIds }, assignedToId: actor.userId };
    case "BROKER":
      return { brokerId: actor.brokerId ?? NOTHING.id };
    case "FINANCE":
    case "DEVELOPER":
      // Finance and developers never browse the lead pipeline; developers get aggregates only.
      return NOTHING;
  }
}

export function bookingScope(actor: Actor): Prisma.BookingWhereInput {
  switch (actor.role) {
    case "MANAGEMENT":
    case "FINANCE":
      return {};
    case "SALES":
      return { projectId: { in: actor.projectIds } };
    case "BROKER":
      return { brokerId: actor.brokerId ?? NOTHING.id };
    case "DEVELOPER":
      return { project: { developerId: actor.developerId ?? NOTHING.id } };
  }
}

export function commissionScope(actor: Actor): Prisma.CommissionWhereInput {
  switch (actor.role) {
    case "MANAGEMENT":
    case "FINANCE":
      return {};
    case "SALES":
      return { kind: "EMPLOYEE_INCENTIVE", userId: actor.userId };
    case "BROKER":
      return { kind: "BROKER_PAYOUT", brokerId: actor.brokerId ?? NOTHING.id };
    case "DEVELOPER":
      // A developer sees only the fee soleX charges them, never what soleX pays brokers or staff.
      return { kind: "DEVELOPER_FEE", project: { developerId: actor.developerId ?? NOTHING.id } };
  }
}
