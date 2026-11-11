import { SignJWT, jwtVerify } from "jose";
import type { Role } from "@/generated/prisma/enums";

/** Session token = HS256-signed JWT in an httpOnly cookie. Shared by proxy.ts and the server. */
export const SESSION_COOKIE = "solex_session";
export const SESSION_TTL_SECONDS = 8 * 60 * 60;

const ROLES: readonly Role[] = ["MANAGEMENT", "SALES", "FINANCE", "BROKER", "DEVELOPER"];

function secret(): Uint8Array {
  const value = process.env.SESSION_SECRET;
  if (!value || value.length < 32) {
    if (process.env.NODE_ENV === "production") throw new Error("SESSION_SECRET must be set (32+ chars).");
    return new TextEncoder().encode("solex-demo-insecure-development-secret-key");
  }
  return new TextEncoder().encode(value);
}

export type SessionClaims = { userId: string; role: Role };

export async function signSession(claims: SessionClaims): Promise<string> {
  return new SignJWT({ role: claims.role })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(claims.userId)
    .setIssuedAt()
    .setExpirationTime(`${SESSION_TTL_SECONDS}s`)
    .sign(secret());
}

export async function verifySession(token: string | undefined): Promise<SessionClaims | null> {
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, secret(), { algorithms: ["HS256"] });
    const role = payload.role as Role;
    if (!payload.sub || !ROLES.includes(role)) return null;
    return { userId: payload.sub, role };
  } catch {
    return null;
  }
}
