/**
 * Deterministic demo seed. Fictional data only.
 *
 * Master data (developers, projects, mandates, inventory, people) is inserted
 * directly. All *history* (leads, calls, visits, bookings, approvals,
 * payments, commission settlement, a cancellation) is replayed through the real
 * domain services with the injectable clock set back in time. The seeded data
 * therefore obeys exactly the same rules as live usage, and the integrity checker
 * passes on it.
 */
import "dotenv/config";
import bcrypt from "bcryptjs";
import { db } from "../src/lib/db";
import { addDays, addMinutes, DAY, now as clockNow, setClock } from "../src/lib/clock";
import { applyBps } from "../src/lib/money";
import { loadActor, type Actor } from "../src/modules/identity/actor";
import { priceUnit } from "../src/modules/inventory/pricing";
import { holdUnit } from "../src/modules/inventory/units";
import {
  changeLeadStage,
  completeVisit,
  createLead,
  logActivity,
  markNoShow,
  scheduleVisit,
} from "../src/modules/crm/leads";
import { approveBooking, cancelBooking, createBooking, rejectBooking } from "../src/modules/sales/bookings";
import { recordPayment, type PaymentMode } from "../src/modules/finance/payments";
import { settleCommission } from "../src/modules/finance/commissions";
import { runIntegrityChecks } from "../src/modules/reporting/integrity";
import { endCall, startCall } from "../src/modules/calls/calls";
import { willAnswer } from "../src/modules/calls/script";
import type { LeadSource } from "../src/generated/prisma/enums";

// ---------------------------------------------------------------- utilities
function mulberry32(seed: number) {
  let a = seed;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rand = mulberry32(20261103);
const chance = (p: number) => rand() < p;
const pick = <T,>(arr: readonly T[]): T => arr[Math.floor(rand() * arr.length)];
const between = (min: number, max: number) => min + rand() * (max - min);
const hoursLater = (d: Date, min: number, max: number) => new Date(d.getTime() + between(min, max) * 3_600_000);
const atHour = (d: Date, hour: number) => {
  const x = new Date(d);
  x.setHours(hour, Math.floor(rand() * 4) * 15, 0, 0);
  return x;
};

const REAL_NOW = new Date();
const START = addDays(REAL_NOW, -185);

const FIRST = ["Aarav", "Vivaan", "Aditya", "Ishaan", "Kabir", "Reyansh", "Arnav", "Dhruv", "Vihaan", "Rudra", "Ananya", "Diya", "Saanvi", "Myra", "Aadhya", "Kiara", "Navya", "Ira", "Tara", "Meher", "Rahul", "Pooja", "Siddharth", "Nikita", "Karan", "Shreya", "Varun", "Ritu", "Manish", "Deepa", "Gaurav", "Swati", "Harsh", "Neelam", "Akash", "Payal"];
const LAST = ["Sharma", "Verma", "Gupta", "Malhotra", "Bhatia", "Chopra", "Khanna", "Agarwal", "Bansal", "Sethi", "Nair", "Menon", "Reddy", "Rao", "Iyer", "Pillai", "Kulkarni", "Deshpande", "Joshi", "Patil", "Banerjee", "Mukherjee", "Das", "Bose", "Saxena", "Mathur", "Ahuja", "Arora", "Kapoor", "Tandon"];
let phoneCounter = 0;
const fakePhone = () => {
  phoneCounter++;
  const prefix = pick(["98", "97", "99", "88", "70", "81"]);
  return `${prefix}${String(30_000_000 + phoneCounter * 7919).slice(-8)}`;
};

// ------------------------------------------------------------ master data
type ProjectSpec = {
  code: string;
  name: string;
  developer: "ARAVALI" | "MERIDIAN";
  city: string;
  locality: string;
  rate: number;
  towers: { name: string; floors: number; inMandate: boolean }[];
  plan: { name: string; stages: [string, number, number][] };
  mandate: {
    startDaysAgo: number;
    endInDays: number;
    targetUnits: number;
    fee: number;
    tierUnits?: number;
    tierBps?: number;
    broker: number;
    incentive: number;
    trigger: number;
    exec: number;
    mgmt: number;
    hold: number;
    attribution: number;
    forfeiture: number;
  };
  leads: number;
};

const PROJECTS: ProjectSpec[] = [
  {
    code: "AGR",
    name: "Aravali Greens",
    developer: "ARAVALI",
    city: "Gurugram",
    locality: "Sector 79, Southern Peripheral Road",
    rate: 11_500,
    towers: [
      { name: "A", floors: 10, inMandate: true },
      { name: "B", floors: 10, inMandate: true },
      { name: "C", floors: 6, inMandate: false },
    ],
    plan: {
      name: "Construction linked plan",
      stages: [
        ["Booking amount", 1000, 0],
        ["Within 30 days of booking", 1000, 30],
        ["On completion of foundation", 2000, 120],
        ["On completion of 10th floor slab", 2000, 240],
        ["On offer of possession", 4000, 720],
      ],
    },
    mandate: { startDaysAgo: 185, endInDays: 545, targetUnits: 60, fee: 300, tierUnits: 25, tierBps: 350, broker: 150, incentive: 25, trigger: 2000, exec: 100, mgmt: 300, hold: 45, attribution: 90, forfeiture: 200 },
    leads: 85,
  },
  {
    code: "AGC",
    name: "Aravali Courtyard",
    developer: "ARAVALI",
    city: "Gurugram",
    locality: "Sector 102, Dwarka Expressway",
    rate: 8_200,
    towers: [{ name: "T1", floors: 8, inMandate: true }],
    plan: {
      name: "10:10:80 subvention plan",
      stages: [
        ["Booking amount", 1000, 0],
        ["Within 45 days of booking", 1000, 45],
        ["On offer of possession", 8000, 540],
      ],
    },
    mandate: { startDaysAgo: 150, endInDays: 40, targetUnits: 25, fee: 250, broker: 125, incentive: 20, trigger: 1500, exec: 50, mgmt: 250, hold: 30, attribution: 60, forfeiture: 250 },
    leads: 40,
  },
  {
    code: "MSK",
    name: "Meridian Skyline",
    developer: "MERIDIAN",
    city: "Pune",
    locality: "Baner–Balewadi High Street",
    rate: 9_800,
    towers: [{ name: "North", floors: 12, inMandate: true }],
    plan: {
      name: "Construction linked plan",
      stages: [
        ["Booking amount", 1000, 0],
        ["Within 30 days of booking", 1500, 30],
        ["On completion of plinth", 2500, 150],
        ["On offer of possession", 5000, 600],
      ],
    },
    mandate: { startDaysAgo: 125, endInDays: 420, targetUnits: 30, fee: 275, tierUnits: 15, tierBps: 325, broker: 150, incentive: 25, trigger: 2000, exec: 100, mgmt: 300, hold: 45, attribution: 90, forfeiture: 200 },
    leads: 55,
  },
];

// Four stacks per floor; each stack has a fixed layout.
const STACKS = [
  { config: "3BHK", superSqft: 1850, carpetSqft: 1350, facing: "Park facing" },
  { config: "2BHK", superSqft: 1250, carpetSqft: 900, facing: "Inner court" },
  { config: "3BHK", superSqft: 1650, carpetSqft: 1200, facing: "Corner" },
  { config: "2BHK", superSqft: 1150, carpetSqft: 850, facing: "Road facing" },
];

async function reset() {
  // Children first.
  await db.notification.deleteMany();
  await db.auditEvent.deleteMany();
  await db.commission.deleteMany();
  await db.payment.deleteMany();
  await db.installment.deleteMany();
  await db.booking.deleteMany();
  await db.siteVisit.deleteMany();
  await db.callInsight.deleteMany();
  await db.call.deleteMany();
  await db.leadActivity.deleteMany();
  await db.lead.deleteMany();
  await db.customer.deleteMany();
  await db.employeeAllocation.deleteMany();
  await db.brokerProjectAccess.deleteMany();
  await db.user.deleteMany();
  await db.broker.deleteMany();
  await db.unit.deleteMany();
  await db.tower.deleteMany();
  await db.mandate.deleteMany();
  await db.paymentPlanStage.deleteMany();
  await db.project.deleteMany();
  await db.developer.deleteMany();
}

async function seedMasterData() {
  const aravali = await db.developer.create({
    data: { name: "Aravali Habitats Pvt. Ltd.", city: "Gurugram", contactName: "Meera Iyer", contactEmail: "meera@aravali.demo", createdAt: START },
  });
  const meridian = await db.developer.create({
    data: { name: "Meridian Realty LLP", city: "Pune", contactName: "Sameer Patil", contactEmail: "sameer@meridian.demo", createdAt: START },
  });
  const devIds = { ARAVALI: aravali.id, MERIDIAN: meridian.id };

  const projects: Record<string, { id: string; spec: ProjectSpec }> = {};
  for (const spec of PROJECTS) {
    const project = await db.project.create({
      data: {
        code: spec.code,
        name: spec.name,
        developerId: devIds[spec.developer],
        city: spec.city,
        locality: spec.locality,
        reraNo: `RERA-${spec.city.slice(0, 3).toUpperCase()}-${spec.code}-2026-${100 + spec.leads}`,
        type: "Residential apartments",
        possessionDate: addDays(REAL_NOW, 900),
        baseRatePerSqft: spec.rate,
        paymentPlanName: spec.plan.name,
        createdAt: START,
      },
    });
    projects[spec.code] = { id: project.id, spec };
    await db.paymentPlanStage.createMany({
      data: spec.plan.stages.map(([label, bps, dueOffsetDays], i) => ({ projectId: project.id, seq: i + 1, label, bps, dueOffsetDays })),
    });
    const m = spec.mandate;
    const mandate = await db.mandate.create({
      data: {
        code: `SX-MND-${spec.code}-01`,
        projectId: project.id,
        developerId: devIds[spec.developer],
        status: "ACTIVE",
        startDate: addDays(REAL_NOW, -m.startDaysAgo),
        endDate: addDays(REAL_NOW, m.endInDays),
        targetUnits: m.targetUnits,
        soleXFeeBps: m.fee,
        feeTierUnits: m.tierUnits ?? null,
        feeTierBps: m.tierBps ?? null,
        brokerPayoutBps: m.broker,
        incentiveBps: m.incentive,
        earningTriggerBps: m.trigger,
        execMaxDiscountBps: m.exec,
        mgmtMaxDiscountBps: m.mgmt,
        holdMinutes: m.hold,
        attributionWindowDays: m.attribution,
        forfeitureBps: m.forfeiture,
        createdAt: addDays(REAL_NOW, -m.startDaysAgo),
      },
    });
    for (const t of spec.towers) {
      const tower = await db.tower.create({ data: { projectId: project.id, name: t.name, floors: t.floors, unitsPerFloor: 4 } });
      const units = [];
      for (let floor = 1; floor <= t.floors; floor++) {
        for (let s = 0; s < STACKS.length; s++) {
          const stack = STACKS[s];
          const price = priceUnit({ superSqft: stack.superSqft, floor, facing: stack.facing, config: stack.config, baseRatePerSqft: spec.rate });
          units.push({
            projectId: project.id,
            towerId: tower.id,
            mandateId: t.inMandate ? mandate.id : null,
            unitNo: `${t.name}-${floor}${String(s + 1).padStart(2, "0")}`,
            floor,
            stack: s + 1,
            config: stack.config,
            carpetSqft: stack.carpetSqft,
            superSqft: stack.superSqft,
            facing: stack.facing,
            ...price,
          });
        }
      }
      await db.unit.createMany({ data: units });
    }
  }

  const brokers = {
    prime: await db.broker.create({
      data: { code: "CP-0141", firmName: "Prime Estates", contactName: "Rohan Desai", phone: "9811100141", email: "rohan@primeestates.demo", reraAgentNo: "RC/HARERA/GGM/2024/141", city: "Gurugram", createdAt: START },
    }),
    urban: await db.broker.create({
      data: { code: "CP-0207", firmName: "UrbanKey Realty", contactName: "Ishita Sen", phone: "9811100207", email: "ishita@urbankey.demo", reraAgentNo: "RC/HARERA/GGM/2025/207", city: "Gurugram", createdAt: START },
    }),
    westside: await db.broker.create({
      data: { code: "CP-0318", firmName: "Westside Propmart", contactName: "Kunal Joshi", phone: "9822200318", email: "kunal@westside.demo", reraAgentNo: "A52100031800", city: "Pune", createdAt: START },
    }),
  };
  await db.brokerProjectAccess.createMany({
    data: [
      { brokerId: brokers.prime.id, projectId: projects.AGR.id },
      { brokerId: brokers.prime.id, projectId: projects.AGC.id },
      { brokerId: brokers.urban.id, projectId: projects.AGR.id },
      { brokerId: brokers.urban.id, projectId: projects.MSK.id },
      { brokerId: brokers.westside.id, projectId: projects.MSK.id },
    ],
  });

  const passwordHash = await bcrypt.hash("demo1234", 10);
  const mkUser = async (
    email: string,
    name: string,
    title: string,
    role: "MANAGEMENT" | "SALES" | "FINANCE" | "BROKER" | "DEVELOPER",
    extra: { brokerId?: string; developerId?: string; projects?: string[] } = {},
  ) => {
    const u = await db.user.create({
      data: { email, name, title, role, passwordHash, brokerId: extra.brokerId, developerId: extra.developerId, createdAt: START },
    });
    for (const projectId of extra.projects ?? []) await db.employeeAllocation.create({ data: { userId: u.id, projectId } });
    return (await loadActor(u.id))!;
  };

  const people = {
    neha: await mkUser("neha@solex.demo", "Neha Kapoor", "Director, Sales Operations", "MANAGEMENT"),
    arjun: await mkUser("arjun@solex.demo", "Arjun Mehta", "Senior Sales Manager", "SALES", { projects: [projects.AGR.id, projects.AGC.id] }),
    sara: await mkUser("sara@solex.demo", "Sara Thomas", "Sales Manager", "SALES", { projects: [projects.AGR.id] }),
    rohit: await mkUser("rohit@solex.demo", "Rohit Kulkarni", "Sales Manager", "SALES", { projects: [projects.MSK.id] }),
    vikram: await mkUser("vikram@solex.demo", "Vikram Rao", "Finance Controller", "FINANCE"),
    rohan: await mkUser("rohan@primeestates.demo", "Rohan Desai", "Partner, Prime Estates", "BROKER", { brokerId: brokers.prime.id }),
    ishita: await mkUser("ishita@urbankey.demo", "Ishita Sen", "Founder, UrbanKey Realty", "BROKER", { brokerId: brokers.urban.id }),
    kunal: await mkUser("kunal@westside.demo", "Kunal Joshi", "Director, Westside Propmart", "BROKER", { brokerId: brokers.westside.id }),
    meera: await mkUser("meera@aravali.demo", "Meera Iyer", "VP Sales, Aravali Habitats", "DEVELOPER", { developerId: aravali.id }),
    sameer: await mkUser("sameer@meridian.demo", "Sameer Patil", "Head of Sales, Meridian Realty", "DEVELOPER", { developerId: meridian.id }),
  };

  return { projects, brokers, people, devIds };
}

// ----------------------------------------------------------- history replay
type Step = { at: Date; label: string; run: () => Promise<unknown> };
const queue: Step[] = [];
const schedule = (at: Date, label: string, run: () => Promise<unknown>) => {
  if (at.getTime() < REAL_NOW.getTime() - 5 * 60_000) queue.push({ at, label, run });
};

async function main() {
  console.log("Resetting demo data…");
  await reset();
  const { projects, people } = await seedMasterData();
  const actorById = new Map<string, Actor>(Object.values(people).map((a) => [a.userId, a]));
  const developerActorFor: Record<string, Actor> = { AGR: people.meera, AGC: people.meera, MSK: people.sameer };
  const brokersFor: Record<string, Actor[]> = { AGR: [people.rohan, people.ishita], AGC: [people.rohan], MSK: [people.ishita, people.kunal] };

  const sourceMix: { source: LeadSource; weight: number; campaign?: string }[] = [
    { source: "BROKER", weight: 36 },
    { source: "META_ADS", weight: 18, campaign: "Festive Preview – Lead Form" },
    { source: "GOOGLE_ADS", weight: 14, campaign: "Search – 3BHK near me" },
    { source: "WEBSITE", weight: 12, campaign: "Project microsite" },
    { source: "WALK_IN", weight: 8 },
    { source: "REFERRAL", weight: 7 },
    { source: "DIRECT", weight: 5 },
  ];
  const pickSource = () => {
    let r = rand() * 100;
    for (const s of sourceMix) {
      if ((r -= s.weight) <= 0) return s;
    }
    return sourceMix[0];
  };

  let bookingScripts = 0;
  for (const spec of PROJECTS) {
    const project = projects[spec.code];
    const mandateStart = addDays(REAL_NOW, -spec.mandate.startDaysAgo + 2);
    const span = REAL_NOW.getTime() - mandateStart.getTime();
    for (let i = 0; i < spec.leads; i++) {
      // Lead volume ramps up over the mandate (marketing gathers pace).
      const t0 = atHour(new Date(mandateStart.getTime() + Math.sqrt(rand()) * span * 0.97), 10 + Math.floor(rand() * 8));
      const src = pickSource();
      const name = `${pick(FIRST)} ${pick(LAST)}`;
      const phone = fakePhone();
      const config = pick(["2BHK", "3BHK", "3BHK"]);
      const budget = config === "2BHK" ? spec.rate * 1300 : spec.rate * 1900;
      let leadId = "";
      let ownerId = "";
      let alive = true;

      schedule(t0, `lead ${spec.code}#${i}`, async () => {
        const via = src.source === "BROKER" ? pick(brokersFor[spec.code]) : people.neha;
        const lead = await createLead(via, {
          projectId: project.id,
          name,
          phone,
          email: chance(0.6) ? `${name.split(" ")[0].toLowerCase()}.${phoneCounter}@mail.demo` : null,
          budgetMin: Math.round(budget * 0.85 / 1e5) * 1e5,
          budgetMax: Math.round(budget * 1.15 / 1e5) * 1e5,
          configPref: config,
          source: src.source === "BROKER" ? undefined : src.source,
          campaign: src.campaign ?? null,
        });
        leadId = lead.id;
        ownerId = lead.assignedToId!;
      });
      const owner = () => actorById.get(ownerId)!;
      const step = (at: Date, label: string, fn: () => Promise<unknown>) =>
        schedule(at, label, async () => {
          if (!alive || !leadId) return;
          try {
            await fn();
          } catch (err) {
            alive = false;
            if (process.env.SEED_DEBUG) console.warn(`  skipped ${label}: ${(err as Error).message}`);
          }
        });

      // Funnel outcome for this lead.
      const roll = rand();
      const willContact = roll < 0.9;
      const willQualify = roll < 0.62;
      const willVisit = roll < 0.45;
      const willBook = roll < 0.2;
      const t1 = hoursLater(t0, 1, 30);
      if (!willContact) {
        step(addDays(t0, 3), "invalid", async () => changeLeadStage(owner(), leadId, "INVALID"));
        continue;
      }
      step(t1, "call", () =>
        logActivity(owner(), leadId, {
          type: "CALL",
          note: pick(["Discussed configuration and budget", "Interested, wants pricing", "Asked for brochure on WhatsApp", "Comparing with two other projects"]),
          nextFollowUpAt: addDays(t1, 2),
        }),
      );
      const t2 = hoursLater(t1, 24, 96);
      if (!willQualify) {
        step(t2, "lost", async () => {
          await changeLeadStage(owner(), leadId, "LOST", pick(["Budget mismatch", "Bought elsewhere", "Location not suitable", "Not reachable after 5 attempts"]));
        });
        continue;
      }
      step(t2, "qualify", async () => {
        await changeLeadStage(owner(), leadId, "QUALIFIED");
        await logActivity(owner(), leadId, { type: "WHATSAPP", note: "Shared price sheet and floor plans", nextFollowUpAt: addDays(t2, 3) });
      });
      if (!willVisit) {
        if (chance(0.5)) step(addDays(t2, between(4, 12)), "lost-after-qualify", () => changeLeadStage(owner(), leadId, "LOST", "Postponed purchase decision"));
        continue;
      }
      const t3 = hoursLater(t2, 12, 72);
      const visitAt = atHour(addDays(t3, between(1, 5)), 11 + Math.floor(rand() * 6));
      let visitId = "";
      step(t3, "schedule-visit", async () => {
        const v = await scheduleVisit(owner(), leadId, { scheduledAt: visitAt, note: "Visit with family" });
        visitId = v.id;
      });
      const noShow = chance(0.15);
      step(addMinutes(visitAt, 90), "visit-outcome", async () => {
        if (noShow) {
          await markNoShow(owner(), visitId);
          alive = false;
          return;
        }
        await completeVisit(owner(), visitId, {
          feedback: pick(["Liked the clubhouse and layout", "Wants a higher floor", "Concerned about possession timeline", "Very positive, discussing with spouse", "Prefers park-facing stack"]),
          rating: willBook ? pick([4, 5]) : pick([2, 3, 4]),
          nextFollowUpAt: addDays(visitAt, 2),
        });
      });
      if (!willBook) {
        if (chance(0.4)) step(addDays(visitAt, between(5, 15)), "lost-after-visit", () => changeLeadStage(owner(), leadId, "LOST", pick(["Price too high", "Chose a ready-to-move option"])));
        else if (chance(0.5)) step(addDays(visitAt, 2), "negotiate", () => changeLeadStage(owner(), leadId, "NEGOTIATION"));
        continue;
      }

      // ---- booking ------------------------------------------------------
      bookingScripts++;
      const tb = atHour(addDays(visitAt, between(1, 9)), 12 + Math.floor(rand() * 5));
      const discountRoll = rand();
      const bands = spec.mandate;
      const discountBps =
        discountRoll < 0.55 ? 0 : discountRoll < 0.78 ? bands.exec : discountRoll < 0.93 ? Math.round((bands.exec + bands.mgmt) / 2) : bands.mgmt + 150;
      let bookingId = "";
      step(tb, "book", async () => {
        const lead = await db.lead.findUniqueOrThrow({ where: { id: leadId } });
        const candidates = await db.unit.findMany({
          where: { projectId: project.id, mandateId: { not: null }, status: "AVAILABLE", config: lead.configPref ?? undefined },
          orderBy: [{ floor: "asc" }, { stack: "asc" }],
        });
        if (candidates.length === 0) throw new Error("no inventory");
        const unit = candidates[Math.floor(rand() * Math.min(candidates.length, 18))];
        const held = await holdUnit(owner(), unit.id, unit.version);
        const booking = await createBooking(owner(), {
          unitId: unit.id,
          leadId,
          discountAmount: Math.round(applyBps(unit.listPrice, discountBps) / 1000) * 1000,
          expectedVersion: held.version,
        });
        bookingId = booking.id;
      });

      // Approvals (some are deliberately left pending at "now" for the demo).
      const approvalAt = hoursLater(tb, 4, 30);
      step(approvalAt, "approve-mgmt", async () => {
        const b = await db.booking.findUniqueOrThrow({ where: { id: bookingId } });
        if (b.status !== "PENDING_MGMT_APPROVAL") return;
        if (chance(0.08)) return rejectBooking(people.neha, bookingId, "Discount exceeds what the price sheet supports");
        await approveBooking(people.neha, bookingId);
      });
      step(hoursLater(approvalAt, 12, 40), "approve-dev", async () => {
        const b = await db.booking.findUniqueOrThrow({ where: { id: bookingId } });
        if (b.status !== "PENDING_DEV_APPROVAL") return;
        await approveBooking(developerActorFor[spec.code], bookingId);
      });

      // Collections: booking amount soon after; later instalments around their due dates.
      const latePayer = chance(0.22);
      const plan = spec.plan.stages;
      for (let s = 0; s < plan.length; s++) {
        const dueAt = addDays(tb, plan[s][2]);
        const payAt = s === 0 ? hoursLater(tb, 30, 72) : hoursLater(dueAt, latePayer ? 24 * 12 : -48, latePayer ? 24 * 40 : 24 * 6);
        if (latePayer && s === 1 && REAL_NOW.getTime() - dueAt.getTime() < 35 * DAY) continue; // leave overdue
        const seq = s + 1;
        step(payAt, `pay-${seq}`, async () => {
          const b = await db.booking.findUniqueOrThrow({ where: { id: bookingId }, include: { installments: true } });
          if (b.status !== "CONFIRMED" && b.status !== "AGREEMENT") return;
          const inst = b.installments.find((x) => x.seq === seq);
          if (!inst || inst.amountReceived >= inst.amountDue) return;
          const mode: PaymentMode = s === plan.length - 1 ? "HOME_LOAN_DISBURSAL" : pick(["NEFT", "RTGS", "UPI", "CHEQUE"] as const);
          await recordPayment(people.vikram, {
            bookingId,
            amount: inst.amountDue - inst.amountReceived,
            mode,
            reference: `${mode === "UPI" ? "UPI" : "UTR"}${String(Math.floor(rand() * 1e10)).padStart(10, "0")}`,
          });
        });
      }
    }
  }

  console.log(`Replaying ${queue.length} historical events (${bookingScripts} booking journeys)…`);
  queue.sort((a, b) => a.at.getTime() - b.at.getTime());

  // Commission settlement sweeps every 7 days of history.
  for (let d = addDays(START, 20); d < REAL_NOW; d = addDays(d, 7)) {
    const sweepAt = atHour(d, 17);
    queue.push({
      at: sweepAt,
      label: "settlement sweep",
      run: async () => {
        const lines = await db.commission.findMany({ where: { status: { in: ["EARNED", "INVOICED", "APPROVED"] }, isAdjustment: false } });
        for (const l of lines) {
          const age = (sweepAt.getTime() - (l.earnedAt?.getTime() ?? sweepAt.getTime())) / DAY;
          if (l.kind === "DEVELOPER_FEE") {
            if (l.status === "EARNED" && age > 10) await settleCommission(people.vikram, l.id, "INVOICE", `SX/INV/${sweepAt.getFullYear()}/${l.id.slice(-5).toUpperCase()}`);
            else if (l.status === "INVOICED" && age > 40) await settleCommission(people.vikram, l.id, "RECEIVE", `DEV-UTR-${l.id.slice(-6).toUpperCase()}`);
          } else {
            if (l.status === "EARNED" && age > 12) await settleCommission(people.neha, l.id, "APPROVE");
            else if (l.status === "APPROVED" && age > 25) await settleCommission(people.vikram, l.id, "PAY", `PAYOUT-${l.id.slice(-6).toUpperCase()}`);
          }
        }
      },
    });
  }
  queue.sort((a, b) => a.at.getTime() - b.at.getTime());

  for (const step of queue) {
    setClock(step.at);
    try {
      await step.run();
    } catch (err) {
      if (process.env.SEED_DEBUG) console.warn(`  ${step.label} failed: ${(err as Error).message}`);
    }
  }

  // ---- scenario fixtures at "now" ---------------------------------------
  // One cancellation after agreement (shows reversal + clawback + refund).
  setClock(addDays(REAL_NOW, -6));
  const toCancel = await db.booking.findFirst({
    where: { projectId: projects.AGR.id, status: "AGREEMENT" },
    orderBy: { bookedAt: "asc" },
  });
  if (toCancel) await cancelBooking(people.neha, toCancel.id, "Customer relocating abroad (job transfer)");

  // Fresh broker lead used to demo duplicate protection (UrbanKey will try to register the same buyer).
  setClock(addDays(REAL_NOW, -3));
  const dupDemo = await createLead(people.rohan, {
    projectId: projects.AGR.id,
    name: "Aditi Sharma",
    phone: "98100 12345",
    budgetMin: 2_20_00_000,
    budgetMax: 2_60_00_000,
    configPref: "3BHK",
  });
  await logActivity(actorById.get(dupDemo.assignedToId!)!, dupDemo.id, { type: "CALL", note: "Introduced by Prime Estates; wants park-facing 3BHK", nextFollowUpAt: addDays(REAL_NOW, -1) });

  // A booking waiting on soleX management, and one waiting on the developer.
  const pendingLeads = await db.lead.findMany({
    where: { projectId: projects.AGR.id, stage: { in: ["VISIT_DONE", "NEGOTIATION"] } },
    orderBy: { createdAt: "desc" },
    take: 2,
  });
  const availableAgr = await db.unit.findMany({
    where: { projectId: projects.AGR.id, mandateId: { not: null }, status: "AVAILABLE", config: "3BHK" },
    orderBy: [{ floor: "desc" }],
    take: 6,
  });
  const pendingSpecs = [
    { bps: 250, when: addDays(REAL_NOW, -1) },
    { bps: 450, when: addDays(REAL_NOW, -2) },
  ];
  for (let i = 0; i < Math.min(pendingLeads.length, 2); i++) {
    setClock(pendingSpecs[i].when);
    const lead = pendingLeads[i];
    const exec = actorById.get(lead.assignedToId!)!;
    const unit = availableAgr[i];
    const b = await createBooking(exec, {
      unitId: unit.id,
      leadId: lead.id,
      discountAmount: Math.round(applyBps(unit.listPrice, pendingSpecs[i].bps) / 1000) * 1000,
      expectedVersion: unit.version,
    });
    if (pendingSpecs[i].bps > 300) {
      setClock(addMinutes(pendingSpecs[i].when, 300));
      await approveBooking(people.neha, b.id); // now awaiting the developer
    }
  }

  // Live holds so the stacking plan shows amber units with a countdown.
  setClock(addMinutes(REAL_NOW, -12));
  const holdable = await db.unit.findMany({
    where: { projectId: projects.AGR.id, mandateId: { not: null }, status: "AVAILABLE" },
    orderBy: [{ floor: "desc" }, { stack: "asc" }],
    skip: 4,
    take: 2,
  });
  for (const u of holdable) await holdUnit(people.sara, u.id, u.version);

  // Two units blocked by the developer (e.g. reserved for landowners).
  const blockable = await db.unit.findMany({
    where: { projectId: projects.AGR.id, mandateId: { not: null }, status: "AVAILABLE", floor: 1 },
    take: 2,
  });
  for (const u of blockable) {
    await db.unit.update({ where: { id: u.id }, data: { status: "BLOCKED", version: { increment: 1 } } });
    await db.auditEvent.create({
      data: {
        at: addDays(REAL_NOW, -30),
        actorName: "Meera Iyer",
        actorRole: "DEVELOPER",
        type: "UNIT_BLOCKED",
        entityType: "Unit",
        entityId: u.id,
        projectId: u.projectId,
        summary: `${u.unitNo} blocked by developer (landowner allocation)`,
      },
    });
  }

  // Upcoming site visits for the sales execs' task lists.
  setClock(addMinutes(REAL_NOW, -90));
  const visitable = await db.lead.findMany({
    where: { stage: { in: ["QUALIFIED", "FOLLOW_UP"] } },
    orderBy: { updatedAt: "desc" },
    take: 5,
  });
  for (let i = 0; i < visitable.length; i++) {
    const lead = visitable[i];
    await scheduleVisit(actorById.get(lead.assignedToId!)!, lead.id, {
      scheduledAt: atHour(addDays(REAL_NOW, 1 + (i % 3)), 11 + i),
      note: "Weekend visit with family",
    });
  }

  // Simulated calls (transcript, summary, insights) on three open leads per sales exec,
  // placed over the last day. Two leads also get a later attempt that rings out unanswered.
  let callIndex = 0;
  let missed = 0;
  for (const exec of [people.arjun, people.sara, people.rohit]) {
    const leads = await db.lead.findMany({
      where: { assignedToId: exec.userId, stage: { in: ["CONTACTED", "QUALIFIED", "FOLLOW_UP", "NEGOTIATION"] }, id: { not: dupDemo.id } },
      orderBy: { code: "asc" },
      take: 3,
    });
    for (const lead of leads) {
      const at = addMinutes(REAL_NOW, -22 * 60 + callIndex++ * 120);
      setClock(at);
      const call = await startCall(exec, lead.id);
      setClock(addMinutes(at, 3));
      await endCall(exec, call.id, { talkSec: call.durationSec });
      if (missed < 2 && !willAnswer(lead.code, 2)) {
        setClock(addMinutes(at, 60));
        const retry = await startCall(exec, lead.id);
        setClock(addMinutes(at, 61));
        await endCall(exec, retry.id, { talkSec: null });
        missed++;
      }
    }
  }

  setClock(null);

  const checks = await runIntegrityChecks();
  const failed = checks.filter((c) => !c.ok);
  const [leads, bookings, payments, notifications] = await Promise.all([
    db.lead.count(),
    db.booking.groupBy({ by: ["status"], _count: true }),
    db.payment.count(),
    db.notification.count(),
  ]);
  console.log(`Seeded ${leads} leads, ${payments} payments, ${notifications} simulated notifications.`);
  console.log(`Bookings by status: ${bookings.map((b) => `${b.status}=${b._count}`).join(", ")}`);
  if (failed.length > 0) {
    console.error("Integrity checks FAILED:", JSON.stringify(failed, null, 2));
    process.exitCode = 1;
  } else {
    console.log(`Integrity checks: all ${checks.length} passed.`);
  }
  console.log(`Clock restored to ${clockNow().toISOString()}. Log in at http://localhost:3000 (password: demo1234).`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => db.$disconnect());
