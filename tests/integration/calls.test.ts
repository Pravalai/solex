import { beforeAll, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { ConflictError, DomainError, ForbiddenError, NotFoundError } from "@/lib/errors";
import { changeLeadStage, createLead } from "@/modules/crm/leads";
import { endCall, startCall } from "@/modules/calls/calls";
import { getLeadDetail } from "@/modules/reporting/leads";
import { runIntegrityChecks } from "@/modules/reporting/integrity";
import { buildWorld, nextPhone, type World } from "../fixtures";

let w: World;

beforeAll(async () => {
  w = await buildWorld();
});

async function newLead(opts: { by?: "sales1" | "brokerA" } = {}) {
  const actor = w.actors[opts.by ?? "sales1"];
  return createLead(actor, {
    projectId: w.p1.project.id,
    name: "Kavya Raghavan",
    phone: nextPhone(),
    configPref: "3BHK",
    budgetMax: 2_00_00_000,
    ...(opts.by === "brokerA" ? {} : { source: "WEBSITE" as const }),
  });
}

async function expectIntegrity() {
  const failed = (await runIntegrityChecks()).filter((c) => !c.ok);
  expect(failed).toEqual([]);
}

describe("a connected call", () => {
  it("is transcribed, analysed and logged as a CALL interaction on the lead", async () => {
    const { sales1 } = w.actors;
    const lead = await newLead();
    expect(lead.stage).toBe("NEW");

    const session = await startCall(sales1, lead.id);
    expect(session.attempt).toBe(1);
    expect(session.answered).toBe(true);
    expect(session.lines.length).toBeGreaterThan(6);
    expect(session.lines[0].text).toContain("Kavya");

    const outcome = await endCall(sales1, session.id, { talkSec: session.durationSec });
    expect(outcome.status).toBe("COMPLETED");
    expect(outcome.insights.length).toBeGreaterThan(0);
    expect(outcome.summary).toMatch(/^Spoke with Kavya for /);
    expect(outcome.nextFollowUpAt!.getTime()).toBeGreaterThan(Date.now());

    const call = await db.call.findUniqueOrThrow({ where: { id: session.id }, include: { insights: true, activity: true } });
    expect(call.status).toBe("COMPLETED");
    expect(call.talkSec).toBe(session.durationSec);
    expect(JSON.parse(call.transcript!)).toHaveLength(session.lines.length);
    expect(call.insights).toHaveLength(outcome.insights.length);
    expect(call.activity).toMatchObject({ leadId: lead.id, type: "CALL", note: outcome.summary, userId: sales1.userId });

    const after = await db.lead.findUniqueOrThrow({ where: { id: lead.id } });
    expect(after.stage).toBe("CONTACTED");
    expect(after.lastContactAt).not.toBeNull();
    expect(after.nextFollowUpAt).toEqual(outcome.nextFollowUpAt);

    const events = await db.auditEvent.findMany({ where: { entityId: lead.id, type: { startsWith: "CALL_" } }, orderBy: { at: "asc" } });
    expect(events.map((e) => e.type)).toEqual(["CALL_STARTED", "CALL_COMPLETED"]);
    await expectIntegrity();
  });

  it("cannot be ended (and logged) twice", async () => {
    const { sales1 } = w.actors;
    const lead = await newLead();
    const session = await startCall(sales1, lead.id);
    await endCall(sales1, session.id, { talkSec: session.durationSec });
    await expect(endCall(sales1, session.id, { talkSec: session.durationSec })).rejects.toBeInstanceOf(ConflictError);
    expect(await db.leadActivity.count({ where: { leadId: lead.id, type: "CALL" } })).toBe(1);
  });

  it("only transcribes what was said before the exec hung up", async () => {
    const { sales1 } = w.actors;
    const lead = await newLead();
    const session = await startCall(sales1, lead.id);
    const cutAt = session.lines[3].at;
    const outcome = await endCall(sales1, session.id, { talkSec: cutAt });
    const call = await db.call.findUniqueOrThrow({ where: { id: session.id } });
    const heard = JSON.parse(call.transcript!) as { at: number }[];
    expect(heard).toHaveLength(4);
    expect(heard.every((l) => l.at <= cutAt)).toBe(true);
    expect(outcome.talkSec).toBe(cutAt);
    // The client cannot claim more talk time than the conversation has.
    const other = await startCall(sales1, (await newLead()).id);
    expect((await endCall(sales1, other.id, { talkSec: 3000 })).talkSec).toBe(other.durationSec);
  });
});

describe("a call that does not connect", () => {
  it("is logged as a missed attempt without counting as contact, and an SMS is queued when it rang out", async () => {
    const { sales1 } = w.actors;
    const lead = await newLead();
    const session = await startCall(sales1, lead.id);
    const outcome = await endCall(sales1, session.id, { talkSec: null }); // hung up while ringing
    expect(outcome.status).toBe("NO_ANSWER");
    expect(outcome.insights).toEqual([]);

    const after = await db.lead.findUniqueOrThrow({ where: { id: lead.id } });
    expect(after.stage).toBe("NEW");
    expect(after.lastContactAt).toBeNull();
    const activity = await db.leadActivity.findFirstOrThrow({ where: { leadId: lead.id, type: "CALL" } });
    expect(activity.note).toMatch(/cancelled before it was answered/);

    // Force a ring-out by finding an attempt the simulation will not answer.
    let next = await startCall(sales1, lead.id);
    while (next.answered) {
      await endCall(sales1, next.id, { talkSec: 0 });
      next = await startCall(sales1, lead.id);
    }
    const before = await db.notification.count({ where: { entityId: lead.id, channel: "SMS" } });
    const rang = await endCall(sales1, next.id, { talkSec: next.durationSec }); // the client cannot force a connection
    expect(rang.status).toBe("NO_ANSWER");
    expect(rang.summary).toMatch(/not answered/);
    expect(await db.notification.count({ where: { entityId: lead.id, channel: "SMS" } })).toBe(before + 1);
    await expectIntegrity();
  });

  it("drops a call left open when the exec places another", async () => {
    const { sales1 } = w.actors;
    const a = await startCall(sales1, (await newLead()).id);
    const b = await startCall(sales1, (await newLead()).id);
    expect((await db.call.findUniqueOrThrow({ where: { id: a.id } })).status).toBe("DROPPED");
    await expect(endCall(sales1, a.id, { talkSec: 10 })).rejects.toBeInstanceOf(ConflictError);
    await endCall(sales1, b.id, { talkSec: b.durationSec });
    expect((await db.call.findUniqueOrThrow({ where: { id: a.id } })).activityId).toBeNull();
    await expectIntegrity();
  });

  it("is refused for an invalid lead", async () => {
    const lead = await newLead();
    await changeLeadStage(w.actors.sales1, lead.id, "INVALID");
    await expect(startCall(w.actors.sales1, lead.id)).rejects.toThrow(DomainError);
  });
});

describe("call access", () => {
  it("lets only sales execs place calls, and only on their own leads", async () => {
    const lead = await newLead();
    for (const role of ["mgmt", "finance", "brokerA", "devA"] as const) {
      await expect(startCall(w.actors[role], lead.id)).rejects.toBeInstanceOf(ForbiddenError);
    }
    await expect(startCall(w.actors.sales2, lead.id)).rejects.toBeInstanceOf(NotFoundError);
  });

  it("lets only the exec who placed a call end it", async () => {
    const session = await startCall(w.actors.sales1, (await newLead()).id);
    await expect(endCall(w.actors.sales2, session.id, { talkSec: 10 })).rejects.toBeInstanceOf(NotFoundError);
    await expect(endCall(w.actors.mgmt, session.id, { talkSec: 10 })).rejects.toBeInstanceOf(ForbiddenError);
    await endCall(w.actors.sales1, session.id, { talkSec: session.durationSec });
  });

  it("shows calls to the exec and management, never to the introducing partner", async () => {
    const { sales1, mgmt, brokerA } = w.actors;
    const lead = await newLead({ by: "brokerA" });
    expect(lead.assignedToId).toBe(sales1.userId);
    const session = await startCall(sales1, lead.id);
    await endCall(sales1, session.id, { talkSec: session.durationSec });

    for (const viewer of [sales1, mgmt]) {
      const detail = await getLeadDetail(viewer, lead.id);
      expect(detail.calls).toHaveLength(1);
      expect(detail.calls[0].transcript.length).toBeGreaterThan(0);
      expect(detail.activities.find((a) => a.type === "CALL")?.call?.id).toBe(session.id);
    }

    const partnerView = await getLeadDetail(brokerA, lead.id);
    expect(partnerView.calls).toEqual([]);
    expect(partnerView.activities.every((a) => a.call === null)).toBe(true);
    expect(JSON.stringify(partnerView)).not.toMatch(/transcript|insights/);
  });
});
