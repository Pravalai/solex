import { db } from "@/lib/db";
import { addDays, now } from "@/lib/clock";
import { loadActor, type Actor } from "@/modules/identity/actor";
import { priceUnit } from "@/modules/inventory/pricing";

/**
 * Minimal fictional world for integration tests:
 *  - Developer A owns project P1 (active mandate, 6 units, one retained by the developer)
 *  - Developer B owns project P2 (active mandate, 2 units)
 *  - Brokers A and B both have access to P1; only broker B has access to P2
 *  - sales1 is allocated to P1, sales2 to P2
 */
export async function buildWorld() {
  const at = now();
  const devA = await db.developer.create({
    data: { name: "Test Dev A", city: "Gurugram", contactName: "A", contactEmail: "a@dev.test" },
  });
  const devB = await db.developer.create({
    data: { name: "Test Dev B", city: "Pune", contactName: "B", contactEmail: "b@dev.test" },
  });

  async function project(code: string, developerId: string) {
    const p = await db.project.create({
      data: {
        code,
        name: `Project ${code}`,
        developerId,
        city: "Gurugram",
        locality: "Sector 1",
        reraNo: `RERA-${code}`,
        type: "Residential apartments",
        possessionDate: addDays(at, 900),
        baseRatePerSqft: 10_000,
        paymentPlanName: "Construction linked",
      },
    });
    await db.paymentPlanStage.createMany({
      data: [
        { projectId: p.id, seq: 1, label: "Booking amount", bps: 1000, dueOffsetDays: 0 },
        { projectId: p.id, seq: 2, label: "Within 30 days", bps: 1000, dueOffsetDays: 30 },
        { projectId: p.id, seq: 3, label: "On slab casting", bps: 3000, dueOffsetDays: 180 },
        { projectId: p.id, seq: 4, label: "On possession", bps: 5000, dueOffsetDays: 720 },
      ],
    });
    const mandate = await db.mandate.create({
      data: {
        code: `M-${code}`,
        projectId: p.id,
        developerId,
        status: "ACTIVE",
        startDate: addDays(at, -60),
        endDate: addDays(at, 300),
        targetUnits: 10,
        soleXFeeBps: 300,
        feeTierUnits: 2,
        feeTierBps: 350,
        brokerPayoutBps: 150,
        incentiveBps: 25,
        earningTriggerBps: 2000,
        execMaxDiscountBps: 100,
        mgmtMaxDiscountBps: 300,
        holdMinutes: 30,
        attributionWindowDays: 90,
        forfeitureBps: 200,
      },
    });
    const tower = await db.tower.create({ data: { projectId: p.id, name: "A", floors: 3, unitsPerFloor: 2 } });
    return { project: p, mandate, tower };
  }

  const p1 = await project("P1", devA.id);
  const p2 = await project("P2", devB.id);

  async function unit(projectId: string, towerId: string, mandateId: string | null, floor: number, stack: number) {
    const price = priceUnit({ superSqft: 1500, floor, facing: "Corner", config: "3BHK", baseRatePerSqft: 10_000 });
    return db.unit.create({
      data: {
        projectId,
        towerId,
        mandateId,
        unitNo: `A-${floor}0${stack}`,
        floor,
        stack,
        config: "3BHK",
        carpetSqft: 1100,
        superSqft: 1500,
        facing: "Corner",
        ...price,
      },
    });
  }
  const p1Units = [];
  for (let f = 1; f <= 3; f++) for (let s = 1; s <= 2; s++) {
    // A-302 is retained by the developer: not part of the soleX mandate.
    p1Units.push(await unit(p1.project.id, p1.tower.id, f === 3 && s === 2 ? null : p1.mandate.id, f, s));
  }
  const p2Units = [await unit(p2.project.id, p2.tower.id, p2.mandate.id, 1, 1), await unit(p2.project.id, p2.tower.id, p2.mandate.id, 1, 2)];

  const brokerA = await db.broker.create({
    data: { code: "BRK-A", firmName: "Alpha Realty", contactName: "Al", phone: "9000000001", email: "alpha@b.test", reraAgentNo: "AG-1", city: "Gurugram" },
  });
  const brokerB = await db.broker.create({
    data: { code: "BRK-B", firmName: "Beta Homes", contactName: "Be", phone: "9000000002", email: "beta@b.test", reraAgentNo: "AG-2", city: "Gurugram" },
  });
  await db.brokerProjectAccess.createMany({
    data: [
      { brokerId: brokerA.id, projectId: p1.project.id },
      { brokerId: brokerB.id, projectId: p1.project.id },
      { brokerId: brokerB.id, projectId: p2.project.id },
    ],
  });

  async function user(email: string, role: "MANAGEMENT" | "SALES" | "FINANCE" | "BROKER" | "DEVELOPER", extra: { brokerId?: string; developerId?: string; projects?: string[] } = {}) {
    const u = await db.user.create({
      data: { email, name: email.split("@")[0], title: role, passwordHash: "x", role, brokerId: extra.brokerId, developerId: extra.developerId },
    });
    for (const projectId of extra.projects ?? []) await db.employeeAllocation.create({ data: { userId: u.id, projectId } });
    return (await loadActor(u.id)) as Actor;
  }

  const actors = {
    mgmt: await user("mgmt@solex.test", "MANAGEMENT"),
    sales1: await user("sales1@solex.test", "SALES", { projects: [p1.project.id] }),
    sales2: await user("sales2@solex.test", "SALES", { projects: [p2.project.id] }),
    finance: await user("finance@solex.test", "FINANCE"),
    brokerA: await user("a@broker.test", "BROKER", { brokerId: brokerA.id }),
    brokerB: await user("b@broker.test", "BROKER", { brokerId: brokerB.id }),
    devA: await user("a@developer.test", "DEVELOPER", { developerId: devA.id }),
    devB: await user("b@developer.test", "DEVELOPER", { developerId: devB.id }),
  };

  return { devA, devB, p1, p2, p1Units, p2Units, brokerA, brokerB, actors };
}

export type World = Awaited<ReturnType<typeof buildWorld>>;

let phoneSeq = 0;
export function nextPhone(): string {
  phoneSeq++;
  return `98${String(10_000_000 + phoneSeq).slice(-8)}`;
}

export async function freshUnit(unitId: string) {
  return db.unit.findUniqueOrThrow({ where: { id: unitId } });
}
