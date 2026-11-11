import Link from "next/link";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { ArrowLeft, Info, UserRound, X } from "lucide-react";
import { NotFoundError } from "@/lib/errors";
import { formatBps, formatINR } from "@/lib/money";
import { formatDate, formatDateTime } from "@/lib/format";
import type { Actor } from "@/modules/identity/actor";
import { can } from "@/modules/identity/permissions";
import { requireActor } from "@/modules/identity/session";
import { getStackingPlan, getUnitDetail } from "@/modules/reporting/inventory";
import { bookableLeadsFor, getLeadDetail } from "@/modules/reporting/leads";
import { DefinitionList, Meter, Money, PageHeader, Section } from "@/components/app/ui-bits";
import { BookingStatusPill, Pill, UnitStatusPill } from "@/components/app/status";
import { StackingPlan, StatusLegend } from "@/components/app/stacking-plan";
import { Countdown, UrlSheet } from "@/components/app/interactive";
import { BookingForm } from "@/components/app/booking-form";
import { ActionForm, SubmitButton } from "@/components/app/action-form";
import { createBookingAction, holdUnitAction, releaseHoldAction } from "../../actions";

export const metadata: Metadata = { title: "Inventory" };

async function load<T>(p: Promise<T>): Promise<T> {
  try {
    return await p;
  } catch (err) {
    if (err instanceof NotFoundError) notFound();
    throw err;
  }
}

export default async function ProjectPage({ params, searchParams }: PageProps<"/projects/[projectId]">) {
  const actor = await requireActor();
  const { projectId } = await params;
  const sp = await searchParams;
  const unitId = typeof sp.unit === "string" ? sp.unit : undefined;
  const leadId = typeof sp.lead === "string" ? sp.lead : undefined;

  const plan = await load(getStackingPlan(actor, projectId));
  const bookingFor = leadId && can(actor, "lead.view") ? await getLeadDetail(actor, leadId).catch(() => null) : null;
  const units = plan.towers.flatMap((t) => t.floors.flatMap((f) => f.units));
  const appointed = units.filter((u) => !u.retained);
  const absorbed = appointed.filter((u) => u.status === "BOOKED" || u.status === "SOLD").length;
  const m = plan.mandate;

  const base = `/projects/${projectId}`;
  const withLead = (extra: Record<string, string> = {}) => {
    const q = new URLSearchParams({ ...(bookingFor ? { lead: bookingFor.id } : {}), ...extra });
    return q.size ? `${base}?${q}` : base;
  };

  return (
    <>
      <Link href="/projects" className="mb-3 inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground">
        <ArrowLeft className="size-3" /> All projects
      </Link>
      <PageHeader
        eyebrow={`${plan.project.developerName} · ${plan.project.city}`}
        title={plan.project.name}
        subtitle={`${plan.project.locality} · RERA ${plan.project.reraNo} · possession ${formatDate(plan.project.possessionDate)}`}
      />

      {bookingFor && (
        <div className="mb-4 flex flex-wrap items-center justify-between gap-2 rounded-xl border border-gold/50 bg-gold-soft px-4 py-3 text-sm" data-testid="booking-mode">
          <span className="flex items-center gap-2">
            <UserRound className="size-4 text-gold" />
            Booking for <strong>{bookingFor.name}</strong> ({bookingFor.code}). Pick an available unit.
          </span>
          <Link href={base} className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground">
            <X className="size-3" /> Exit booking mode
          </Link>
        </div>
      )}

      <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_320px]">
        <Section
          title="Stacking plan"
          description="Click a unit for pricing, history and actions. Status is live; holds lapse automatically."
          actions={<StatusLegend />}
        >
          <StackingPlan towers={plan.towers} hrefFor={(u) => withLead({ unit: u.id })} selectedId={unitId} />
        </Section>

        <div className="space-y-5">
          {m && (
            <Section title={`Mandate ${m.code}`} description={`${formatDate(m.startDate)} – ${formatDate(m.endDate)} · ${m.daysLeft} days left`}>
              <div className="text-xs text-muted-foreground">Absorption vs target</div>
              <div className="mt-1 flex items-baseline justify-between">
                <span className="text-xl font-semibold tabular">
                  {absorbed} / {m.targetUnits}
                </span>
                <span className="text-xs text-muted-foreground">{appointed.filter((u) => u.status === "AVAILABLE").length} available</span>
              </div>
              <Meter value={absorbed} max={m.targetUnits} tone="gold" className="mt-2" />
              <DefinitionList
                className="mt-4 text-xs"
                items={[
                  ["soleX fee", `${formatBps(m.soleXFeeBps)}${m.feeTierBps ? ` → ${formatBps(m.feeTierBps)} after ${m.feeTierUnits} units` : ""}`],
                  ["Partner brokerage", m.brokerPayoutBps != null ? formatBps(m.brokerPayoutBps) : "—"],
                  ["Staff incentive", m.incentiveBps != null ? formatBps(m.incentiveBps) : "—"],
                  ["Earned when collected", formatBps(m.earningTriggerBps)],
                  ["Discount: exec / soleX", `${formatBps(m.execMaxDiscountBps)} / ${formatBps(m.mgmtMaxDiscountBps)}`],
                  ["Above that", "Developer approves"],
                  ["Hold time", `${m.holdMinutes} min`],
                  ["Partner attribution", `${m.attributionWindowDays} days`],
                  ["Cancellation forfeiture", formatBps(m.forfeitureBps)],
                ]}
              />
            </Section>
          )}
          <Section title={plan.project.paymentPlanName} description={`Base rate ${formatINR(plan.project.baseRatePerSqft)}/sq ft`}>
            <ul className="space-y-1.5 text-xs">
              {plan.planStages.map((s) => (
                <li key={s.label} className="flex justify-between gap-3">
                  <span>{s.label}</span>
                  <span className="text-muted-foreground tabular">
                    {formatBps(s.bps)} · day {s.dueOffsetDays}
                  </span>
                </li>
              ))}
            </ul>
          </Section>
        </div>
      </div>

      {unitId && <UnitDrawer actor={actor} unitId={unitId} closeHref={withLead()} projectId={projectId} leadId={bookingFor?.id} bands={m} />}
    </>
  );
}

async function UnitDrawer({
  actor,
  unitId,
  closeHref,
  projectId,
  leadId,
  bands,
}: {
  actor: Actor;
  unitId: string;
  closeHref: string;
  projectId: string;
  leadId?: string;
  bands: { execMaxDiscountBps: number; mgmtMaxDiscountBps: number } | null;
}) {
  const unit = await getUnitDetail(actor, unitId).catch(() => null);
  if (!unit) return null;
  const canBook = can(actor, "booking.create") && !unit.retained && (unit.status === "AVAILABLE" || unit.heldByMe) && !unit.approvalLock;
  const leads = canBook ? await bookableLeadsFor(actor, projectId) : [];
  const live = unit.bookings.find((b) => ["CONFIRMED", "AGREEMENT", "PENDING_MGMT_APPROVAL", "PENDING_DEV_APPROVAL"].includes(b.status));

  return (
    <UrlSheet
      closeHref={closeHref}
      title={
        <span className="flex items-center gap-2" data-testid="unit-drawer-title">
          {unit.unitNo} <UnitStatusPill status={unit.status} retained={unit.retained} approvalLock={unit.approvalLock} />
        </span>
      }
      description={`${unit.config} · ${unit.superSqft} sq ft super (${unit.carpetSqft} carpet) · floor ${unit.floor} · ${unit.facing}`}
    >
      {unit.retained && (
        <div className="flex gap-2 rounded-lg border bg-muted/50 p-3 text-xs text-muted-foreground">
          <Info className="size-4 shrink-0" /> This unit is retained by the developer and is not part of soleX&apos;s appointed inventory. It cannot be held or booked.
        </div>
      )}

      <div>
        <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Price breakdown</h3>
        <DefinitionList
          items={[
            ["Basic", <Money key="b" value={unit.price.basicAmount} compact={false} />],
            ["Floor rise", <Money key="f" value={unit.price.floorRiseAmount} compact={false} />],
            ["Preferential location", <Money key="p" value={unit.price.plcAmount} compact={false} />],
            ["Parking", <Money key="k" value={unit.price.parkingAmount} compact={false} />],
            ["Club + maintenance deposit", <Money key="o" value={unit.price.otherCharges} compact={false} />],
            [<strong key="l">List price</strong>, <strong key="lv"><Money value={unit.price.listPrice} compact={false} /></strong>],
          ]}
        />
      </div>

      {unit.status === "HOLD" && !unit.approvalLock && (
        <div className="rounded-lg border border-status-hold/50 bg-status-hold/10 p-3 text-sm">
          <div className="font-medium">On hold for {unit.heldByMe ? "you" : unit.holdBy}</div>
          {unit.holdExpiresAt && <Countdown until={unit.holdExpiresAt} className="text-xs text-muted-foreground" />}
          {(unit.heldByMe || actor.role === "MANAGEMENT") && (
            <ActionForm action={releaseHoldAction} className="mt-2">
              <input type="hidden" name="unitId" value={unit.id} />
              <SubmitButton variant="outline" size="sm">
                Release hold
              </SubmitButton>
            </ActionForm>
          )}
        </div>
      )}

      {live && (
        <div className="rounded-lg border p-3 text-sm">
          <div className="flex items-center justify-between">
            <Link href={`/bookings/${live.id}`} className="font-medium text-primary hover:underline">
              {live.code}
            </Link>
            <BookingStatusPill status={live.status} />
          </div>
          <div className="mt-1 text-xs text-muted-foreground">
            {live.customerName} · <Money value={live.agreementValue} /> · {formatDate(live.bookedAt)}
          </div>
        </div>
      )}

      {can(actor, "inventory.hold") && unit.status === "AVAILABLE" && !unit.retained && (
        <ActionForm action={holdUnitAction}>
          <input type="hidden" name="unitId" value={unit.id} />
          <input type="hidden" name="version" value={unit.version} />
          <SubmitButton variant="outline" className="w-full" data-testid="hold-unit">
            Hold while I close with the customer
          </SubmitButton>
        </ActionForm>
      )}

      {canBook && bands && (
        <div>
          <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Book this unit</h3>
          <BookingForm
            action={createBookingAction}
            unit={{ id: unit.id, unitNo: unit.unitNo, listPrice: unit.price.listPrice, version: unit.version }}
            leads={leads.map((l) => ({ id: l.id, code: l.code, name: l.name, brokerName: l.broker?.firmName ?? null }))}
            bands={bands}
            defaultLeadId={leadId}
          />
        </div>
      )}

      <div>
        <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">History</h3>
        {unit.history.length === 0 ? (
          <p className="text-xs text-muted-foreground">No changes recorded yet.</p>
        ) : (
          <ol className="space-y-2 border-l pl-3">
            {unit.history.map((h) => (
              <li key={h.id} className="text-xs">
                <div className="text-muted-foreground">
                  {formatDateTime(h.at)} · {h.actorName}
                </div>
                <div>{h.summary}</div>
              </li>
            ))}
          </ol>
        )}
      </div>
      {unit.mandateCode && <Pill tone="gold">Mandate {unit.mandateCode}</Pill>}
    </UrlSheet>
  );
}
