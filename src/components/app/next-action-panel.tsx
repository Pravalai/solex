"use client";

import { useState } from "react";
import { BadgeCheck, CalendarCheck, CalendarPlus, CheckCircle2, MessageCircle, Phone, Sprout } from "lucide-react";
import { formatDateTime, toLocalInput } from "@/lib/format";
import { cn } from "@/lib/utils";
import { nextActionLabel, type NextAction } from "@/modules/calls/types";
import { changeStageAction, scheduleVisitAction, sendLeadMessageAction } from "@/app/(internal)/actions";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { ActionForm, SubmitButton } from "./action-form";

const ICON = { SCHEDULE_VISIT: CalendarPlus, SEND_INFO: MessageCircle, NURTURE: Sprout, CALL_BACK: Phone, RETRY: Phone } as const;

function tomorrowAt11() {
  const d = new Date();
  d.setDate(d.getDate() + 1);
  d.setHours(11, 0, 0, 0);
  return d;
}

type Props = {
  leadId: string;
  action: NextAction;
  /** The same advice in words, from the call analysis. */
  nextStep?: string | null;
  draft?: string | null;
  followUpAt?: Date | string | null;
  suggestQualify?: boolean;
  interestScore?: number | null;
  className?: string;
};

/**
 * The one suggested step after a call, done in place: schedule the visit,
 * send the promised information (template draft, simulated WhatsApp), or
 * confirm the call-back that was already set. Optionally qualify the lead.
 */
export function NextActionPanel({ leadId, action, nextStep, draft, followUpAt, suggestQualify, interestScore, className }: Props) {
  const [done, setDone] = useState<string | null>(null);
  const [qualified, setQualified] = useState(false);
  const Icon = ICON[action.kind];

  return (
    <div className={cn("rounded-lg border border-primary/25 bg-primary/[0.03] p-3", className)} data-testid="next-action">
      <div className="flex items-start gap-2">
        <Icon className="mt-0.5 size-4 shrink-0 text-primary" />
        <div className="min-w-0 flex-1">
          <div className="text-[11px] font-semibold tracking-wide text-primary uppercase">Next step</div>
          <div className="text-sm font-medium" data-testid="next-action-label">
            {nextActionLabel(action)}
          </div>
          {nextStep && <p className="text-xs text-muted-foreground">{nextStep}</p>}
        </div>
      </div>

      {done ? (
        <p className="mt-2 flex items-center gap-1.5 text-sm text-[oklch(0.4_0.1_155)]" data-testid="next-action-done">
          <CheckCircle2 className="size-4" /> {done}
        </p>
      ) : action.kind === "SCHEDULE_VISIT" ? (
        <ActionForm action={scheduleVisitAction} onSuccess={() => setDone("Visit scheduled. Confirmation sent to the customer.")} className="mt-2.5 flex flex-wrap items-center gap-2">
          <input type="hidden" name="leadId" value={leadId} />
          <Input name="scheduledAt" type="datetime-local" defaultValue={toLocalInput(tomorrowAt11())} required className="h-8 w-auto" aria-label="Visit date and time" suppressHydrationWarning />
          <SubmitButton size="sm" data-testid="next-action-schedule">
            Schedule visit
          </SubmitButton>
        </ActionForm>
      ) : action.kind === "SEND_INFO" || action.kind === "NURTURE" ? (
        <ActionForm action={sendLeadMessageAction} onSuccess={() => setDone("Sent on WhatsApp (simulated) and logged.")} className="mt-2.5 grid gap-2">
          <input type="hidden" name="leadId" value={leadId} />
          <Textarea name="body" defaultValue={draft ?? ""} rows={4} required className="text-sm" aria-label="WhatsApp message" data-testid="next-action-draft" />
          <div className="flex items-center justify-between gap-2">
            <span className="text-[11px] text-muted-foreground">Template draft: edit before sending. Delivery is simulated.</span>
            <SubmitButton size="sm" data-testid="next-action-send">
              Send on WhatsApp
            </SubmitButton>
          </div>
        </ActionForm>
      ) : (
        followUpAt && (
          <p className="mt-2 flex items-center gap-1.5 text-xs text-muted-foreground">
            <CalendarCheck className="size-3.5" /> Follow-up already set for {formatDateTime(followUpAt)}.
          </p>
        )
      )}

      {suggestQualify &&
        (qualified ? (
          <p className="mt-2 flex items-center gap-1.5 border-t pt-2 text-xs text-[oklch(0.4_0.1_155)]">
            <BadgeCheck className="size-3.5" /> Marked as qualified.
          </p>
        ) : (
          <ActionForm action={changeStageAction} onSuccess={() => setQualified(true)} className="mt-2 flex items-center justify-between gap-2 border-t pt-2" inlineError={false}>
            <input type="hidden" name="leadId" value={leadId} />
            <input type="hidden" name="stage" value="QUALIFIED" />
            <span className="text-xs text-muted-foreground">Interest {interestScore}/5 on this call: ready to qualify.</span>
            <SubmitButton size="xs" variant="outline" data-testid="next-action-qualify">
              Mark qualified
            </SubmitButton>
          </ActionForm>
        ))}
    </div>
  );
}
