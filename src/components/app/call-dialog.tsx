"use client";

import { useEffect, useEffectEvent, useRef, useState } from "react";
import { toast } from "sonner";
import { CalendarClock, FastForward, Loader2, Phone, PhoneOff, RotateCcw } from "lucide-react";
import { formatClock, formatDateTime, formatDuration } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { CallOutcome, CallSession } from "@/modules/calls/types";
import { endCallAction, startCallAction } from "@/app/(internal)/actions";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { InsightGroups, KeyPoints, SentimentPill, TranscriptView } from "./call-bits";
import { NextActionPanel } from "./next-action-panel";
import { Pill } from "./status";

type Phase = "idle" | "dialing" | "ringing" | "connected" | "processing" | "done";

/** Simulated seconds per real second: a two-minute call plays back in about thirty seconds. */
const SPEED = 4;

type Props = {
  leadId: string;
  customerName: string;
  phoneMasked: string;
  projectName: string;
  /** Trigger button text; defaults to "Call {first name}". */
  label?: string;
  size?: React.ComponentProps<typeof Button>["size"];
  variant?: "outline" | "default";
  /**
   * Controlled use (from a task list): no trigger button, the call is placed on
   * mount and `onClose` fires when the dialog is dismissed. The owner keeps this
   * component mounted while the page refreshes underneath it.
   */
  autoStart?: boolean;
  onClose?: () => void;
};

const startAction = startCallAction;
const endAction = endCallAction;

/**
 * Click-to-call from the lead page. The server places the (simulated) call and
 * returns the conversation; this component plays it back as a live call with a
 * running transcript. Hanging up, or the customer finishing, ends the call on
 * the server, which transcribes what was said up to that point, extracts
 * insights and logs the call on the lead timeline.
 */
export function CallDialog({ leadId, customerName, phoneMasked, projectName, label, size, variant = "outline", autoStart, onClose }: Props) {
  const [open, setOpen] = useState(false);
  const [phase, setPhase] = useState<Phase>("idle");
  const [session, setSession] = useState<CallSession | null>(null);
  const [outcome, setOutcome] = useState<CallOutcome | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [sim, setSim] = useState(0);
  const clock = useRef({ origin: 0, skip: 0 });
  const ending = useRef(false);
  const scroller = useRef<HTMLDivElement>(null);

  const first = customerName.trim().split(/\s+/)[0];
  const initials = customerName
    .split(/\s+/)
    .map((w) => w[0])
    .slice(0, 2)
    .join("")
    .toUpperCase();
  const active = phase === "dialing" || phase === "ringing" || phase === "connected" || phase === "processing";
  const heard = session && (phase === "connected" || phase === "processing") ? session.lines.filter((l) => l.at <= sim) : [];

  async function place() {
    setOpen(true);
    setPhase("dialing");
    setSession(null);
    setOutcome(null);
    setError(null);
    setSim(0);
    ending.current = false;
    const res = await startAction(leadId);
    if (!res.ok) {
      setError(res.error);
      setPhase("done");
      toast.error(res.error);
      return;
    }
    setSession(res.data);
    clock.current = { origin: performance.now(), skip: 0 };
    setPhase("ringing");
  }

  async function finish(talkSec: number | null) {
    if (!session || ending.current) return;
    ending.current = true;
    setPhase("processing");
    const res = await endAction({ callId: session.id, talkSec });
    setPhase("done");
    if (!res.ok) {
      setError(res.error);
      toast.error(res.error);
      return;
    }
    setOutcome(res.data);
    toast.success(res.data.status === "COMPLETED" ? "Call summarised and logged on the timeline." : "Missed call logged on the timeline.");
  }

  const tick = useEffectEvent(() => {
    if (!session || ending.current) return;
    const s = ((performance.now() - clock.current.origin) / 1000) * SPEED + clock.current.skip;
    if (phase === "ringing") {
      if (s < session.ringSec) return setSim(s);
      if (!session.answered) return void finish(null);
      clock.current = { origin: performance.now(), skip: 0 };
      setSim(0);
      setPhase("connected");
    } else if (phase === "connected") {
      if (s < session.durationSec) return setSim(s);
      // The customer said goodbye: the call ends by itself.
      setSim(session.durationSec);
      void finish(session.durationSec);
    }
  });

  useEffect(() => {
    if (phase !== "ringing" && phase !== "connected") return;
    const timer = setInterval(() => tick(), 200);
    return () => clearInterval(timer);
  }, [phase]);

  // Keep the newest line of the live transcript in view.
  useEffect(() => {
    scroller.current?.scrollTo({ top: scroller.current.scrollHeight, behavior: "smooth" });
  }, [heard.length]);

  // Controlled use: place the call as soon as the dialog mounts (once, even under StrictMode).
  const started = useRef(false);
  const autoPlace = useEffectEvent(() => void place());
  useEffect(() => {
    if (!autoStart || started.current) return;
    started.current = true;
    autoPlace();
  }, [autoStart]);

  function hangUp() {
    void finish(phase === "connected" ? sim : null);
  }

  function skipToEnd() {
    if (session) clock.current.skip = session.durationSec;
  }

  const status =
    phase === "dialing"
      ? "Dialling…"
      : phase === "ringing"
        ? "Ringing…"
        : phase === "connected"
          ? `Connected · ${formatClock(sim)}`
          : phase === "processing"
            ? "Transcribing and summarising…"
            : outcome?.status === "COMPLETED"
              ? `Call ended · ${formatDuration(outcome.talkSec)}`
              : outcome?.status === "NO_ANSWER"
                ? "No answer"
                : "Call failed";

  function close() {
    setOpen(false);
    setPhase("idle");
    onClose?.();
  }

  return (
    <>
      {!autoStart && (
        <Button
          onClick={place}
          data-testid="call-lead"
          size={size}
          variant={variant}
          className={variant === "outline" ? "border-primary/40 text-primary hover:bg-primary/5" : undefined}
        >
          <Phone className="size-4" /> {label ?? `Call ${first}`}
        </Button>
      )}
      <Dialog
        open={open}
        onOpenChange={(next) => {
          // A live call can only be ended with the hang-up button, never by clicking away.
          if (!next && active) return;
          if (!next) close();
          else setOpen(true);
        }}
      >
        <DialogContent
          className="max-h-[calc(100dvh-2rem)] grid-cols-[minmax(0,1fr)] grid-rows-[auto_auto_minmax(0,1fr)_auto] gap-0 overflow-hidden p-0 sm:max-w-xl"
          showCloseButton={!active}
        >
          <div className="flex items-center gap-3 border-b bg-muted/40 px-4 py-3 pr-12">
            <div className={cn("flex size-11 shrink-0 items-center justify-center rounded-full bg-primary text-sm font-semibold text-primary-foreground", phase === "ringing" && "animate-pulse")}>
              {initials}
            </div>
            <div className="min-w-0">
              <DialogTitle className="truncate">{customerName}</DialogTitle>
              <DialogDescription className="truncate">
                {phoneMasked} · {projectName}
              </DialogDescription>
            </div>
            <Pill tone="gold" className="ml-auto">
              Simulated
            </Pill>
          </div>

          <div className="flex items-center gap-2 px-4 py-2 text-xs">
            <span className={cn("size-2 rounded-full", phase === "connected" ? "bg-status-available" : active ? "animate-pulse bg-status-hold" : "bg-muted-foreground/40")} />
            <span className="font-medium tabular" data-testid="call-status">
              {status}
            </span>
            {phase === "connected" && <Waveform />}
            {session && <span className="ml-auto text-muted-foreground">Attempt {session.attempt}</span>}
          </div>

          <div className="min-h-0 overflow-y-auto px-4 pb-4">
            {(phase === "dialing" || phase === "ringing") && (
              <div className="flex h-64 flex-col items-center justify-center gap-3 rounded-lg border border-dashed text-muted-foreground">
                <span className="relative flex size-14 items-center justify-center rounded-full bg-primary/10 text-primary">
                  <span className="absolute inset-0 animate-ping rounded-full bg-primary/15" />
                  <Phone className="size-6" />
                </span>
                <p className="text-xs">{phase === "dialing" ? "Connecting through the soleX number…" : `Calling ${first}. Their number stays masked.`}</p>
              </div>
            )}

            {(phase === "connected" || phase === "processing") && session && (
              <div className="relative">
                <div className="mb-1.5 flex items-center justify-between text-[11px] font-medium tracking-wide text-muted-foreground uppercase">
                  <span>Live transcript</span>
                  <span className="normal-case">{heard.length === 0 ? "Listening…" : `${heard.length} lines`}</span>
                </div>
                <div ref={scroller} className="h-64 overflow-y-auto rounded-lg border bg-background p-3" data-testid="call-transcript">
                  <TranscriptView lines={heard} customerName={session.customerName} execName={session.execName} />
                </div>
                {phase === "processing" && (
                  <div className="absolute inset-0 top-6 flex items-center justify-center rounded-lg bg-background/80 text-sm">
                    <Loader2 className="mr-2 size-4 animate-spin" /> Extracting insights…
                  </div>
                )}
              </div>
            )}

            {phase === "done" && error && (
              <p role="alert" className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive" data-testid="call-error">
                {error}
              </p>
            )}

            {phase === "done" && outcome?.status === "NO_ANSWER" && (
              <div className="space-y-2 rounded-lg border p-4 text-sm" data-testid="call-outcome">
                <p data-testid="call-summary">{outcome.summary}</p>
                <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
                  <CalendarClock className="size-3.5" /> Follow-up set for {formatDateTime(outcome.nextFollowUpAt)}. Logged on the lead timeline.
                </p>
              </div>
            )}

            {phase === "done" && outcome?.status === "COMPLETED" && (
              <div className="space-y-3" data-testid="call-outcome">
                <div className="flex flex-wrap items-center gap-2">
                  <SentimentPill sentiment={outcome.sentiment} />
                  <Pill tone="gold">Interest {outcome.interestScore}/5</Pill>
                  {(outcome.execTalkPct ?? 0) > 60 && <span className="text-xs text-[oklch(0.45_0.1_65)]">You spoke {outcome.execTalkPct}% of the time: let the customer talk more</span>}
                  <span className="ml-auto text-[11px] text-muted-foreground">Logged on the timeline</span>
                </div>
                <KeyPoints insights={outcome.insights} />
                {outcome.nextAction && (
                  <NextActionPanel
                    leadId={leadId}
                    action={outcome.nextAction}
                    draft={outcome.draft}
                    followUpAt={outcome.nextFollowUpAt}
                    suggestQualify={outcome.suggestQualify}
                    interestScore={outcome.interestScore}
                  />
                )}
                <details className="text-sm">
                  <summary className="cursor-pointer text-xs font-medium text-primary">Full summary and all insights</summary>
                  <p className="mt-2 rounded-lg bg-muted/60 p-3 leading-relaxed" data-testid="call-summary">
                    {outcome.summary}
                  </p>
                  <InsightGroups insights={outcome.insights} className="mt-2" />
                </details>
              </div>
            )}
          </div>

          <div className="flex items-center justify-between gap-2 border-t bg-muted/30 px-4 py-3">
            <p className="text-[11px] text-muted-foreground">Simulated call · rule-based analysis</p>
            <div className="flex shrink-0 gap-2">
              {phase === "connected" && (
                <Button variant="outline" size="sm" onClick={skipToEnd} data-testid="call-skip">
                  <FastForward className="size-4" /> Skip to end
                </Button>
              )}
              {(phase === "ringing" || phase === "connected") && (
                <Button variant="destructive" size="sm" onClick={hangUp} data-testid="call-end">
                  <PhoneOff className="size-4" /> End call
                </Button>
              )}
              {phase === "done" && outcome?.status === "NO_ANSWER" && (
                <Button variant="outline" size="sm" onClick={place} data-testid="call-retry">
                  <RotateCcw className="size-4" /> Call again
                </Button>
              )}
              {phase === "done" && (
                <Button size="sm" variant={outcome?.nextAction && outcome.status === "COMPLETED" ? "outline" : "default"} onClick={() => close()} data-testid="call-done">
                  Done
                </Button>
              )}
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}

function Waveform() {
  return (
    <span className="flex h-3 items-end gap-0.5" aria-hidden>
      {[0, 150, 300, 450, 600].map((delay) => (
        <span key={delay} className="w-0.5 animate-pulse rounded-full bg-status-available" style={{ height: `${40 + ((delay / 150) % 3) * 30}%`, animationDelay: `${delay}ms` }} />
      ))}
    </span>
  );
}
