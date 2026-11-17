import Link from "next/link";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { AlarmClock, ArrowLeft, CalendarPlus, Handshake, Home, ShieldCheck } from "lucide-react";
import { NotFoundError } from "@/lib/errors";
import { addDays, now } from "@/lib/clock";
import { formatDate, formatDateTime, humanize, toLocalInput } from "@/lib/format";
import { requireActor } from "@/modules/identity/session";
import { can } from "@/modules/identity/permissions";
import { getLeadDetail } from "@/modules/reporting/leads";
import { MANUAL_STAGES, LEAD_MACHINE } from "@/modules/crm/leads";
import { maskPhone } from "@/lib/phone";
import { DefinitionList, InfoTip, Money, PageHeader, Section } from "@/components/app/ui-bits";
import { BookingStatusPill, LeadStagePill, Pill, leadStageLabel } from "@/components/app/status";
import { ActionForm, SubmitButton } from "@/components/app/action-form";
import { CallDialog } from "@/components/app/call-dialog";
import { CallCard } from "@/components/app/call-bits";
import { NextActionPanel } from "@/components/app/next-action-panel";
import { selectClass } from "@/components/app/styles";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import { changeStageAction, completeVisitAction, confirmVisitAction, logActivityAction, noShowAction, reassignLeadAction, scheduleVisitAction } from "../../actions";

export const metadata: Metadata = { title: "Lead" };

const ACTIVITY_LABEL: Record<string, string> = {
  CREATED: "Lead captured",
  CALL: "Call",
  WHATSAPP: "WhatsApp",
  EMAIL: "Email",
  MEETING: "Meeting",
  NOTE: "Note",
  STAGE_CHANGE: "Stage change",
  ASSIGNMENT: "Assignment",
  VISIT_REQUESTED: "Visit requested by partner",
  VISIT_SCHEDULED: "Visit scheduled",
  VISIT_COMPLETED: "Visit completed",
  VISIT_NO_SHOW: "No-show",
};

/** Manual log types, most common first. Calls placed from soleX are logged automatically. */
const LOG_TYPES = [
  ["NOTE", "Note"],
  ["WHATSAPP", "WhatsApp"],
  ["MEETING", "Meeting"],
  ["EMAIL", "Email"],
  ["CALL", "Call (outside soleX)"],
] as const;

const VISIT_PILL: Record<string, { label: string; tone: "success" | "warning" | "neutral" | "gold" }> = {
  REQUESTED: { label: "Requested by partner", tone: "gold" },
  SCHEDULED: { label: "Scheduled", tone: "warning" },
  COMPLETED: { label: "Completed", tone: "success" },
  NO_SHOW: { label: "No-show", tone: "neutral" },
  CANCELLED: { label: "Cancelled", tone: "neutral" },
};

export default async function LeadPage({ params }: PageProps<"/leads/[leadId]">) {
  const actor = await requireActor({ permission: "lead.view" });
  const { leadId } = await params;
  const lead = await getLeadDetail(actor, leadId).catch((err) => {
    if (err instanceof NotFoundError) notFound();
    throw err;
  });
  const at = now();
  const canEdit = can(actor, "lead.update") && lead.stage !== "INVALID";
  const canCall = can(actor, "call.place") && lead.stage !== "INVALID";
  const canVisit = can(actor, "visit.manage") && !lead.closed;
  const canBook = lead.bookable && can(actor, "booking.create");
  const manualTargets = MANUAL_STAGES.filter((s) => LEAD_MACHINE[lead.stage].includes(s));
  const tomorrow = addDays(at, 1);
  tomorrow.setHours(11, 0, 0, 0);
  const overdue = !lead.closed && !!lead.nextFollowUpAt && lead.nextFollowUpAt < at;
  const hasUpcomingVisit = lead.visits.some((v) => v.status === "REQUESTED" || (v.status === "SCHEDULED" && v.scheduledAt >= at));
  const source = lead.broker ? `${lead.broker.firmName} (${lead.broker.code})` : `${humanize(lead.source)}${lead.campaign ? ` · ${lead.campaign}` : ""}`;

  return (
    <>
      <Link href="/leads" className="mb-3 inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground">
        <ArrowLeft className="size-3" /> Leads
      </Link>
      <PageHeader
        title={
          <span className="flex flex-wrap items-center gap-3">
            {lead.name} <LeadStagePill stage={lead.stage} />
          </span>
        }
        subtitle={`${lead.code} · ${lead.project.name} · ${lead.broker ? `Partner: ${lead.broker.firmName}` : humanize(lead.source)}${lead.assignedTo ? ` · ${lead.assignedTo.name}` : ""}${lead.lostReason ? ` · Lost: ${lead.lostReason}` : ""}`}
        actions={
          <div className="flex flex-wrap gap-2">
            {canCall && <CallDialog leadId={lead.id} customerName={lead.name} phoneMasked={maskPhone(lead.phone)} projectName={lead.project.name} />}
            {canBook && (
              <Button asChild data-testid="start-booking">
                <Link href={`/projects/${lead.project.id}?lead=${lead.id}`}>
                  <Home className="size-4" /> Book a unit
                </Link>
              </Button>
            )}
          </div>
        }
      />

      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_340px]">
        <div className="space-y-5">
          {!lead.closed && (
            <div id="next" className="scroll-mt-24">
              {lead.nextAction && canEdit ? (
                <NextActionPanel leadId={lead.id} action={lead.nextAction} nextStep={lead.nextStep} draft={lead.draft} followUpAt={lead.nextFollowUpAt} />
              ) : (
                lead.nextFollowUpAt && (
                  <div className={cn("flex items-center gap-2 rounded-lg border px-3 py-2.5 text-sm", overdue && "border-status-hold/60 bg-status-hold/10")}>
                    <AlarmClock className={cn("size-4", overdue ? "text-[oklch(0.5_0.13_50)]" : "text-muted-foreground")} />
                    <span>
                      Next follow-up <strong>{formatDateTime(lead.nextFollowUpAt)}</strong>
                      {overdue && <span className="text-[oklch(0.5_0.13_50)]"> · overdue</span>}
                    </span>
                  </div>
                )
              )}
            </div>
          )}

          <Section title="Activity">
            {canEdit && !lead.closed && (
              <ActionForm action={logActivityAction} resetOnSuccess className="mb-4 flex flex-wrap gap-2">
                <input type="hidden" name="leadId" value={lead.id} />
                <select name="type" className={cn(selectClass, "w-auto")} defaultValue="NOTE" aria-label="Interaction type">
                  {LOG_TYPES.map(([value, label]) => (
                    <option key={value} value={value}>
                      {label}
                    </option>
                  ))}
                </select>
                <Input name="note" placeholder="Add a note or log a touchpoint…" required className="min-w-48 flex-1" data-testid="activity-note" />
                <SubmitButton variant="outline" data-testid="log-activity">
                  Log
                </SubmitButton>
              </ActionForm>
            )}
            <ol className="relative space-y-4 border-l pl-4">
              {lead.activities.map((a) => (
                <li key={a.id} className="text-sm">
                  <span className="absolute -left-1.5 mt-1 size-3 rounded-full border-2 border-card bg-gold" />
                  {a.call ? (
                    <CallCard call={a.call} customerName={lead.name} />
                  ) : (
                    <>
                      <div className="flex flex-wrap items-baseline gap-x-2 text-xs text-muted-foreground">
                        <span className="font-medium text-foreground">{ACTIVITY_LABEL[a.type] ?? humanize(a.type)}</span>
                        <span>{formatDateTime(a.at)}</span>
                        {a.user && <span>· {a.user.name}</span>}
                      </div>
                      <p className="mt-0.5">{a.type === "STAGE_CHANGE" ? a.note.split(" → ").map((s) => leadStageLabel(s as never)).join(" → ") : a.note}</p>
                    </>
                  )}
                </li>
              ))}
            </ol>
          </Section>
        </div>

        <div className="space-y-5">
          <Section title="Customer">
            <DefinitionList
              items={[
                ["Mobile", lead.phone],
                [
                  "Wants",
                  <span key="w">
                    {lead.configPref ?? "—"}
                    {lead.budgetMax ? (
                      <>
                        {" · "}
                        {lead.budgetMin ? (
                          <>
                            <Money value={lead.budgetMin} />–
                          </>
                        ) : (
                          "up to "
                        )}
                        <Money value={lead.budgetMax} />
                      </>
                    ) : null}
                  </span>,
                ],
                ["Source", source],
                ["Owner", lead.assignedTo?.name ?? "Unassigned"],
              ]}
            />
            <div className={cn("mt-3 flex items-center gap-1.5 border-t pt-3 text-xs", lead.attributionActive ? "text-[oklch(0.4_0.1_155)]" : "text-muted-foreground")}>
              {lead.broker ? <Handshake className="size-3.5 text-gold" /> : <ShieldCheck className="size-3.5" />}
              {lead.broker
                ? lead.attributionActive
                  ? `Partner protected until ${formatDate(lead.attributionExpiresAt)}`
                  : `Partner protection lapsed ${formatDate(lead.attributionExpiresAt)}: no brokerage if booked now`
                : `Direct lead · duplicates blocked until ${formatDate(lead.attributionExpiresAt)}`}
            </div>
          </Section>

          {lead.bestFit.length > 0 && (
            <Section
              title={
                <span className="flex items-center gap-1.5">
                  Units that fit <InfoTip>Available units of their preferred configuration, priced within their budget plus 5%, closest to budget first.</InfoTip>
                </span>
              }
            >
              <ul className="space-y-2" data-testid="best-fit">
                {lead.bestFit.map((u) => (
                  <li key={u.id} className="flex items-center justify-between gap-2 text-sm">
                    <div className="min-w-0">
                      <div className="font-medium">
                        {u.unitNo} <span className="font-normal text-muted-foreground">· {u.config}</span>
                      </div>
                      <div className="text-xs text-muted-foreground">
                        Floor {u.floor} · {u.facing} · <Money value={u.listPrice} />
                        {u.overBudget && <span className="text-[oklch(0.5_0.13_50)]"> · over budget</span>}
                      </div>
                    </div>
                    {canBook ? (
                      <Button asChild size="xs" variant="outline">
                        <Link href={`/projects/${lead.project.id}?lead=${lead.id}&unit=${u.id}`} data-testid={`book-fit-${u.unitNo}`}>
                          Book
                        </Link>
                      </Button>
                    ) : (
                      <span className="shrink-0 text-[11px] text-muted-foreground">Qualify to book</span>
                    )}
                  </li>
                ))}
              </ul>
            </Section>
          )}

          <Section title="Site visits">
            <div id="visits" className="scroll-mt-24 space-y-3">
              {lead.visits.map((v) => (
                <div key={v.id} className="rounded-lg border p-3 text-sm" data-testid="visit-card">
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-medium">{formatDateTime(v.scheduledAt)}</span>
                    <Pill tone={VISIT_PILL[v.status]?.tone ?? "neutral"}>{VISIT_PILL[v.status]?.label ?? humanize(v.status)}</Pill>
                  </div>
                  {v.feedback && (
                    <p className="mt-1 text-xs text-muted-foreground">
                      “{v.feedback}” · interest {v.rating}/5
                    </p>
                  )}
                  {v.status === "REQUESTED" && canVisit && (
                    <ActionForm action={confirmVisitAction} className="mt-2 flex flex-wrap items-center gap-2 border-t pt-2">
                      <input type="hidden" name="visitId" value={v.id} />
                      <Input name="scheduledAt" type="datetime-local" defaultValue={toLocalInput(v.scheduledAt)} required className="h-8 w-auto" aria-label="Visit date and time" />
                      <SubmitButton size="sm" data-testid="confirm-visit">
                        Confirm
                      </SubmitButton>
                    </ActionForm>
                  )}
                  {v.status === "SCHEDULED" && canVisit && (
                    <details className="mt-2 border-t pt-2" open={v.scheduledAt < at}>
                      <summary className="cursor-pointer text-xs font-medium text-primary">Record outcome</summary>
                      <ActionForm action={completeVisitAction} className="mt-2 grid gap-2">
                        <input type="hidden" name="visitId" value={v.id} />
                        <Textarea name="feedback" placeholder="What did they think?" rows={2} required data-testid="visit-feedback" />
                        <div className="flex items-center gap-2">
                          <Label htmlFor={`rating-${v.id}`} className="text-xs">
                            Interest
                          </Label>
                          <select id={`rating-${v.id}`} name="rating" className={cn(selectClass, "w-20")} defaultValue="4">
                            {[5, 4, 3, 2, 1].map((n) => (
                              <option key={n} value={n}>
                                {n}/5
                              </option>
                            ))}
                          </select>
                          <SubmitButton size="sm" className="ml-auto" data-testid="complete-visit">
                            Completed
                          </SubmitButton>
                        </div>
                      </ActionForm>
                      <ActionForm action={noShowAction}>
                        <input type="hidden" name="visitId" value={v.id} />
                        <SubmitButton size="sm" variant="ghost" className="px-0 text-muted-foreground">
                          Customer did not come
                        </SubmitButton>
                      </ActionForm>
                    </details>
                  )}
                </div>
              ))}
              {canVisit && !hasUpcomingVisit && (
                <ActionForm action={scheduleVisitAction} className="grid gap-2 rounded-lg border border-dashed p-3">
                  <input type="hidden" name="leadId" value={lead.id} />
                  <Label htmlFor="scheduledAt" className="flex items-center gap-1.5 text-xs">
                    <CalendarPlus className="size-3.5" /> Schedule a site visit
                  </Label>
                  <div className="flex gap-2">
                    <Input id="scheduledAt" name="scheduledAt" type="datetime-local" defaultValue={toLocalInput(tomorrow)} required className="min-w-0 flex-1" />
                    <SubmitButton size="sm" variant="outline" data-testid="schedule-visit">
                      Schedule
                    </SubmitButton>
                  </div>
                </ActionForm>
              )}
              {lead.visits.length === 0 && !canVisit && <p className="text-xs text-muted-foreground">No visits yet.</p>}
            </div>
          </Section>

          {lead.bookings.length > 0 && (
            <Section title="Bookings">
              <ul className="space-y-2 text-sm">
                {lead.bookings.map((b) => (
                  <li key={b.id} className="flex items-center justify-between gap-2">
                    <Link href={`/bookings/${b.id}`} className="font-medium text-primary hover:underline">
                      {b.code} · {b.unit.unitNo}
                    </Link>
                    <BookingStatusPill status={b.status} />
                  </li>
                ))}
              </ul>
            </Section>
          )}

          {canEdit && (manualTargets.length > 0 || lead.reassignTo.length > 1) && (
            <details className="rounded-xl border bg-card px-4 py-3 shadow-xs">
              <summary className="cursor-pointer text-sm font-semibold">Change stage or owner</summary>
              <div className="mt-3 space-y-4">
                {manualTargets.length > 0 && (
                  <ActionForm action={changeStageAction} className="grid gap-2">
                    <input type="hidden" name="leadId" value={lead.id} />
                    <select name="stage" className={selectClass} defaultValue={manualTargets[0]} aria-label="New stage">
                      {manualTargets.map((s) => (
                        <option key={s} value={s}>
                          {leadStageLabel(s)}
                        </option>
                      ))}
                    </select>
                    <Input name="reason" placeholder="Reason (required for Lost)" />
                    <SubmitButton variant="outline" data-testid="update-stage">
                      Update stage
                    </SubmitButton>
                  </ActionForm>
                )}
                {lead.reassignTo.length > 1 && (
                  <ActionForm action={reassignLeadAction} className="flex gap-2">
                    <input type="hidden" name="leadId" value={lead.id} />
                    <select name="userId" className={selectClass} defaultValue={lead.assignedTo?.id} aria-label="Reassign to">
                      {lead.reassignTo.map((u) => (
                        <option key={u.id} value={u.id}>
                          {u.name}
                        </option>
                      ))}
                    </select>
                    <SubmitButton variant="outline">Reassign</SubmitButton>
                  </ActionForm>
                )}
              </div>
            </details>
          )}
        </div>
      </div>
    </>
  );
}
