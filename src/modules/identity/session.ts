import { cache } from "react";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import bcrypt from "bcryptjs";
import type { Role } from "@/generated/prisma/enums";
import { db } from "@/lib/db";
import { loadActor, type Actor } from "./actor";
import { can, type Permission } from "./permissions";
import { homePathFor } from "./roles";
import { SESSION_COOKIE, SESSION_TTL_SECONDS, signSession, verifySession } from "./token";

/**
 * Data-access-layer entry point. Pages and actions call `requireActor`; the
 * actor is re-read from the database on every request, so a role change or a
 * deactivation takes effect immediately.
 */
export const getActor = cache(async (): Promise<Actor | null> => {
  const store = await cookies();
  const claims = await verifySession(store.get(SESSION_COOKIE)?.value);
  if (!claims) return null;
  const actor = await loadActor(claims.userId);
  if (!actor || actor.role !== claims.role) return null;
  return actor;
});

export async function requireActor(opts: { roles?: Role[]; permission?: Permission } = {}): Promise<Actor> {
  const actor = await getActor();
  if (!actor) redirect("/login");
  if ((opts.roles && !opts.roles.includes(actor.role)) || (opts.permission && !can(actor, opts.permission))) {
    redirect(homePathFor(actor.role));
  }
  return actor;
}

const DUMMY_HASH = bcrypt.hashSync("not-a-real-password", 10);

export async function signIn(email: string, password: string): Promise<Actor | null> {
  const user = await db.user.findUnique({ where: { email: email.trim().toLowerCase() } });
  // Always run bcrypt so response time does not reveal whether the email exists.
  const ok = await bcrypt.compare(password, user?.passwordHash ?? DUMMY_HASH);
  if (!user || !ok || !user.active) return null;
  const token = await signSession({ userId: user.id, role: user.role });
  (await cookies()).set(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: SESSION_TTL_SECONDS,
  });
  return loadActor(user.id);
}

export async function signOut(): Promise<void> {
  (await cookies()).delete(SESSION_COOKIE);
}
