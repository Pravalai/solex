import Link from "next/link";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { ArrowLeft, CalendarPlus, Handshake, Home, ShieldCheck } from "lucide-react";
import { NotFoundError } from "@/lib/errors";
import { addDays, now } from "@/lib/clock";
import { formatDate, formatDateTime, humanize } from "@/lib/format";
import { requireActor } from "@/modules/identity/session";
import { can } from "@/modules/identity/permissions";
import { getLeadDetail } from "@/modules/reporting/leads";
import { MANUAL_STAGES, ACTIVITY_TYPES, LEAD_MACHINE } from "@/modules/crm/leads";
import { DefinitionList, Money, PageHeader, Section } from "@/components/app/ui-bits";
import { BookingStatusPill, LeadStagePill, Pill, leadStageLabel } from "@/components/app/status";
import { ActionForm, SubmitButton } from "@/components/app/action-form";
import { selectClass } from "@/components/app/styles";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import {
  changeStageAction,
  completeVisitAction,
  logActivityAction,
  noShowAction,
  reassignLeadAction,
  scheduleVisitAction,
} from "../../actions";

export const metadata: Metadata = { title: "Lead" };

/** yyyy-MM-ddTHH:mm in local time, for datetime-local inputs. */
function localInput(d: Date) {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
}

const ACTIVITY_LABEL: Record<string, string> = {
  CREATED: "Lead captured",
  CALL: "Call",
  WHATSAPP: "WhatsApp",
  EMAIL: "Email",
  MEETING: "Meeting",
  NOTE: "Note",
  STAGE_CHANGE: "Stage change",
  ASSIGNMENT: "Assignment",
  VISIT_SCHEDULED: "Visit scheduled",
  VISIT_COMPLETED: "Visit completed",
  VISIT_NO_SHOW: "No-show",
};

export default async function LeadPage({ params }: PageProps<"/leads/[leadId]">) {
  const actor = await requireActor({ permission: "lead.view" });
  const { leadId } = await params;
  const lead = await getLeadDetail(actor, leadId).catch((err) => {
    if (err instanceof NotFoundError) notFound();
    throw err;
  });
  const canEdit = can(actor, "lead.update") && !["INVALID"].includes(lead.stage);
  const manualTargets = MANUAL_STAGES.filter((s) => LEAD_MACHINE[lead.stage].includes(s));
  const tomorrow = addDays(now(), 1);
  tomorrow.setHours(11, 0, 0, 0);

  return (
    <>
      <Link href="/leads" className="mb-3 inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground">
        <ArrowLeft className="size-3" /> Leads
      </Link>
      <PageHeader
        eyebrow={`${lead.code} · ${lead.project.name}`}
        title={
          <span className="flex flex-wrap items-center gap-3">
            {lead.name} <LeadStagePill stage={lead.stage} />
          </span>
        }
        subtitle={`Captured ${formatDateTime(lead.createdAt)} via ${lead.broker ? `partner ${lead.broker.firmName}` : humanize(lead.source)}${lead.lostReason ? ` · Lost: ${lead.lostReason}` : ""}`}
        actions={
          lead.bookable &&
          can(actor, "booking.create") && (
            <Button asChild data-testid="start-booking">
              <Link href={`/projects/${lead.project.id}?lead=${lead.id}`}>
                <Home className="size-4" /> Pick a unit to book
              </Link>
            </Button>
          )
        }
      />

      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_360px]">
        <div className="space-y-5">
          {canEdit && !lead.closed && (
            <Section title="Log an interaction">
              <ActionForm action={logActivityAction} resetOnSuccess className="grid gap-3">
                <input type="hidden" name="leadId" value={lead.id} />
                <div className="grid gap-3 sm:grid-cols-[160px_1fr]">
                  <select name="type" className={selectClass} defaultValue="CALL" aria-label="Interaction type">
                    {ACTIVITY_TYPES.map((t) => (
                      <option key={t} value={t}>
                        {ACTIVITY_LABEL[t]}
                      </option>
                    ))}
                  </select>
                  <Textarea name="note" placeholder="What happened? What does the customer want next?" rows={2} required data-testid="activity-note" />
                </div>
                <div className="flex flex-wrap items-end justify-between gap-3">
                  <div className="grid gap-1.5">
                    <Label htmlFor="nextFollowUpAt" className="text-xs">
                      Next follow-up
                    </Label>
                    <Input id="nextFollowUpAt" name="nextFollowUpAt" type="datetime-local" defaultValue={localInput(tomorrow)} className="w-56" />
                  </div>
                  <SubmitButton data-testid="log-activity">Log</SubmitButton>
                </div>
              </ActionForm>
            </Section>
          )}

          <Section title="Timeline" description="Every touchpoint, stage change and assignment, newest first.">
            <ol className="relative space-y-4 border-l pl-4">
              {lead.activities.map((a) => (
                <li key={a.id} className="text-sm">
                  <span className="absolute -left-1.5 mt-1 size-3 rounded-full border-2 border-card bg-gold" />
                  <div className="flex flex-wrap items-baseline gap-x-2 text-xs text-muted-foreground">
                    <span className="font-medium text-foreground">{ACTIVITY_LABEL[a.type] ?? humanize(a.type)}</span>
                    <span>{formatDateTime(a.at)}</span>
                    {a.user && <span>· {a.user.name}</span>}
                  </div>
                  <p className="mt-0.5">{a.type === "STAGE_CHANGE" ? a.note.split(" → ").map((s) => leadStageLabel(s as never)).join(" → ") : a.note}</p>
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
                ["Email", lead.email ?? "—"],
                ["Looking for", lead.configPref ?? "—"],
                ["Budget", lead.budgetMax ? <span key="b">{lead.budgetMin ? <><Money value={lead.budgetMin} /> – </> : "up to "}<Money value={lead.budgetMax} /></span> : "—"],
                ["Source", humanize(lead.source)],
                ["Campaign", lead.campaign ?? "—"],
                ["Owner", lead.assignedTo?.name ?? "Unassigned"],
              ]}
            />
            {lead.reassignTo.length > 1 && (
              <ActionForm action={reassignLeadAction} className="mt-3 flex gap-2">
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
          </Section>

          <Section title="Attribution">
            {lead.broker ? (
              <div className="space-y-2 text-sm">
                <div className="flex items-center gap-2">
                  <Handshake className="size-4 text-gold" />
                  <span className="font-medium">{lead.broker.firmName}</span>
                  <span className="text-xs text-muted-foreground">{lead.broker.code}</span>
                </div>
                <div className={cn("flex items-center gap-1.5 text-xs", lead.attributionActive ? "text-[oklch(0.4_0.1_155)]" : "text-destructive")}>
                  <ShieldCheck className="size-3.5" />
                  {lead.attributionActive ? `Protected until ${formatDate(lead.attributionExpiresAt)}` : `Protection lapsed on ${formatDate(lead.attributionExpiresAt)}: no brokerage if booked now`}
                </div>
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">Direct lead (soleX marketing). Duplicate registrations are blocked until {formatDate(lead.attributionExpiresAt)}.</p>
            )}
          </Section>

          {canEdit && manualTargets.length > 0 && (
            <Section title="Move stage">
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
                <SubmitButton variant="outline">Update stage</SubmitButton>
              </ActionForm>
            </Section>
          )}

          <Section title="Site visits">
            <div className="space-y-3">
              {lead.visits.map((v) => (
                <div key={v.id} className="rounded-lg border p-3 text-sm" data-testid="visit-card">
                  <div className="flex items-center justify-between">
                    <span className="font-medium">{formatDateTime(v.scheduledAt)}</span>
                    <Pill tone={v.status === "COMPLETED" ? "success" : v.status === "SCHEDULED" ? "warning" : "neutral"}>{humanize(v.status)}</Pill>
                  </div>
                  <div className="text-xs text-muted-foreground">With {v.assignedTo.name}</div>
                  {v.feedback && <p className="mt-1 text-xs">“{v.feedback}” · interest {v.rating}/5</p>}
                  {v.status === "SCHEDULED" && can(actor, "visit.manage") && (
                    <div className="mt-2 space-y-2 border-t pt-2">
                      <ActionForm action={completeVisitAction} className="grid gap-2">
                        <input type="hidden" name="visitId" value={v.id} />
                        <Textarea name="feedback" placeholder="Customer feedback" rows={2} required data-testid="visit-feedback" />
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
                            Mark completed
                          </SubmitButton>
                        </div>
                      </ActionForm>
                      <ActionForm action={noShowAction}>
                        <input type="hidden" name="visitId" value={v.id} />
                        <SubmitButton size="sm" variant="ghost" className="text-muted-foreground">
                          Customer did not come
                        </SubmitButton>
                      </ActionForm>
                    </div>
                  )}
                </div>
              ))}
              {lead.visits.length === 0 && <p className="text-xs text-muted-foreground">No visits yet.</p>}
              {can(actor, "visit.manage") && !lead.closed && (
                <ActionForm action={scheduleVisitAction} className="grid gap-2 rounded-lg border border-dashed p-3">
                  <input type="hidden" name="leadId" value={lead.id} />
                  <Label htmlFor="scheduledAt" className="flex items-center gap-1.5 text-xs">
                    <CalendarPlus className="size-3.5" /> Schedule a site visit
                  </Label>
                  <Input id="scheduledAt" name="scheduledAt" type="datetime-local" defaultValue={localInput(tomorrow)} required />
                  <SubmitButton size="sm" variant="outline" data-testid="schedule-visit">
                    Schedule &amp; send confirmation
                  </SubmitButton>
                </ActionForm>
              )}
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
        </div>
      </div>
    </>
  );
}
