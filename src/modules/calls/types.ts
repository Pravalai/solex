/**
 * Shapes shared by the calls module, the server actions and the call UI.
 * Type-only, so client components can import it without pulling in the database.
 */
export type Speaker = "EXEC" | "CUSTOMER";

/** One utterance; `at` is seconds from the moment the customer picked up. */
export type CallLine = { at: number; speaker: Speaker; text: string };

export type Polarity = "POSITIVE" | "NEGATIVE" | "NEUTRAL";

export type InsightCategory =
  | "PRICE"
  | "FINANCE"
  | "UNIT_FIT"
  | "LOCATION"
  | "POSSESSION"
  | "COMPETITION"
  | "AMENITIES"
  | "VISIT"
  | "DECISION"
  | "INTEREST";

export type Insight = {
  polarity: Polarity;
  category: InsightCategory;
  text: string;
  /** The customer's words the insight came from. */
  quote: string;
  atSec: number;
};

/**
 * The one thing the exec should do after a call, derived by rule from what the
 * customer said. Stored on the call as "KIND" or "KIND:INFO" so the lead page and
 * the exec's task list can offer it as a button.
 */
export type NextActionKind = "SCHEDULE_VISIT" | "SEND_INFO" | "CALL_BACK" | "NURTURE" | "RETRY";
export type InfoKind = "BROCHURE" | "PAYMENT_PLAN" | "COMPARISON";
export type NextAction = { kind: NextActionKind; info?: InfoKind };

const KINDS: NextActionKind[] = ["SCHEDULE_VISIT", "SEND_INFO", "CALL_BACK", "NURTURE", "RETRY"];
const INFOS: InfoKind[] = ["BROCHURE", "PAYMENT_PLAN", "COMPARISON"];

export function encodeNextAction(a: NextAction): string {
  return a.info ? `${a.kind}:${a.info}` : a.kind;
}

export function decodeNextAction(s: string | null | undefined): NextAction | null {
  if (!s) return null;
  const [kind, info] = s.split(":");
  if (!KINDS.includes(kind as NextActionKind)) return null;
  return INFOS.includes(info as InfoKind) ? { kind: kind as NextActionKind, info: info as InfoKind } : { kind: kind as NextActionKind };
}

const INFO_LABEL: Record<InfoKind, string> = {
  BROCHURE: "brochure and price sheet",
  PAYMENT_PLAN: "payment-plan options",
  COMPARISON: "side-by-side comparison",
};

/** Short button label for a next action. */
export function nextActionLabel(a: NextAction): string {
  switch (a.kind) {
    case "SCHEDULE_VISIT":
      return "Schedule the site visit";
    case "SEND_INFO":
      return `Send ${INFO_LABEL[a.info ?? "BROCHURE"]} on WhatsApp`;
    case "CALL_BACK":
      return "Call back";
    case "NURTURE":
      return "Send a project update on WhatsApp";
    case "RETRY":
      return "Call again";
  }
}

/** What the browser needs to play a call back: returned when the call is placed. */
export type CallSession = {
  id: string;
  attempt: number;
  answered: boolean;
  ringSec: number;
  durationSec: number;
  lines: CallLine[];
  customerName: string;
  execName: string;
};

/** Returned when the call ends and has been analysed and logged. */
export type CallOutcome = {
  id: string;
  status: "COMPLETED" | "NO_ANSWER";
  talkSec: number;
  summary: string;
  sentiment: Polarity | null;
  interestScore: number | null;
  execTalkPct: number | null;
  nextStep: string | null;
  nextAction: NextAction | null;
  nextFollowUpAt: Date | null;
  insights: Insight[];
  /** Set when the call showed enough interest to qualify a lead that is still new or contacted. */
  suggestQualify: boolean;
  /** Template-filled WhatsApp draft for SEND_INFO / NURTURE actions; the exec edits it before sending. */
  draft: string | null;
};
