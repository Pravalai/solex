import type { Prisma } from "@/generated/prisma/client";
import type { CallStatus } from "@/generated/prisma/enums";
import { withTx, type Tx } from "@/lib/db";
import { addDays, now } from "@/lib/clock";
import { ConflictError, DomainError, NotFoundError, isUniqueViolation } from "@/lib/errors";
import { formatDuration } from "@/lib/format";
import { maskPhone } from "@/lib/phone";
import type { Actor } from "@/modules/identity/actor";
import { assertCan } from "@/modules/identity/permissions";
import { notify, recordEvent } from "@/modules/audit/audit";
import { getScopedLead, recordInteraction } from "@/modules/crm/leads";
import { analyzeTranscript } from "./analysis";
import { draftFollowUp } from "./messages";
import { buildCallScript } from "./script";
import { encodeNextAction, type CallLine, type CallOutcome, type CallSession } from "./types";

/**
 * Simulated click-to-call. `startCall` stands in for asking a telephony provider
 * to bridge the exec and the customer; `endCall` stands in for the provider's
 * "call completed" webhook followed by speech-to-text and summarisation. The
 * conversation is generated server-side and stored when the call is placed, so
 * the browser only decides *when* the call ends, never what was said.
 */

function followUpDate(from: Date, days: number): Date {
  const d = addDays(from, days);
  d.setHours(11, 0, 0, 0);
  return d;
}

const firstName = (name: string) => name.trim().split(/\s+/)[0];

/** Interest score (1–5) at which a call suggests qualifying a new or contacted lead. */
export const QUALIFY_AT = 4;

/** Cheapest available appointed unit matching the configuration: the "from" price quoted on calls and in drafts. */
export async function fromPriceFor(client: Tx, projectId: string, configPref: string | null): Promise<number | null> {
  const cheapest = await client.unit.findFirst({
    where: { projectId, mandateId: { not: null }, status: "AVAILABLE", ...(configPref ? { config: configPref } : {}) },
    orderBy: { listPrice: "asc" },
    select: { listPrice: true },
  });
  return cheapest?.listPrice ?? null;
}

export async function startCall(actor: Actor, leadId: string): Promise<CallSession> {
  assertCan(actor, "call.place");
  try {
    return await withTx(async (tx) => {
      const lead = await getScopedLead(actor, leadId, tx);
      if (lead.stage === "INVALID") throw new DomainError("VALIDATION", "This lead is marked invalid, so it cannot be called.");
      const at = now();

      // An exec is on one call at a time. A call left open (e.g. the tab was closed
      // mid-call) is dropped without being logged as an interaction.
      const open = await tx.call.findMany({
        where: { userId: actor.userId, status: "IN_PROGRESS" },
        include: { lead: { select: { code: true, projectId: true } } },
      });
      for (const c of open) {
        await tx.call.update({ where: { id: c.id }, data: { status: "DROPPED", endedAt: at } });
        await recordEvent(tx, actor, {
          type: "CALL_DROPPED",
          entityType: "Lead",
          entityId: c.leadId,
          projectId: c.lead.projectId,
          summary: `Unfinished call to ${c.lead.code} dropped when a new call was placed`,
          data: { callId: c.id },
        });
      }

      const attempt = (await tx.call.count({ where: { leadId: lead.id } })) + 1;
      const script = buildCallScript({
        seedKey: lead.code,
        attempt,
        customerName: lead.name,
        execName: actor.name,
        projectName: lead.project.name,
        locality: lead.project.locality,
        configPref: lead.configPref,
        budgetMax: lead.budgetMax,
        fromPrice: await fromPriceFor(tx, lead.projectId, lead.configPref),
        possessionDate: lead.project.possessionDate,
      });

      // (leadId, attempt) is unique: two calls placed at the same instant cannot both be attempt N.
      const call = await tx.call.create({
        data: {
          leadId: lead.id,
          userId: actor.userId,
          attempt,
          answered: script.answered,
          ringSec: script.ringSec,
          scriptSec: script.durationSec,
          script: JSON.stringify(script.lines),
          startedAt: at,
        },
      });
      await recordEvent(tx, actor, {
        type: "CALL_STARTED",
        entityType: "Lead",
        entityId: lead.id,
        projectId: lead.projectId,
        summary: `Call to ${lead.code} ${lead.name} placed (attempt ${attempt}, simulated)`,
        data: { callId: call.id, attempt },
      });

      return {
        id: call.id,
        attempt,
        answered: script.answered,
        ringSec: script.ringSec,
        durationSec: script.durationSec,
        lines: script.lines,
        customerName: lead.name,
        execName: actor.name,
      };
    });
  } catch (err) {
    if (isUniqueViolation(err)) throw new ConflictError("Another call to this customer was placed at the same moment. Please try again.");
    throw err;
  }
}

/** Status-guarded write: a double click or a second tab cannot end (and log) the same call twice. */
async function claim(tx: Tx, callId: string, data: Prisma.CallUpdateManyMutationInput & { status: CallStatus }) {
  const res = await tx.call.updateMany({ where: { id: callId, status: "IN_PROGRESS" }, data });
  if (res.count !== 1) throw new ConflictError("This call has already ended.");
}

/**
 * Ends a call. `talkSec` is how long the conversation ran after the customer
 * picked up, or null if the exec hung up while it was still ringing. A connected
 * call is transcribed (the scripted lines spoken before hang-up), analysed,
 * and logged on the lead timeline as a CALL interaction with the summary as its note.
 */
export async function endCall(actor: Actor, callId: string, input: { talkSec: number | null }): Promise<CallOutcome> {
  assertCan(actor, "call.place");
  return withTx(async (tx) => {
    // Only the exec who placed the call can end it; anyone else gets NotFound.
    const call = await tx.call.findFirst({ where: { id: callId, userId: actor.userId } });
    if (!call) throw new NotFoundError("Call");
    const lead = await getScopedLead(actor, call.leadId, tx);
    const at = now();
    const first = firstName(lead.name);

    if (!call.answered || input.talkSec === null) {
      const summary = call.answered
        ? `Call to ${first} was cancelled before it was answered.`
        : `Call to ${first} was not answered (rang for ${call.ringSec}s). Missed-call SMS sent.`;
      const nextStep = "Try again tomorrow, or wait for the customer to reply to the SMS.";
      const nextFollowUpAt = followUpDate(at, 1);
      await claim(tx, call.id, { status: "NO_ANSWER", endedAt: at, talkSec: 0, transcript: "[]", summary, nextStep, nextAction: "RETRY" });
      const activity = await recordInteraction(tx, actor, lead, { type: "CALL", note: summary, contact: false, nextFollowUpAt });
      await tx.call.update({ where: { id: call.id }, data: { activityId: activity.id } });
      if (!call.answered) {
        await notify(tx, {
          channel: "SMS",
          recipient: `${lead.name} (${maskPhone(lead.phone)})`,
          body: `Hi ${first}, ${actor.name} from soleX tried to reach you about ${lead.project.name}. We will call again, or reply with a convenient time.`,
          entityType: "Lead",
          entityId: lead.id,
        });
      }
      await recordEvent(tx, actor, {
        type: "CALL_NO_ANSWER",
        entityType: "Lead",
        entityId: lead.id,
        projectId: lead.projectId,
        summary: `Call to ${lead.code} not connected (attempt ${call.attempt})`,
        data: { callId: call.id, answered: call.answered },
      });
      return {
        id: call.id,
        status: "NO_ANSWER",
        talkSec: 0,
        summary,
        sentiment: null,
        interestScore: null,
        execTalkPct: null,
        nextStep,
        nextAction: { kind: "RETRY" },
        nextFollowUpAt,
        insights: [],
        suggestQualify: false,
        draft: null,
      };
    }

    const talkSec = Math.min(call.scriptSec, Math.max(0, Math.round(input.talkSec)));
    const heard = (JSON.parse(call.script) as CallLine[]).filter((l) => l.at <= talkSec);
    const analysis = analyzeTranscript(heard, {
      customerName: lead.name,
      projectName: lead.project.name,
      configPref: lead.configPref,
      talkSec,
    });
    const nextFollowUpAt = followUpDate(at, analysis.followUpDays);

    await claim(tx, call.id, {
      status: "COMPLETED",
      endedAt: at,
      talkSec,
      transcript: JSON.stringify(heard),
      summary: analysis.summary,
      sentiment: analysis.sentiment,
      interestScore: analysis.interestScore,
      execTalkPct: analysis.execTalkPct,
      nextStep: analysis.nextStep,
      nextAction: encodeNextAction(analysis.nextAction),
    });
    if (analysis.insights.length > 0) {
      await tx.callInsight.createMany({
        data: analysis.insights.map((i, seq) => ({ callId: call.id, seq, ...i })),
      });
    }
    const activity = await recordInteraction(tx, actor, lead, { type: "CALL", note: analysis.summary, contact: true, nextFollowUpAt });
    await tx.call.update({ where: { id: call.id }, data: { activityId: activity.id } });
    const draft = draftFollowUp(analysis.nextAction, {
      customerName: lead.name,
      execName: actor.name,
      projectName: lead.project.name,
      locality: lead.project.locality,
      configPref: lead.configPref,
      fromPrice: await fromPriceFor(tx, lead.projectId, lead.configPref),
    });

    const count = (p: string) => analysis.insights.filter((i) => i.polarity === p).length;
    await recordEvent(tx, actor, {
      type: "CALL_COMPLETED",
      entityType: "Lead",
      entityId: lead.id,
      projectId: lead.projectId,
      summary: `Call with ${lead.code} logged: ${formatDuration(talkSec)}, ${analysis.sentiment.toLowerCase()}, ${count("POSITIVE")}+ / ${count("NEGATIVE")}− / ${count("NEUTRAL")}○ insights`,
      data: { callId: call.id, sentiment: analysis.sentiment, interestScore: analysis.interestScore, insights: analysis.insights.length },
    });

    return {
      id: call.id,
      status: "COMPLETED",
      talkSec,
      summary: analysis.summary,
      sentiment: analysis.sentiment,
      interestScore: analysis.interestScore,
      execTalkPct: analysis.execTalkPct,
      nextStep: analysis.nextStep,
      nextAction: analysis.nextAction,
      nextFollowUpAt,
      insights: analysis.insights,
      // recordInteraction has already moved a NEW lead to CONTACTED.
      suggestQualify: analysis.interestScore >= QUALIFY_AT && (lead.stage === "NEW" || lead.stage === "CONTACTED"),
      draft,
    };
  });
}
