import { formatDuration } from "@/lib/format";
import type { CallLine, Insight, InsightCategory, NextAction, Polarity } from "./types";

/**
 * Rule-based call analysis: no AI. Each rule is a phrase pattern applied to what
 * the *customer* said (the exec's own words never count as evidence). Rules are
 * transparent and testable; in production this module is where an LLM call
 * would slot in, returning the same `CallAnalysis` shape.
 */

/** `action` is what the UI offers as a one-click button; `step` is the same advice in words. */
type FollowUp = { action: NextAction; priority: number; days: number; step: string };

type Rule = {
  key: string;
  category: InsightCategory;
  polarity: Polarity;
  pattern: RegExp;
  text: string;
  /** How strongly the insight moves overall sentiment (default 1). */
  weight?: number;
  followUp?: FollowUp;
};

const RULES: Rule[] = [
  // Buying intent
  { key: "intent-high", category: "INTEREST", polarity: "POSITIVE", pattern: /\bvery interested\b|\bready to book\b|\bwant to book\b/i, text: "Strong interest in the project", weight: 2 },
  {
    key: "intent-low",
    category: "INTEREST",
    polarity: "NEGATIVE",
    pattern: /\bnot interested\b|\bjust (exploring|browsing)\b/i,
    text: "Low buying intent right now",
    weight: 2,
    followUp: { action: { kind: "NURTURE" }, priority: 2, days: 14, step: "Move to nurture: share project updates and check back in two weeks." },
  },
  // Unit fit
  { key: "fit-good", category: "UNIT_FIT", polarity: "POSITIVE", pattern: /exactly what we need|layout (looked|looks|is) good/i, text: "Unit configuration fits their needs" },
  { key: "fit-poor", category: "UNIT_FIT", polarity: "NEGATIVE", pattern: /\b(bit|too) small\b|rooms felt small|layout is not working/i, text: "Unit size or layout does not suit them" },
  { key: "fit-open", category: "UNIT_FIT", polarity: "NEUTRAL", pattern: /open between|not decided between/i, text: "Undecided between configurations" },
  // Price and budget
  { key: "price-ok", category: "PRICE", polarity: "POSITIVE", pattern: /within (our|my) budget|price is (reasonable|fine|good)/i, text: "Price is within their budget" },
  {
    key: "price-high",
    category: "PRICE",
    polarity: "NEGATIVE",
    pattern: /above (our|my) budget|too expensive|out of (our|my) budget/i,
    text: "Price is above their budget",
    followUp: { action: { kind: "SEND_INFO", info: "PAYMENT_PLAN" }, priority: 6, days: 2, step: "Prepare payment-plan options and check what discount is possible within your band." },
  },
  { key: "budget-open", category: "PRICE", polarity: "NEUTRAL", pattern: /not fixed (our|the) budget|budget is flexible/i, text: "Budget not fixed yet" },
  { key: "discount-ask", category: "PRICE", polarity: "NEUTRAL", pattern: /(better|extra) discount/i, text: "Asked for a better discount" },
  // Financing
  { key: "finance-ready", category: "FINANCE", polarity: "POSITIVE", pattern: /pre-?approved|own funds|financing is not an issue/i, text: "Financing is in place" },
  { key: "finance-risk", category: "FINANCE", polarity: "NEGATIVE", pattern: /eligibility is a concern|worried about the emi/i, text: "Concerned about loan eligibility or EMI" },
  { key: "finance-open", category: "FINANCE", polarity: "NEUTRAL", pattern: /(talking to|comparing) banks/i, text: "Taking a loan, still comparing banks" },
  // Location
  { key: "location-good", category: "LOCATION", polarity: "POSITIVE", pattern: /location is (perfect|great|good)|close to my office|school is nearby/i, text: "Location suits them" },
  { key: "location-poor", category: "LOCATION", polarity: "NEGATIVE", pattern: /commute .*worries|far from my (workplace|office)/i, text: "Worried about the commute" },
  { key: "location-open", category: "LOCATION", polarity: "NEUTRAL", pattern: /not seen the area|check the connectivity/i, text: "Wants to check the area first" },
  // Amenities
  { key: "amenities-good", category: "AMENITIES", polarity: "POSITIVE", pattern: /impressed us|loved the amenities/i, text: "Liked the clubhouse and amenities" },
  { key: "amenities-poor", category: "AMENITIES", polarity: "NEGATIVE", pattern: /fewer than we expected|amenities were .*disappointing/i, text: "Amenities below expectations" },
  { key: "amenities-info", category: "AMENITIES", polarity: "NEUTRAL", pattern: /amenities list/i, text: "Asked for the amenities list" },
  // Possession
  { key: "possession-ok", category: "POSSESSION", polarity: "POSITIVE", pattern: /timeline works|no hurry|that date is fine/i, text: "Possession timeline works for them" },
  { key: "possession-late", category: "POSSESSION", polarity: "NEGATIVE", pattern: /too late for us|possession sooner|worried about delays/i, text: "Possession timeline is a concern" },
  { key: "possession-info", category: "POSSESSION", polarity: "NEUTRAL", pattern: /construction (updates|status)/i, text: "Asked for construction updates" },
  // Competition
  { key: "competition-none", category: "COMPETITION", polarity: "POSITIVE", pattern: /first choice|like this one the most/i, text: "This project is their first choice" },
  {
    key: "competition-rival",
    category: "COMPETITION",
    polarity: "NEGATIVE",
    pattern: /considering another project|another developer|quoted lower|better deal/i,
    text: "Evaluating a competing project",
    followUp: { action: { kind: "SEND_INFO", info: "COMPARISON" }, priority: 7, days: 2, step: "Send a side-by-side comparison with the competing project." },
  },
  { key: "competition-open", category: "COMPETITION", polarity: "NEUTRAL", pattern: /couple of others|options open/i, text: "Has seen other projects, nothing final" },
  // Site visit and decision
  {
    key: "visit-yes",
    category: "VISIT",
    polarity: "POSITIVE",
    pattern: /would like to visit|can visit on/i,
    text: "Agreed to a site visit",
    followUp: { action: { kind: "SCHEDULE_VISIT" }, priority: 1, days: 1, step: "Schedule the site visit the customer agreed to and send directions on WhatsApp." },
  },
  {
    key: "visit-maybe",
    category: "VISIT",
    polarity: "NEUTRAL",
    pattern: /let me check.*confirm/i,
    text: "Site visit not confirmed yet",
    followUp: { action: { kind: "CALL_BACK" }, priority: 5, days: 2, step: "Call to lock a site-visit slot." },
  },
  { key: "visit-no", category: "VISIT", polarity: "NEGATIVE", pattern: /not planning a visit/i, text: "Not ready for a site visit" },
  {
    key: "family",
    category: "DECISION",
    polarity: "NEUTRAL",
    pattern: /discuss (it )?with my (family|wife|husband|parents)/i,
    text: "Decision involves the family",
    followUp: { action: { kind: "CALL_BACK" }, priority: 4, days: 3, step: "Follow up after the family discussion and offer a family site visit." },
  },
  {
    key: "callback",
    category: "DECISION",
    polarity: "NEUTRAL",
    pattern: /call me back next week/i,
    text: "Asked for a call back next week",
    followUp: { action: { kind: "CALL_BACK" }, priority: 3, days: 7, step: "Call back next week as requested." },
  },
];

const DEFAULT_FOLLOW_UP: FollowUp = { action: { kind: "SEND_INFO", info: "BROCHURE" }, priority: 99, days: 2, step: "Share the brochure and price sheet, then follow up." };
const INCOMPLETE_FOLLOW_UP: FollowUp = { action: { kind: "RETRY" }, priority: 0, days: 1, step: "Call again to complete the conversation." };

export type CallAnalysis = {
  insights: Insight[];
  sentiment: Polarity;
  /** 1 (cold) to 5 (hot). */
  interestScore: number;
  /** Share of words spoken by the exec, 0–100. A coaching signal: good calls let the customer talk. */
  execTalkPct: number;
  nextStep: string;
  nextAction: NextAction;
  followUpDays: number;
  summary: string;
};

export type AnalysisContext = { customerName: string; projectName: string; configPref: string | null; talkSec: number };

const words = (s: string) => s.split(/\s+/).filter(Boolean).length;
const lowerFirst = (s: string) => s.charAt(0).toLowerCase() + s.slice(1);

/** Each rule fires at most once per call, on the first customer line that matches it. */
function matchRules(lines: CallLine[]): { rule: Rule; line: CallLine }[] {
  const seen = new Set<string>();
  const out: { rule: Rule; line: CallLine }[] = [];
  for (const line of lines) {
    if (line.speaker !== "CUSTOMER") continue;
    for (const rule of RULES) {
      if (seen.has(rule.key) || !rule.pattern.test(line.text)) continue;
      seen.add(rule.key);
      out.push({ rule, line });
    }
  }
  return out;
}

const toInsight = ({ rule, line }: { rule: Rule; line: CallLine }): Insight => ({
  polarity: rule.polarity,
  category: rule.category,
  text: rule.text,
  quote: line.text,
  atSec: line.at,
});

export function extractInsights(lines: CallLine[]): Insight[] {
  return matchRules(lines).map(toInsight);
}

export function analyzeTranscript(lines: CallLine[], ctx: AnalysisContext): CallAnalysis {
  const first = ctx.customerName.trim().split(/\s+/)[0];
  const execWords = lines.filter((l) => l.speaker === "EXEC").reduce((s, l) => s + words(l.text), 0);
  const allWords = lines.reduce((s, l) => s + words(l.text), 0);
  const execTalkPct = allWords === 0 ? 0 : Math.round((execWords / allWords) * 100);
  const customerTurns = lines.filter((l) => l.speaker === "CUSTOMER").length;

  // Only a greeting (or nothing) was exchanged.
  if (customerTurns <= 1) {
    return {
      insights: [],
      sentiment: "NEUTRAL",
      interestScore: 3,
      execTalkPct,
      nextStep: INCOMPLETE_FOLLOW_UP.step,
      nextAction: INCOMPLETE_FOLLOW_UP.action,
      followUpDays: INCOMPLETE_FOLLOW_UP.days,
      summary: `Call with ${first} ended after ${formatDuration(ctx.talkSec)}, before their requirements were discussed. Next step: ${INCOMPLETE_FOLLOW_UP.step}`,
    };
  }

  const matches = matchRules(lines);
  const insights = matches.map(toInsight);
  const sign = { POSITIVE: 1, NEGATIVE: -1, NEUTRAL: 0 } as const;
  const score = matches.reduce((s, { rule }) => s + sign[rule.polarity] * (rule.weight ?? 1), 0);
  const sentiment: Polarity = score >= 2 ? "POSITIVE" : score <= -2 ? "NEGATIVE" : "NEUTRAL";
  const interestScore = Math.min(5, Math.max(1, Math.round(3 + score / 2)));

  const followUp = matches
    .map(({ rule }) => rule.followUp)
    .filter((f): f is FollowUp => !!f)
    .reduce((best, f) => (f.priority < best.priority ? f : best), DEFAULT_FOLLOW_UP);

  const list = (p: Polarity) => insights.filter((i) => i.polarity === p).map((i) => lowerFirst(i.text)).join("; ");
  const parts = [`Spoke with ${first} for ${formatDuration(ctx.talkSec)} about ${ctx.projectName}${ctx.configPref ? ` (${ctx.configPref})` : ""}.`];
  if (list("POSITIVE")) parts.push(`Positives: ${list("POSITIVE")}.`);
  if (list("NEGATIVE")) parts.push(`Concerns: ${list("NEGATIVE")}.`);
  if (list("NEUTRAL")) parts.push(`Also noted: ${list("NEUTRAL")}.`);
  parts.push(`Next step: ${followUp.step}`);

  return {
    insights,
    sentiment,
    interestScore,
    execTalkPct,
    nextStep: followUp.step,
    nextAction: followUp.action,
    followUpDays: followUp.days,
    summary: parts.join(" "),
  };
}
