import { describe, expect, it } from "vitest";
import { analyzeTranscript, extractInsights } from "@/modules/calls/analysis";
import { CLOSINGS, TOPICS, buildCallScript, willAnswer, type ScriptContext } from "@/modules/calls/script";
import { decodeNextAction, encodeNextAction, nextActionLabel, type CallLine } from "@/modules/calls/types";
import { draftFollowUp } from "@/modules/calls/messages";

const base: ScriptContext = {
  seedKey: "AGR-L0042",
  attempt: 1,
  customerName: "Kavya Raghavan",
  execName: "Arjun Mehta",
  projectName: "Aravali Greens",
  locality: "Sector 79",
  configPref: "3BHK",
  budgetMax: 2_50_00_000,
  fromPrice: 2_35_00_000,
  possessionDate: new Date(2028, 11, 1),
};

const vars = { first: "Kavya", exec: "Arjun", project: "Aravali Greens", locality: "Sector 79", config: "3BHK", price: "₹2.35 crore", budget: "₹2.5 crore", possession: "December 2028" };
const customer = (text: string, at = 10): CallLine => ({ at, speaker: "CUSTOMER", text });
const exec = (text: string, at = 5): CallLine => ({ at, speaker: "EXEC", text });

describe("call script generator", () => {
  it("is deterministic for the same lead and attempt", () => {
    expect(buildCallScript(base)).toEqual(buildCallScript(base));
  });

  it("varies across attempts and leads", () => {
    const scripts = [1, 2, 3, 4, 5].map((attempt) => JSON.stringify(buildCallScript({ ...base, attempt }).lines));
    expect(new Set(scripts).size).toBeGreaterThan(1);
    expect(buildCallScript({ ...base, seedKey: "MSK-L0007" }).lines).not.toEqual(buildCallScript(base).lines);
  });

  it("is personalised and well formed", () => {
    const s = buildCallScript(base);
    expect(s.lines[0]).toMatchObject({ speaker: "EXEC" });
    expect(s.lines[0].text).toContain("Kavya");
    expect(s.lines[0].text).toContain("Arjun");
    expect(s.lines[0].text).toContain("Aravali Greens");
    expect(s.lines.at(-1)?.speaker).toBe("CUSTOMER");
    for (let i = 1; i < s.lines.length; i++) expect(s.lines[i].at).toBeGreaterThan(s.lines[i - 1].at);
    expect(s.durationSec).toBeGreaterThan(s.lines.at(-1)!.at);
    // Exec and customer alternate.
    s.lines.forEach((l, i) => expect(l.speaker).toBe(i % 2 === 0 ? "EXEC" : "CUSTOMER"));
  });

  it("always connects the first call; later attempts sometimes ring out", () => {
    const keys = Array.from({ length: 200 }, (_, i) => `L-${i}`);
    expect(keys.every((k) => willAnswer(k, 1))).toBe(true);
    const unanswered = keys.filter((k) => !willAnswer(k, 2)).length;
    expect(unanswered).toBeGreaterThan(20);
    expect(unanswered).toBeLessThan(80);
    expect(buildCallScript({ ...base, attempt: 1 }).answered).toBe(true);
  });
});

describe("transcript analysis", () => {
  it("recognises every reply the generator can produce, with the intended category and polarity", () => {
    const replies = [...Object.values(TOPICS).flatMap((t) => Object.values(t.replies).flat()), ...Object.values(CLOSINGS).flatMap((c) => c.replies)];
    expect(replies.length).toBeGreaterThan(40);
    for (const reply of replies) {
      const text = reply.text(vars);
      const found = extractInsights([customer(text)]);
      expect(found, text).toContainEqual(expect.objectContaining({ category: reply.category, polarity: reply.polarity }));
      // A reply never contradicts itself (e.g. "not interested" must not also read as interested).
      const opposite = reply.polarity === "POSITIVE" ? "NEGATIVE" : reply.polarity === "NEGATIVE" ? "POSITIVE" : null;
      expect(found.filter((i) => i.polarity === opposite), text).toEqual([]);
    }
  });

  it("only treats the customer's words as evidence", () => {
    const found = extractInsights([exec("Our home loan partners say this is within your budget."), customer("Okay.")]);
    expect(found).toEqual([]);
  });

  it("does not read 'not interested' as interest", () => {
    const found = extractInsights([customer("Honestly we are not interested at the moment.")]);
    expect(found).toEqual([expect.objectContaining({ category: "INTEREST", polarity: "NEGATIVE" })]);
  });

  it("summarises a mixed call with polarity groups, a next step and a talk ratio", () => {
    const lines = [
      exec("Hello, am I speaking with Kavya?", 1),
      customer("Yes, speaking. Tell me.", 4),
      exec("Will you be taking a home loan for this?", 7),
      customer("Our home loan is already pre-approved with the bank.", 10),
      exec("Does that work for your budget?", 14),
      customer("That is above our budget, honestly.", 17),
      exec("Would you like to visit?", 20),
      customer("I need to discuss it with my family first.", 23),
    ];
    const a = analyzeTranscript(lines, { customerName: "Kavya Raghavan", projectName: "Aravali Greens", configPref: "3BHK", talkSec: 26 });
    expect(a.insights.map((i) => [i.polarity, i.category])).toEqual([
      ["POSITIVE", "FINANCE"],
      ["NEGATIVE", "PRICE"],
      ["NEUTRAL", "DECISION"],
    ]);
    expect(a.sentiment).toBe("NEUTRAL");
    expect(a.interestScore).toBe(3);
    // Family discussion (priority 4) outranks the price objection (priority 6).
    expect(a.followUpDays).toBe(3);
    expect(a.summary).toBe(
      "Spoke with Kavya for 26s about Aravali Greens (3BHK). Positives: financing is in place. Concerns: price is above their budget. Also noted: decision involves the family. Next step: Follow up after the family discussion and offer a family site visit.",
    );
    expect(a.execTalkPct).toBeGreaterThan(30);
    expect(a.execTalkPct).toBeLessThan(70);
    expect(a.insights[0].quote).toBe("Our home loan is already pre-approved with the bank.");
  });

  it("scores a keen customer as positive and prioritises booking the visit", () => {
    const lines = [
      exec("Hello?", 1),
      customer("Yes, Arjun ji. I am very interested in Aravali Greens, tell me more.", 3),
      customer("The location is perfect, it is close to my office.", 8),
      customer("Yes, we would like to visit this Saturday.", 12),
    ];
    const a = analyzeTranscript(lines, { customerName: "Kavya", projectName: "Aravali Greens", configPref: null, talkSec: 15 });
    expect(a.sentiment).toBe("POSITIVE");
    expect(a.interestScore).toBe(5);
    expect(a.followUpDays).toBe(1);
    expect(a.nextStep).toMatch(/site visit/);
  });

  it("scores a cold customer as negative and moves them to nurture", () => {
    const lines = [exec("Hello?", 1), customer("Yes, speaking, but I only have a couple of minutes.", 3), customer("We are not planning a visit right now, we are just exploring.", 8)];
    const a = analyzeTranscript(lines, { customerName: "Kavya", projectName: "Aravali Greens", configPref: null, talkSec: 12 });
    expect(a.sentiment).toBe("NEGATIVE");
    expect(a.interestScore).toBe(2);
    expect(a.followUpDays).toBe(14);
  });

  it("handles a call cut off after the greeting", () => {
    const a = analyzeTranscript([exec("Hello, am I speaking with Kavya?", 1), customer("Yes, speaking.", 4)], {
      customerName: "Kavya",
      projectName: "Aravali Greens",
      configPref: null,
      talkSec: 6,
    });
    expect(a.insights).toEqual([]);
    expect(a.summary).toMatch(/^Call with Kavya ended after 6s, before their requirements were discussed/);
    expect(a.followUpDays).toBe(1);
  });

  it("finds at least one insight per discussed topic on full generated calls", () => {
    for (let i = 0; i < 100; i++) {
      const s = buildCallScript({ ...base, seedKey: `LEAD-${i}`, attempt: 1 + (i % 3) });
      const a = analyzeTranscript(s.lines, { customerName: base.customerName, projectName: base.projectName, configPref: base.configPref, talkSec: s.durationSec });
      const topicReplies = s.lines.filter((l) => l.speaker === "CUSTOMER").length - 2; // minus greeting and goodbye
      expect(a.insights.length).toBeGreaterThanOrEqual(topicReplies);
    }
  });
});

describe("next action after a call", () => {
  const ctx = { customerName: "Kavya", projectName: "Aravali Greens", configPref: "3BHK", talkSec: 20 };
  const call = (...said: string[]) => [exec("Hello?", 1), customer("Yes, speaking.", 2), ...said.map((s, i) => customer(s, 5 + i * 3))];

  it("turns each follow-up rule into a one-click action", () => {
    expect(analyzeTranscript(call("Yes, we would like to visit this Saturday."), ctx).nextAction).toEqual({ kind: "SCHEDULE_VISIT" });
    expect(analyzeTranscript(call("Honestly it is above our budget."), ctx).nextAction).toEqual({ kind: "SEND_INFO", info: "PAYMENT_PLAN" });
    expect(analyzeTranscript(call("We are also considering another project nearby."), ctx).nextAction).toEqual({ kind: "SEND_INFO", info: "COMPARISON" });
    expect(analyzeTranscript(call("Please call me back next week."), ctx).nextAction).toEqual({ kind: "CALL_BACK" });
    expect(analyzeTranscript(call("We are just exploring for now."), ctx).nextAction).toEqual({ kind: "NURTURE" });
    expect(analyzeTranscript(call("The location is perfect."), ctx).nextAction).toEqual({ kind: "SEND_INFO", info: "BROCHURE" });
    expect(analyzeTranscript([customer("Yes, speaking.", 2)], ctx).nextAction).toEqual({ kind: "RETRY" });
  });

  it("lets the strongest commitment win when several rules fire", () => {
    const a = analyzeTranscript(call("It is above our budget.", "But we would like to visit on Sunday."), ctx);
    expect(a.nextAction).toEqual({ kind: "SCHEDULE_VISIT" });
  });

  it("round-trips through its stored form and rejects junk", () => {
    for (const a of [{ kind: "SCHEDULE_VISIT" }, { kind: "SEND_INFO", info: "PAYMENT_PLAN" }, { kind: "RETRY" }] as const) {
      expect(decodeNextAction(encodeNextAction(a))).toEqual(a);
    }
    expect(decodeNextAction("DELETE_EVERYTHING")).toBeNull();
    expect(decodeNextAction(null)).toBeNull();
    expect(nextActionLabel({ kind: "SEND_INFO", info: "PAYMENT_PLAN" })).toBe("Send payment-plan options on WhatsApp");
  });

  it("drafts a personalised WhatsApp only for actions that send something", () => {
    const d = { customerName: "Kavya Raghavan", execName: "Arjun Mehta", projectName: "Aravali Greens", locality: "Sector 79", configPref: "3BHK", fromPrice: 2_35_00_000 };
    const draft = draftFollowUp({ kind: "SEND_INFO", info: "PAYMENT_PLAN" }, d)!;
    expect(draft).toMatch(/^Hi Kavya, Arjun from soleX here\./);
    expect(draft).toContain("Aravali Greens");
    expect(draft).toContain("3BHK homes from ₹2.35 Cr");
    expect(draftFollowUp({ kind: "NURTURE" }, { ...d, fromPrice: null })).not.toContain("from ₹");
    expect(draftFollowUp({ kind: "SCHEDULE_VISIT" }, d)).toBeNull();
    expect(draftFollowUp(null, d)).toBeNull();
  });
});
