import type { BookingStatus, CommissionStatus, LeadStage, UnitStatus } from "@/generated/prisma/enums";
import { cn } from "@/lib/utils";
import { humanize } from "@/lib/format";

/** One status colour language, used everywhere a unit, lead, booking or commission appears. */
export const UNIT_STATUS_STYLE: Record<UnitStatus | "RETAINED", { label: string; cell: string; dot: string }> = {
  AVAILABLE: { label: "Available", cell: "bg-status-available/12 border-status-available/40 text-[oklch(0.38_0.09_155)] hover:bg-status-available/22", dot: "bg-status-available" },
  HOLD: { label: "On hold", cell: "bg-status-hold/20 border-status-hold/60 text-[oklch(0.45_0.1_70)] hover:bg-status-hold/30", dot: "bg-status-hold" },
  BLOCKED: { label: "Blocked", cell: "bg-status-blocked/25 border-status-blocked/60 text-muted-foreground hover:bg-status-blocked/35", dot: "bg-status-blocked" },
  BOOKED: { label: "Booked", cell: "bg-status-booked/15 border-status-booked/50 text-[oklch(0.4_0.12_255)] hover:bg-status-booked/25", dot: "bg-status-booked" },
  SOLD: { label: "Sold", cell: "bg-status-sold text-white border-status-sold hover:bg-status-sold/90", dot: "bg-status-sold" },
  RETAINED: { label: "Not in mandate", cell: "hatched border-border text-muted-foreground/70", dot: "hatched border border-border" },
};

type Tone = "neutral" | "info" | "success" | "warning" | "danger" | "gold" | "navy";
const TONE: Record<Tone, string> = {
  neutral: "bg-muted text-muted-foreground border-border",
  info: "bg-status-booked/10 text-[oklch(0.42_0.12_255)] border-status-booked/30",
  success: "bg-status-available/12 text-[oklch(0.38_0.1_155)] border-status-available/35",
  warning: "bg-status-hold/18 text-[oklch(0.45_0.1_65)] border-status-hold/50",
  danger: "bg-destructive/10 text-destructive border-destructive/30",
  gold: "bg-gold-soft text-[oklch(0.45_0.07_70)] border-gold/40",
  navy: "bg-status-sold text-white border-status-sold",
};

export function Pill({ tone = "neutral", children, className }: { tone?: Tone; children: React.ReactNode; className?: string }) {
  return (
    <span className={cn("inline-flex items-center whitespace-nowrap rounded-full border px-2 py-0.5 text-[11px] font-medium", TONE[tone], className)}>
      {children}
    </span>
  );
}

export function UnitStatusPill({ status, retained, approvalLock }: { status: UnitStatus; retained?: boolean; approvalLock?: boolean }) {
  if (retained) return <Pill>Not in mandate</Pill>;
  const tone: Record<UnitStatus, Tone> = { AVAILABLE: "success", HOLD: "warning", BLOCKED: "neutral", BOOKED: "info", SOLD: "navy" };
  return <Pill tone={tone[status]}>{approvalLock ? "Locked · awaiting approval" : UNIT_STATUS_STYLE[status].label}</Pill>;
}

const LEAD_TONE: Record<LeadStage, Tone> = {
  NEW: "gold",
  CONTACTED: "info",
  QUALIFIED: "info",
  FOLLOW_UP: "info",
  VISIT_PLANNED: "warning",
  VISIT_DONE: "warning",
  NEGOTIATION: "warning",
  BOOKING_INITIATED: "warning",
  BOOKED: "success",
  LOST: "neutral",
  INVALID: "neutral",
};
const LEAD_LABEL: Partial<Record<LeadStage, string>> = { VISIT_PLANNED: "Visit planned", VISIT_DONE: "Visit done", FOLLOW_UP: "Follow-up" };

export function leadStageLabel(stage: LeadStage) {
  return LEAD_LABEL[stage] ?? humanize(stage);
}

export function LeadStagePill({ stage }: { stage: LeadStage }) {
  return <Pill tone={LEAD_TONE[stage]}>{leadStageLabel(stage)}</Pill>;
}

const BOOKING_TONE: Record<BookingStatus, Tone> = {
  PENDING_MGMT_APPROVAL: "warning",
  PENDING_DEV_APPROVAL: "warning",
  CONFIRMED: "info",
  AGREEMENT: "success",
  CANCELLED: "danger",
  REJECTED: "neutral",
};
const BOOKING_LABEL: Record<BookingStatus, string> = {
  PENDING_MGMT_APPROVAL: "Awaiting soleX approval",
  PENDING_DEV_APPROVAL: "Awaiting developer approval",
  CONFIRMED: "Confirmed",
  AGREEMENT: "Agreement stage",
  CANCELLED: "Cancelled",
  REJECTED: "Discount rejected",
};

export function bookingStatusLabel(status: BookingStatus) {
  return BOOKING_LABEL[status];
}

export function BookingStatusPill({ status }: { status: BookingStatus }) {
  return <Pill tone={BOOKING_TONE[status]}>{BOOKING_LABEL[status]}</Pill>;
}

const COMMISSION_TONE: Record<CommissionStatus, Tone> = {
  ACCRUED: "neutral",
  EARNED: "gold",
  INVOICED: "info",
  RECEIVED: "success",
  APPROVED: "info",
  PAID: "success",
  REVERSED: "danger",
};

export function CommissionStatusPill({ status }: { status: CommissionStatus }) {
  return <Pill tone={COMMISSION_TONE[status]}>{humanize(status)}</Pill>;
}
