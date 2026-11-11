import { formatINRCompact } from "@/lib/money";
import type { CallLine, InsightCategory, Polarity } from "./types";

/**
 * Simulated conversation generator. Given a lead and a call attempt it produces
 * the same conversation every time (seeded by lead code + attempt), personalised
 * with the customer's name, the project, its price point and the customer's
 * budget. It stands in for a telephony provider plus speech-to-text: in
 * production the transcript would come from the recording instead.
 *
 * Pure: no database, no clock, no randomness beyond the seed.
 */

export type ScriptContext = {
  /** Stable per lead, e.g. the lead code. */
  seedKey: string;
  attempt: number;
  customerName: string;
  execName: string;
  projectName: string;
  locality: string;
  configPref: string | null;
  budgetMax: number | null;
  /** Lowest available list price for the customer's configuration, if any. */
  fromPrice: number | null;
  possessionDate: Date;
};

export type Scenario = "KEEN" | "PRICE_SENSITIVE" | "COMPARING" | "FAMILY" | "COLD";

export type CallScript = {
  scenario: Scenario;
  answered: boolean;
  ringSec: number;
  durationSec: number;
  lines: CallLine[];
};

type Stance = "POS" | "NEG" | "NEU";
type Topic = "UNIT_FIT" | "PRICE" | "DISCOUNT" | "FINANCE" | "LOCATION" | "AMENITIES" | "POSSESSION" | "COMPETITION";
type Closing = "VISIT_YES" | "VISIT_MAYBE" | "FAMILY" | "CALLBACK" | "NOT_NOW";

type Vars = {
  first: string;
  exec: string;
  project: string;
  locality: string;
  config: string;
  price: string | null;
  budget: string | null;
  possession: string;
};

/** A customer reply, tagged with what the transcript analyser is expected to extract from it. */
export type ResponseVariant = { text: (v: Vars) => string; category: InsightCategory; polarity: Polarity };

type TopicDef = {
  ask: (v: Vars) => string;
  replies: Partial<Record<Stance, ResponseVariant[]>>;
};

const r = (category: InsightCategory, polarity: Polarity, ...texts: ((v: Vars) => string)[]): ResponseVariant[] =>
  texts.map((text) => ({ text, category, polarity }));

/** Exported so tests can prove the analyser recognises every reply the generator can produce. */
export const TOPICS: Record<Topic, TopicDef> = {
  UNIT_FIT: {
    ask: (v) => `You had enquired about a ${v.config}. Is that still what you are looking for?`,
    replies: {
      POS: r("UNIT_FIT", "POSITIVE", (v) => `Yes, a ${v.config} is exactly what we need. The layout looked good in the brochure.`, (v) => `Yes ji, the ${v.config} layout is good, it suits our family.`),
      NEG: r("UNIT_FIT", "NEGATIVE", (v) => `Honestly the ${v.config} felt a bit small for us.`, (v) => `The ${v.config} layout is not working for us, the rooms felt small.`),
      NEU: r("UNIT_FIT", "NEUTRAL", () => `We are open between a 2BHK and a 3BHK right now.`, () => `We have not decided between a 2BHK and a 3BHK yet.`),
    },
  },
  PRICE: {
    ask: (v) =>
      v.price
        ? `${v.config} homes at ${v.project} start at around ${v.price}. Does that work for your budget?`
        : `Pricing depends on the floor and facing. Does the range we shared work for your budget?`,
    replies: {
      POS: r("PRICE", "POSITIVE", () => `That is within our budget, no problem there.`, () => `The price is reasonable for that location.`),
      NEG: r(
        "PRICE",
        "NEGATIVE",
        (v) => `That is above our budget${v.budget ? `, we were hoping to stay under ${v.budget}` : ""}.`,
        () => `It is too expensive for us, honestly.`,
      ),
      NEU: r("PRICE", "NEUTRAL", () => `We have not fixed our budget yet.`, () => `Our budget is flexible, it depends on the payment plan.`),
    },
  },
  DISCOUNT: {
    ask: () => `There is a festive offer running on select units this month.`,
    replies: {
      NEU: r("PRICE", "NEUTRAL", () => `Can you do a better discount than that?`, () => `Is there any extra discount if we book quickly?`),
    },
  },
  FINANCE: {
    ask: () => `Will you be taking a home loan for this?`,
    replies: {
      POS: r("FINANCE", "POSITIVE", () => `Our home loan is already pre-approved with the bank.`, () => `We will pay mostly from our own funds, so financing is not an issue.`),
      NEG: r("FINANCE", "NEGATIVE", () => `Loan eligibility is a concern for us right now.`, () => `I am worried about the EMI, to be honest.`),
      NEU: r("FINANCE", "NEUTRAL", () => `Yes, we will take a loan, still talking to banks.`, () => `Probably a loan, we are still comparing banks.`),
    },
  },
  LOCATION: {
    ask: (v) => `How do you find the location, ${v.locality}?`,
    replies: {
      POS: r("LOCATION", "POSITIVE", () => `The location is perfect, it is close to my office.`, () => `Location is great for us, the kids' school is nearby.`),
      NEG: r("LOCATION", "NEGATIVE", () => `The commute from there worries me a little.`, () => `It is a bit far from my workplace.`),
      NEU: r("LOCATION", "NEUTRAL", () => `We have not seen the area properly yet.`, () => `I need to check the connectivity once.`),
    },
  },
  AMENITIES: {
    ask: () => `Did you get a chance to look at the clubhouse and the amenities?`,
    replies: {
      POS: r("AMENITIES", "POSITIVE", () => `Yes, the clubhouse and the park really impressed us.`, () => `We loved the amenities, especially the park view.`),
      NEG: r("AMENITIES", "NEGATIVE", () => `The amenities are fewer than we expected.`, () => `Honestly the amenities were a little disappointing.`),
      NEU: r("AMENITIES", "NEUTRAL", () => `Not yet. Please send me the amenities list.`, () => `Can you share the full amenities list on WhatsApp?`),
    },
  },
  POSSESSION: {
    ask: (v) => `Possession is planned for ${v.possession}.`,
    replies: {
      POS: r("POSSESSION", "POSITIVE", () => `That timeline works well for us.`, () => `No hurry from our side, that date is fine.`),
      NEG: r("POSSESSION", "NEGATIVE", () => `That is too late for us, we need possession sooner.`, () => `We are worried about delays in possession.`),
      NEU: r("POSSESSION", "NEUTRAL", () => `Okay. Can you send me the latest construction updates?`, () => `Please share the construction status with photos.`),
    },
  },
  COMPETITION: {
    ask: () => `Are you also considering other projects?`,
    replies: {
      POS: r("COMPETITION", "POSITIVE", () => `No, this is our first choice.`, () => `Not really, we like this one the most.`),
      NEG: r(
        "COMPETITION",
        "NEGATIVE",
        () => `Yes, we are also considering another project nearby, and they quoted lower.`,
        () => `We are comparing it with another developer who is offering a better deal.`,
      ),
      NEU: r("COMPETITION", "NEUTRAL", () => `We have seen a couple of others, nothing final.`, () => `We are keeping our options open for now.`),
    },
  },
};

const VISIT_ASK = (v: Vars) => `Would you like to come for a site visit and see the sample ${v.config}?`;

export const CLOSINGS: Record<Closing, { ask: (v: Vars) => string; replies: ResponseVariant[] }> = {
  VISIT_YES: {
    ask: VISIT_ASK,
    replies: r("VISIT", "POSITIVE", () => `Yes, we would like to visit this Saturday.`, () => `Sure, we can visit on Sunday morning.`),
  },
  VISIT_MAYBE: {
    ask: VISIT_ASK,
    replies: r("VISIT", "NEUTRAL", () => `Maybe, let me check and confirm.`, () => `Let me check our schedule and confirm the day.`),
  },
  FAMILY: {
    ask: VISIT_ASK,
    replies: r("DECISION", "NEUTRAL", () => `I need to discuss it with my family first.`, () => `Let me discuss with my wife and get back to you.`),
  },
  CALLBACK: {
    ask: () => `Shall I hold a unit for you while you compare?`,
    replies: r("DECISION", "NEUTRAL", () => `Not yet. Please call me back next week.`, () => `No, please call me back next week once we decide.`),
  },
  NOT_NOW: {
    ask: VISIT_ASK,
    replies: [
      { text: () => `We are not planning a visit right now, we are just exploring.`, category: "VISIT", polarity: "NEGATIVE" },
      { text: () => `Not right now. Honestly we are not interested at the moment.`, category: "INTEREST", polarity: "NEGATIVE" },
    ],
  },
};

type ScenarioDef = {
  weight: number;
  /** Weights for a POS / NEG / NEU reply on topics the scenario does not force. */
  stance: [number, number, number];
  forced: Partial<Record<Topic, Stance>>;
  topics: number;
  closings: Closing[];
};

const SCENARIOS: Record<Scenario, ScenarioDef> = {
  KEEN: { weight: 3, stance: [6, 1, 2], forced: {}, topics: 4, closings: ["VISIT_YES"] },
  PRICE_SENSITIVE: { weight: 3, stance: [3, 2, 3], forced: { PRICE: "NEG", DISCOUNT: "NEU" }, topics: 4, closings: ["VISIT_MAYBE", "FAMILY"] },
  COMPARING: { weight: 2, stance: [2, 2, 3], forced: { COMPETITION: "NEG" }, topics: 4, closings: ["CALLBACK"] },
  FAMILY: { weight: 2, stance: [3, 1, 4], forced: {}, topics: 4, closings: ["FAMILY", "VISIT_YES"] },
  COLD: { weight: 1, stance: [1, 3, 3], forced: {}, topics: 2, closings: ["NOT_NOW"] },
};

const TOPIC_ORDER: Topic[] = ["UNIT_FIT", "PRICE", "DISCOUNT", "FINANCE", "LOCATION", "AMENITIES", "POSSESSION", "COMPETITION"];
const OPTIONAL_TOPICS: Topic[] = ["UNIT_FIT", "PRICE", "FINANCE", "LOCATION", "AMENITIES", "POSSESSION", "COMPETITION"];
const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

/** FNV-1a: a small, stable string hash for seeding. */
function hash(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

function rng(seed: string) {
  let a = hash(seed);
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function weighted<T>(rand: () => number, entries: [T, number][]): T {
  const total = entries.reduce((s, [, w]) => s + w, 0);
  let x = rand() * total;
  for (const [value, w] of entries) {
    x -= w;
    if (x < 0) return value;
  }
  return entries[entries.length - 1][0];
}

function pick<T>(rand: () => number, items: T[]): T {
  return items[Math.floor(rand() * items.length)];
}

function spokenMoney(amount: number): string {
  return formatINRCompact(amount).replace(" Cr", " crore").replace(" L", " lakh");
}

/** Roughly how long a line takes to say: ~2.6 words a second, at least two seconds. */
function speakingTime(text: string): number {
  return Math.max(2, Math.round(text.split(/\s+/).length / 2.6));
}

/**
 * Whether the customer picks up. The first call to a lead always connects (so a
 * demo never opens on a miss); later attempts go unanswered one time in four.
 */
export function willAnswer(seedKey: string, attempt: number): boolean {
  if (attempt <= 1) return true;
  return rng(`${seedKey}:${attempt}:ring`)() >= 0.25;
}

export function buildCallScript(ctx: ScriptContext): CallScript {
  const rand = rng(`${ctx.seedKey}:${Math.max(1, ctx.attempt)}`);
  const v: Vars = {
    first: ctx.customerName.trim().split(/\s+/)[0],
    exec: ctx.execName.trim().split(/\s+/)[0],
    project: ctx.projectName,
    locality: ctx.locality,
    config: ctx.configPref ?? "3BHK",
    price: ctx.fromPrice ? spokenMoney(ctx.fromPrice) : null,
    budget: ctx.budgetMax ? spokenMoney(ctx.budgetMax) : null,
    possession: `${MONTHS[ctx.possessionDate.getMonth()]} ${ctx.possessionDate.getFullYear()}`,
  };

  const scenario = weighted(rand, Object.entries(SCENARIOS).map(([k, d]) => [k as Scenario, d.weight]));
  const def = SCENARIOS[scenario];
  // A price point clearly above the stated budget makes a price objection likely, whatever the scenario.
  const priceAboveBudget = !!(ctx.fromPrice && ctx.budgetMax && ctx.fromPrice > ctx.budgetMax * 1.05);

  const chosen = new Set<Topic>(Object.keys(def.forced) as Topic[]);
  const pool = OPTIONAL_TOPICS.filter((t) => !chosen.has(t));
  const optionalWanted = def.topics - [...chosen].filter((t) => t !== "DISCOUNT").length;
  for (let i = 0; i < optionalWanted && pool.length > 0; i++) {
    chosen.add(pool.splice(Math.floor(rand() * pool.length), 1)[0]);
  }

  const turns: { speaker: "EXEC" | "CUSTOMER"; text: string }[] = [];
  const exec = (text: string) => turns.push({ speaker: "EXEC", text });
  const customer = (text: string) => turns.push({ speaker: "CUSTOMER", text });

  if (ctx.attempt <= 1) {
    exec(`Hello, am I speaking with ${v.first}? This is ${v.exec} from soleX, calling about your enquiry for ${v.project}.`);
  } else {
    exec(`Hello ${v.first}, ${v.exec} from soleX again, following up on ${v.project}. Is this a good time?`);
  }
  customer(
    scenario === "KEEN"
      ? `Yes, ${v.exec} ji. I am very interested in ${v.project}, tell me more.`
      : scenario === "COLD"
        ? `Yes, speaking, but I only have a couple of minutes.`
        : pick(rand, [`Yes, speaking. Tell me.`, `Haan ji, I had enquired about it.`]),
  );

  for (const topic of TOPIC_ORDER.filter((t) => chosen.has(t))) {
    const t = TOPICS[topic];
    let stance: Stance =
      def.forced[topic] ?? weighted<Stance>(rand, [["POS", def.stance[0]], ["NEG", def.stance[1]], ["NEU", def.stance[2]]]);
    if (topic === "PRICE" && priceAboveBudget && !def.forced.PRICE) stance = weighted<Stance>(rand, [["NEG", 5], ["NEU", 2], ["POS", 1]]);
    const options = t.replies[stance] ?? t.replies.NEU!;
    exec(t.ask(v));
    customer(pick(rand, options).text(v));
  }

  const closing = CLOSINGS[pick(rand, def.closings)];
  exec(closing.ask(v));
  customer(pick(rand, closing.replies).text(v));
  exec(`Thank you, ${v.first}. I will share the brochure and price sheet on WhatsApp right away.`);
  customer(`Okay, thank you. Bye.`);

  const lines: CallLine[] = [];
  let at = 1;
  for (const turn of turns) {
    lines.push({ at, speaker: turn.speaker, text: turn.text });
    at += speakingTime(turn.text) + 1;
  }

  const answered = willAnswer(ctx.seedKey, ctx.attempt);
  return {
    scenario,
    answered,
    ringSec: answered ? 6 + Math.floor(rand() * 7) : 30,
    durationSec: at,
    lines,
  };
}
