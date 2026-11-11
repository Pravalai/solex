import type { Role } from "@/generated/prisma/enums";

/** Pure role helpers, safe to import from proxy.ts and client components (no DB access). */
export const INTERNAL_ROLES: Role[] = ["MANAGEMENT", "SALES", "FINANCE"];

export function isInternal(actor: { role: Role }): boolean {
  return INTERNAL_ROLES.includes(actor.role);
}

export function homePathFor(role: Role): string {
  switch (role) {
    case "MANAGEMENT":
      return "/command-centre";
    case "SALES":
      return "/leads";
    case "FINANCE":
      return "/finance";
    case "BROKER":
      return "/broker";
    case "DEVELOPER":
      return "/developer";
  }
}

/** Which roles may enter which surface. Enforced in proxy.ts and again in every page/action. */
export function surfaceFor(pathname: string): "broker" | "developer" | "internal" {
  if (pathname === "/broker" || pathname.startsWith("/broker/")) return "broker";
  if (pathname === "/developer" || pathname.startsWith("/developer/")) return "developer";
  return "internal";
}

export function roleMayEnter(role: Role, pathname: string): boolean {
  const surface = surfaceFor(pathname);
  if (surface === "broker") return role === "BROKER";
  if (surface === "developer") return role === "DEVELOPER";
  return INTERNAL_ROLES.includes(role);
}

export const ROLE_LABEL: Record<Role, string> = {
  MANAGEMENT: "soleX Management",
  SALES: "soleX Sales",
  FINANCE: "soleX Finance",
  BROKER: "Channel Partner",
  DEVELOPER: "Developer",
};
