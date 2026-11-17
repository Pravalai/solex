import { Minus, PhoneCall, PhoneMissed, ThumbsDown, ThumbsUp, type LucideIcon } from "lucide-react";
import { formatClock, formatDateTime, formatDuration } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { CallLine, Insight, InsightCategory, Polarity } from "@/modules/calls/types";
import { Pill } from "./status";

/**
 * Presentational pieces for calls. No hooks and no "use client", so the lead
 * page renders them on the server and the live call dialog reuses them.
 */

const SENTIMENT: Record<Polarity, { label: string; tone: "success" | "danger" | "neutral" }> = {
  POSITIVE: { label: "Positive", tone: "success" },
  NEGATIVE: { label: "Negative", tone: "danger" },
  NEUTRAL: { label: "Neutral", tone: "neutral" },
};

export function SentimentPill({ sentiment }: { sentiment: Polarity | null }) {
  if (!sentiment) return null;
  return (
    <Pill tone={SENTIMENT[sentiment].tone} className="gap-1">
      {SENTIMENT[sentiment].label}
    </Pill>
  );
}

const CATEGORY_LABEL: Record<InsightCategory, string> = {
  PRICE: "Price & budget",
  FINANCE: "Financing",
  UNIT_FIT: "Unit fit",
  LOCATION: "Location",
  POSSESSION: "Possession",
  COMPETITION: "Competition",
  AMENITIES: "Amenities",
  VISIT: "Site visit",
  DECISION: "Decision",
  INTEREST: "Interest",
};

const GROUPS: { polarity: Polarity; title: string; icon: LucideIcon; heading: string }[] = [
  { polarity: "POSITIVE", title: "Positive", icon: ThumbsUp, heading: "text-[oklch(0.38_0.1_155)]" },
  { polarity: "NEGATIVE", title: "Concerns", icon: ThumbsDown, heading: "text-destructive" },
  { polarity: "NEUTRAL", title: "Neutral", icon: Minus, heading: "text-muted-foreground" },
];

export function InsightGroups({ insights, className }: { insights: Insight[]; className?: string }) {
  return (
    <div className={cn("grid gap-2 sm:grid-cols-3", className)}>
      {GROUPS.map((g) => {
        const items = insights.filter((i) => i.polarity === g.polarity);
        return (
          <div key={g.polarity} className="rounded-lg border bg-card p-2.5" data-testid={`insights-${g.polarity.toLowerCase()}`}>
            <div className={cn("mb-1.5 flex items-center gap-1.5 text-xs font-semibold", g.heading)}>
              <g.icon className="size-3.5" />
              {g.title}
              <span className="ml-auto font-normal text-muted-foreground tabular">{items.length}</span>
            </div>
            {items.length === 0 ? (
              <p className="text-xs text-muted-foreground">None</p>
            ) : (
              <ul className="space-y-1.5">
                {items.map((i) => (
                  <li key={i.text} className="text-xs" data-testid="insight">
                    <span className="font-medium">{i.text}</span>
                    <span className="block text-[11px] leading-snug text-muted-foreground" title={i.quote}>
                      {CATEGORY_LABEL[i.category]} · “{i.quote}”
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        );
      })}
    </div>
  );
}

/** The three things worth knowing from a call: its best signal, its main concern, and what is still open. */
export function KeyPoints({ insights, className }: { insights: Insight[]; className?: string }) {
  const picks = GROUPS.map((g) => ({ g, i: insights.find((x) => x.polarity === g.polarity) })).filter((p) => p.i);
  if (picks.length === 0) return null;
  return (
    <ul className={cn("space-y-1", className)} data-testid="call-keypoints">
      {picks.map(({ g, i }) => (
        <li key={g.polarity} className="flex items-start gap-2 text-sm" title={`“${i!.quote}”`} data-testid="keypoint">
          <g.icon className={cn("mt-0.5 size-3.5 shrink-0", g.heading)} />
          <span>{i!.text}</span>
        </li>
      ))}
    </ul>
  );
}

const firstName = (name: string) => name.trim().split(/\s+/)[0];

export function TranscriptView({ lines, customerName, execName, className }: { lines: CallLine[]; customerName: string; execName: string; className?: string }) {
  return (
    <ol className={cn("space-y-2", className)}>
      {lines.map((l, i) => {
        const exec = l.speaker === "EXEC";
        return (
          <li key={i} data-testid="call-line" className={cn("flex animate-in fade-in slide-in-from-bottom-1 duration-300", exec ? "justify-end" : "justify-start")}>
            <div className={cn("max-w-[85%] rounded-xl px-3 py-1.5 text-xs leading-relaxed", exec ? "rounded-br-sm bg-primary/10" : "rounded-bl-sm bg-muted")}>
              <div className="mb-0.5 text-[10px] text-muted-foreground tabular">
                {exec ? firstName(execName) : firstName(customerName)} · {formatClock(l.at)}
              </div>
              {l.text}
            </div>
          </li>
        );
      })}
    </ol>
  );
}

export type CallRecord = {
  id: string;
  attempt: number;
  status: "IN_PROGRESS" | "COMPLETED" | "NO_ANSWER" | "DROPPED";
  startedAt: Date;
  talkSec: number;
  summary: string | null;
  sentiment: Polarity | null;
  interestScore: number | null;
  execTalkPct: number | null;
  user: { name: string };
  insights: Insight[];
  transcript: CallLine[];
};

/** One logged call on the lead timeline: key points up front; summary, all insights and transcript on demand. */
export function CallCard({ call, customerName }: { call: CallRecord; customerName: string }) {
  const connected = call.status === "COMPLETED";
  return (
    <article id={`call-${call.id}`} data-testid="call-card" className="scroll-mt-24 rounded-lg border bg-card p-3">
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
        {connected ? <PhoneCall className="size-3.5 text-primary" /> : <PhoneMissed className="size-3.5 text-destructive" />}
        <span className="font-medium text-foreground">{connected ? `Call · ${formatDuration(call.talkSec)}` : "No answer"}</span>
        <span>
          {formatDateTime(call.startedAt)} · {call.user.name}
        </span>
        {connected && (
          <span className="ml-auto flex items-center gap-1.5">
            <SentimentPill sentiment={call.sentiment} />
            <Pill tone="gold">Interest {call.interestScore}/5</Pill>
          </span>
        )}
      </div>
      {connected ? (
        <>
          <KeyPoints insights={call.insights} className="mt-2" />
          <details className="mt-2">
            <summary className="cursor-pointer text-xs font-medium text-primary">Summary, all insights and transcript</summary>
            <p className="mt-2 text-sm" data-testid="call-card-summary">
              {call.summary}
            </p>
            <InsightGroups insights={call.insights} className="mt-2" />
            <TranscriptView lines={call.transcript} customerName={customerName} execName={call.user.name} className="mt-2 max-h-80 overflow-y-auto rounded-lg border bg-background p-3" />
            <p className="mt-1 text-[11px] text-muted-foreground">Exec spoke {call.execTalkPct}% of the words.</p>
          </details>
        </>
      ) : (
        <p className="mt-1 text-xs text-muted-foreground" data-testid="call-card-summary">
          {call.summary}
        </p>
      )}
    </article>
  );
}
