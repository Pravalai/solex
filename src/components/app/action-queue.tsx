"use client";

import { useState } from "react";
import Link from "next/link";
import { CheckCircle2, Phone } from "lucide-react";
import { humanize, toLocalInput } from "@/lib/format";
import { cn } from "@/lib/utils";
import { PAYMENT_MODES } from "@/modules/finance/modes";
import type { Queue, QueueAction, QueueItem, Severity } from "@/modules/reporting/queue-types";
import {
  approveBookingAction,
  confirmVisitAction,
  recordPaymentAction,
  rejectBookingAction,
  scheduleVisitAction,
  sendPaymentReminderAction,
  settleCommissionAction,
} from "@/app/(internal)/actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ActionForm, SubmitButton } from "./action-form";
import { CallDialog } from "./call-dialog";
import { ConfirmAction } from "./interactive";
import { SettleButton } from "./settle-buttons";
import { selectClass } from "./styles";
import { InfoTip } from "./ui-bits";

const DOT: Record<Severity, string> = {
  high: "bg-destructive",
  medium: "bg-status-hold",
  low: "bg-muted-foreground/40",
};

type CallTarget = Extract<QueueAction, { kind: "call" }> & { key: number };

/**
 * A persona's task list: each row says what needs doing, why (one line, from
 * live data), the rule behind it (hover the "i"), and resolves it in place.
 * The call dialog lives here, not in the row, so it survives the row
 * disappearing when the page refreshes after the call is logged.
 */
export function ActionQueue({
  title,
  queue,
  emptyTitle = "All clear",
  emptyHint,
  showAllHref,
  className,
}: {
  title: React.ReactNode;
  queue: Queue;
  emptyTitle?: string;
  emptyHint?: string;
  showAllHref?: string;
  className?: string;
}) {
  const [call, setCall] = useState<CallTarget | null>(null);

  return (
    <section className={cn("rounded-xl border bg-card shadow-xs", className)} data-testid="action-queue">
      <div className="flex items-center justify-between gap-2 border-b px-4 py-3">
        <h2 className="flex items-center gap-2 text-sm font-semibold">
          {title}
          {queue.total > 0 && <span className="rounded-full bg-primary px-1.5 text-[11px] font-semibold text-primary-foreground tabular">{queue.total}</span>}
        </h2>
        {showAllHref && queue.total > queue.items.length && (
          <Link href={showAllHref} className="text-xs font-medium text-primary hover:underline">
            Show all {queue.total}
          </Link>
        )}
      </div>
      {queue.items.length === 0 ? (
        <div className="flex flex-col items-center gap-1 px-4 py-8 text-center">
          <CheckCircle2 className="size-6 text-[oklch(0.55_0.12_155)]" />
          <p className="text-sm font-medium">{emptyTitle}</p>
          {emptyHint && <p className="text-xs text-muted-foreground">{emptyHint}</p>}
        </div>
      ) : (
        <ul className="divide-y">
          {queue.items.map((item) => (
            <QueueRow key={item.id} item={item} onCall={(c) => setCall({ ...c, key: Date.now() })} />
          ))}
        </ul>
      )}
      {call && (
        <CallDialog
          key={call.key}
          leadId={call.leadId}
          customerName={call.customerName}
          phoneMasked={call.phoneMasked}
          projectName={call.projectName}
          autoStart
          onClose={() => setCall(null)}
        />
      )}
    </section>
  );
}

type Expanded = "schedule" | "confirm" | "payment" | null;

function QueueRow({ item, onCall }: { item: QueueItem; onCall: (c: Extract<QueueAction, { kind: "call" }>) => void }) {
  const [expanded, setExpanded] = useState<Expanded>(null);
  const toggle = (e: Exclude<Expanded, null>) => setExpanded((cur) => (cur === e ? null : e));

  return (
    <li className="flex gap-3 px-4 py-3" data-testid="queue-item" data-item={item.id}>
      <span className={cn("mt-1.5 size-2 shrink-0 rounded-full", DOT[item.severity])} aria-label={`${item.severity} priority`} />
      <div className="min-w-0 flex-1">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
          <div className="min-w-0">
            <div className="flex items-center gap-1.5">
              {item.href ? (
                <Link href={item.href} className="truncate text-sm font-medium hover:underline" data-testid="queue-item-title">
                  {item.title}
                </Link>
              ) : (
                <span className="truncate text-sm font-medium" data-testid="queue-item-title">
                  {item.title}
                </span>
              )}
              <InfoTip label="Why is this here?">{item.rule}</InfoTip>
            </div>
            <p className="text-xs text-muted-foreground">{item.why}</p>
          </div>
          <div className="flex shrink-0 flex-wrap items-center gap-1.5">
            {item.actions.map((a, i) => (
              <ActionButton key={i} action={a} primary={i === 0} expanded={expanded} toggle={toggle} onCall={onCall} />
            ))}
          </div>
        </div>
        {expanded && <InlineForm item={item} expanded={expanded} onDone={() => setExpanded(null)} />}
      </div>
    </li>
  );
}

function ActionButton({
  action: a,
  primary,
  expanded,
  toggle,
  onCall,
}: {
  action: QueueAction;
  primary: boolean;
  expanded: Expanded;
  toggle: (e: Exclude<Expanded, null>) => void;
  onCall: (c: Extract<QueueAction, { kind: "call" }>) => void;
}) {
  const variant = primary ? "default" : "outline";
  switch (a.kind) {
    case "call":
      return (
        <Button size="sm" variant={variant} onClick={() => onCall(a)} data-testid="queue-call">
          <Phone className="size-3.5" /> Call
        </Button>
      );
    case "scheduleVisit":
      return (
        <Button size="sm" variant={expanded === "schedule" ? "secondary" : variant} onClick={() => toggle("schedule")} data-testid="queue-schedule">
          Schedule visit
        </Button>
      );
    case "confirmVisit":
      return (
        <Button size="sm" variant={expanded === "confirm" ? "secondary" : variant} onClick={() => toggle("confirm")} data-testid="queue-confirm-visit">
          Confirm visit
        </Button>
      );
    case "recordPayment":
      return (
        <Button size="sm" variant={expanded === "payment" ? "secondary" : variant} onClick={() => toggle("payment")} data-testid="queue-record-payment">
          Record payment
        </Button>
      );
    case "remind":
      return (
        <ActionForm action={sendPaymentReminderAction} inlineError={false}>
          <input type="hidden" name="installmentId" value={a.installmentId} />
          <SubmitButton size="sm" variant={variant} data-testid="queue-remind">
            Send reminder
          </SubmitButton>
        </ActionForm>
      );
    case "approve":
      return (
        <>
          <ConfirmAction
            action={approveBookingAction}
            fields={{ bookingId: a.bookingId }}
            label="Approve"
            title={`Approve ${a.title}?`}
            description={a.detail}
            confirmLabel="Approve discount"
            testId="queue-approve"
          />
          <ConfirmAction
            action={rejectBookingAction}
            fields={{ bookingId: a.bookingId }}
            label="Reject"
            title={`Reject ${a.title}?`}
            description="The unit is released and the sales exec is told why."
            confirmLabel="Reject"
            reason={{ label: "Reason", placeholder: "e.g. Above the band for this floor" }}
            variant="outline"
            testId="queue-reject"
          />
        </>
      );
    case "settle":
      return <SettleButton action={settleCommissionAction} line={a.line} canApprove canSettle size="sm" />;
    case "link":
      return (
        <Button asChild size="sm" variant={variant}>
          <Link href={a.href}>{a.label}</Link>
        </Button>
      );
  }
}

function InlineForm({ item, expanded, onDone }: { item: QueueItem; expanded: Exclude<Expanded, null>; onDone: () => void }) {
  if (expanded === "schedule" || expanded === "confirm") {
    const a = item.actions.find((x) => x.kind === (expanded === "schedule" ? "scheduleVisit" : "confirmVisit")) as
      | Extract<QueueAction, { kind: "scheduleVisit" }>
      | Extract<QueueAction, { kind: "confirmVisit" }>;
    return (
      <ActionForm action={expanded === "schedule" ? scheduleVisitAction : confirmVisitAction} onSuccess={onDone} className="mt-2 flex flex-wrap items-center gap-2">
        {"leadId" in a ? <input type="hidden" name="leadId" value={a.leadId} /> : <input type="hidden" name="visitId" value={a.visitId} />}
        <Input name="scheduledAt" type="datetime-local" defaultValue={toLocalInput(a.defaultAt)} required className="h-8 w-auto" aria-label="Visit date and time" />
        <SubmitButton size="sm" data-testid="queue-visit-save">
          {expanded === "schedule" ? "Schedule & notify customer" : "Confirm & notify"}
        </SubmitButton>
      </ActionForm>
    );
  }
  const a = item.actions.find((x) => x.kind === "recordPayment") as Extract<QueueAction, { kind: "recordPayment" }>;
  return (
    <ActionForm action={recordPaymentAction} onSuccess={onDone} className="mt-2 flex flex-wrap items-center gap-2">
      <input type="hidden" name="bookingId" value={a.bookingId} />
      <Input name="amount" type="number" defaultValue={a.amount} min={1} required className="h-8 w-32" aria-label="Amount (₹)" />
      <select name="mode" defaultValue="NEFT" className={cn(selectClass, "h-8 w-auto")} aria-label="Payment mode">
        {PAYMENT_MODES.map((m) => (
          <option key={m} value={m}>
            {humanize(m)}
          </option>
        ))}
      </select>
      <Input name="reference" placeholder="UTR / reference" required className="h-8 w-40" aria-label="UTR / reference" data-testid="queue-payment-ref" />
      <SubmitButton size="sm" data-testid="queue-payment-save">
        Save receipt
      </SubmitButton>
    </ActionForm>
  );
}
