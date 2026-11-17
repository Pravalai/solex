/**
 * Shapes for the per-persona action queues. Type-only, so client components can
 * import them without pulling in the database.
 *
 * A queue item is one thing that needs the user now: a short title, a one-line
 * reason built from real data, the rule that raised it (shown on hover, so the
 * insight is never a black box) and the actions that resolve it in place.
 */
import type { CommissionKind, CommissionStatus } from "@/generated/prisma/enums";

export type Severity = "high" | "medium" | "low";

export type QueueAction =
  | { kind: "call"; leadId: string; customerName: string; phoneMasked: string; projectName: string }
  | { kind: "scheduleVisit"; leadId: string; defaultAt: string }
  | { kind: "confirmVisit"; visitId: string; defaultAt: string }
  | { kind: "approve"; bookingId: string; title: string; detail: string }
  | { kind: "recordPayment"; bookingId: string; amount: number }
  | { kind: "remind"; installmentId: string }
  | { kind: "settle"; line: { id: string; kind: CommissionKind; status: CommissionStatus; isAdjustment: boolean } }
  | { kind: "link"; href: string; label: string };

export type QueueItem = {
  id: string;
  severity: Severity;
  title: string;
  /** Where the title links to (the lead, booking or project). */
  href?: string;
  why: string;
  /** The rule that raised this item, in plain words. */
  rule: string;
  actions: QueueAction[];
};

export type Queue = { items: QueueItem[]; total: number };
