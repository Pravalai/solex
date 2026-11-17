import { formatINRCompact } from "@/lib/money";
import type { NextAction } from "./types";

/**
 * Follow-up WhatsApp drafts, filled from a template with the lead's own details.
 * No AI: the exec always sees and can edit the text before it is sent (and sending
 * is simulated through the notification outbox).
 */
export type DraftContext = {
  customerName: string;
  execName: string;
  projectName: string;
  locality: string;
  configPref: string | null;
  /** Cheapest available appointed unit matching the lead's configuration, if any. */
  fromPrice: number | null;
};

const first = (name: string) => name.trim().split(/\s+/)[0];

export function draftFollowUp(action: NextAction | null, ctx: DraftContext): string | null {
  if (!action || (action.kind !== "SEND_INFO" && action.kind !== "NURTURE")) return null;
  const hi = `Hi ${first(ctx.customerName)}, ${first(ctx.execName)} from soleX here.`;
  const home = ctx.configPref ? `${ctx.configPref} homes` : "homes";
  const price = ctx.fromPrice ? ` from ${formatINRCompact(ctx.fromPrice)}` : "";
  const sign = "Reply here with any questions.";

  if (action.kind === "NURTURE") {
    return `${hi} A quick update on ${ctx.projectName}, ${ctx.locality}: construction is on schedule and ${home} are still available${price}. No rush, I'll check in again in a couple of weeks. ${sign}`;
  }
  switch (action.info) {
    case "PAYMENT_PLAN":
      return `${hi} As promised, here are the payment-plan options for ${ctx.projectName}: ${home}${price}, with most of the payment linked to construction milestones, so the upfront amount stays low. Happy to walk you through the numbers on a call. ${sign}`;
    case "COMPARISON":
      return `${hi} As discussed, I'm sharing a side-by-side comparison of ${ctx.projectName} with the other project you are considering: price per sq ft, possession date, amenities and location. ${home} here start${price}. ${sign}`;
    default:
      return `${hi} Thanks for your time today. Sharing the brochure and current price sheet for ${ctx.projectName}, ${ctx.locality}: ${home} available${price}. ${sign}`;
  }
}
