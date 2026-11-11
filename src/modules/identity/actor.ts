import { db, type Tx } from "@/lib/db";
import type { Role } from "@/generated/prisma/enums";

/**
 * The authenticated principal every service call runs as. It is rebuilt from the
 * database on each request, so deactivating a user or changing an allocation
 * takes effect immediately (no stale claims in the cookie).
 */
export type Actor = {
  userId: string;
  name: string;
  title: string;
  role: Role;
  brokerId: string | null;
  developerId: string | null;
  /** Projects the user is allocated to (only meaningful for SALES). */
  projectIds: string[];
};

export async function loadActor(userId: string, client: Tx = db): Promise<Actor | null> {
  const user = await client.user.findUnique({
    where: { id: userId },
    include: { allocations: { select: { projectId: true } } },
  });
  if (!user || !user.active) return null;
  return {
    userId: user.id,
    name: user.name,
    title: user.title,
    role: user.role,
    brokerId: user.brokerId,
    developerId: user.developerId,
    projectIds: user.allocations.map((a) => a.projectId),
  };
}

export { INTERNAL_ROLES, isInternal, homePathFor } from "./roles";
