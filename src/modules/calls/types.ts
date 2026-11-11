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
  nextFollowUpAt: Date | null;
  insights: Insight[];
};
