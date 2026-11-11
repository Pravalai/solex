import Link from "next/link";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { ArrowLeft, CheckCircle2, Circle, Clock } from "lucide-react";
import { NotFoundError } from "@/lib/errors";
import { formatBps, formatINR } from "@/lib/money";
import { formatDate, formatDateTime, humanize } from "@/lib/format";
import { requireActor } from "@/modules/identity/session";
import { can } from "@/modules/identity/permissions";
import { getBookingDetail } from "@/modules/reporting/bookings";
import { PAYMENT_MODES } from "@/modules/finance/payments";
import { DefinitionList, Meter, Money, PageHeader, Section } from "@/components/app/ui-bits";
import { BookingStatusPill, Pill } from "@/components/app/status";
import { CommissionTable, ScheduleTable } from "@/components/app/finance-tables";
import { SettleButton } from "@/components/app/settle-buttons";
import { ConfirmAction } from "@/components/app/interactive";
import { ActionForm, SubmitButton } from "@/components/app/action-form";
import { selectClass } from "@/components/app/styles";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import { approveBookingAction, cancelBookingAction, recordPaymentAction, rejectBookingAction, settleCommissionAction } from "../../actions";

export const metadata: Metadata = { title: "Booking" };

export default async function BookingPage({ params }: PageProps<"/bookings/[bookingId]">) {
  const actor = await requireActor({ permission: "booking.view" });
  const { bookingId } = await params;
  const b = await getBookingDetail(actor, bookingId).catch((err) => {
    if (err instanceof NotFoundError) notFound();
    throw err;
  });
  const snap = b.priceSnapshot;
  const live = b.status === "CONFIRMED" || b.status === "AGREEMENT";
  const pendingMgmt = b.status === "PENDING_MGMT_APPROVAL";
  const collectedPct = b.agreementValue > 0 ? Math.round((b.totals.received / b.agreementValue) * 100) : 0;

  const steps = [
    { label: "Booked", at: b.bookedAt, done: true },
    ...(b.approvalLevel !== "NONE" ? [{ label: "soleX approval", at: b.mgmtApprovedAt, done: !!b.mgmtApprovedAt }] : []),
    ...(b.approvalLevel === "DEVELOPER" ? [{ label: "Developer approval", at: b.devApprovedAt, done: !!b.devApprovedAt }] : []),
    { label: "Confirmed", at: b.confirmedAt, done: !!b.confirmedAt },
    { label: `Agreement (${formatBps(b.mandate.earningTriggerBps)} collected)`, at: b.agreementAt, done: !!b.agreementAt },
  ];

  return (
    <>
      <Link href="/bookings" className="mb-3 inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground">
        <ArrowLeft className="size-3" /> Bookings
      </Link>
      <PageHeader
        eyebrow={`${b.project.name} · mandate ${b.mandate.code}`}
        title={
          <span className="flex flex-wrap items-center gap-3">
            {b.code} <BookingStatusPill status={b.status} />
          </span>
        }
        subtitle={
          <>
            Unit{" "}
            <Link href={`/projects/${b.project.id}?unit=${b.unit.id}`} className="font-medium text-foreground hover:underline">
              {b.unit.unitNo}
            </Link>{" "}
            for {b.customer.name} · lead{" "}
            <Link href={`/leads/${b.lead.id}`} className="hover:underline">
              {b.lead.code}
            </Link>{" "}
            · {b.broker ? `via ${b.broker.firmName}` : "direct sale"} · closed by {b.salesExec.name}
          </>
        }
        actions={
          <>
            {pendingMgmt && can(actor, "discount.approve.management") && (
              <>
                <ConfirmAction
                  action={approveBookingAction}
                  fields={{ bookingId: b.id }}
                  label="Approve discount"
                  title={`Approve ${formatBps(b.discountBps)} discount?`}
                  description={
                    b.approvalLevel === "DEVELOPER"
                      ? "This is beyond the mandate band, so it will go to the developer for final approval."
                      : "The booking will be confirmed and the payment schedule and commissions created."
                  }
                  confirmLabel="Approve"
                  testId="approve-booking"
                />
                <ConfirmAction
                  action={rejectBookingAction}
                  fields={{ bookingId: b.id }}
                  label="Reject"
                  variant="outline"
                  title="Reject this discount?"
                  description="The unit is released back to inventory and the lead returns to negotiation."
                  reason={{ label: "Reason", placeholder: "e.g. below floor price" }}
                  confirmLabel="Reject"
                />
              </>
            )}
            {live && can(actor, "booking.cancel") && (
              <ConfirmAction
                action={cancelBookingAction}
                fields={{ bookingId: b.id }}
                label="Cancel booking"
                variant="destructive"
                title={`Cancel ${b.code}?`}
                description={
                  <ul className="list-disc space-y-1 pl-4">
                    <li>{b.unit.unitNo} goes back to available inventory.</li>
                    <li>Open instalments are cancelled; {formatBps(b.mandate.forfeitureBps)} of agreement value (max what was received) is forfeited, the rest becomes a refund.</li>
                    <li>Unsettled commissions are reversed; settled ones get a clawback line.</li>
                  </ul>
                }
                reason={{ label: "Cancellation reason" }}
                confirmLabel="Cancel booking"
                testId="cancel-booking"
              />
            )}
          </>
        }
      />

      <div className="mb-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <div className="rounded-xl border bg-card p-4">
          <div className="text-xs text-muted-foreground">Agreement value</div>
          <div className="mt-1 text-xl font-semibold" data-testid="agreement-value">
            <Money value={b.agreementValue} compact={false} />
          </div>
          {b.discountAmount > 0 && (
            <div className="text-xs text-muted-foreground">
              after {formatINR(b.discountAmount)} discount ({formatBps(b.discountBps)})
            </div>
          )}
        </div>
        <div className="rounded-xl border bg-card p-4">
          <div className="text-xs text-muted-foreground">Collected</div>
          <div className="mt-1 text-xl font-semibold" data-testid="collected">
            <Money value={b.totals.received} compact={false} />
          </div>
          <Meter value={b.totals.received} max={b.agreementValue} className="mt-2" />
          <div className="mt-1 text-xs text-muted-foreground">{collectedPct}% of agreement value</div>
        </div>
        <div className="rounded-xl border bg-card p-4">
          <div className="text-xs text-muted-foreground">Outstanding</div>
          <div className="mt-1 text-xl font-semibold">
            <Money value={b.totals.outstanding} compact={false} />
          </div>
          {b.status === "CANCELLED" && (
            <div className="text-xs text-muted-foreground">
              Refund due {formatINR(b.refundDue)} · forfeited {formatINR(b.forfeitedAmount)}
            </div>
          )}
        </div>
        <div className="rounded-xl border bg-card p-4">
          <div className="text-xs text-muted-foreground">Commission earning trigger</div>
          <div className="mt-1 text-xl font-semibold">
            <Money value={b.totals.threshold} compact={false} />
          </div>
          <div className={cn("text-xs", b.totals.thresholdMet ? "text-[oklch(0.4_0.1_155)]" : "text-muted-foreground")}>
            {b.totals.thresholdMet ? "Met: commissions earned" : `${formatBps(b.mandate.earningTriggerBps)} must be collected`}
          </div>
        </div>
      </div>

      <div className="mb-5 flex flex-wrap items-center gap-x-6 gap-y-2 rounded-xl border bg-card px-4 py-3">
        {steps.map((s, i) => (
          <div key={i} className="flex items-center gap-2 text-sm">
            {s.done ? <CheckCircle2 className="size-4 text-status-available" /> : i === steps.findIndex((x) => !x.done) && b.status !== "CANCELLED" ? <Clock className="size-4 text-status-hold" /> : <Circle className="size-4 text-muted-foreground/50" />}
            <span className={cn(!s.done && "text-muted-foreground")}>{s.label}</span>
            {s.at && <span className="text-xs text-muted-foreground">{formatDate(s.at)}</span>}
          </div>
        ))}
        {b.status === "CANCELLED" && <Pill tone="danger">Cancelled {formatDate(b.cancelledAt)}: {b.cancelReason}</Pill>}
        {b.status === "REJECTED" && <Pill>Rejected: {b.rejectionReason}</Pill>}
      </div>

      <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_380px]">
        <div className="space-y-5">
          <Section title="Payment schedule" description={b.installments.length ? "Generated from the project payment plan at confirmation; sums exactly to the agreement value." : "Created when the booking is confirmed."}>
            {b.installments.length > 0 ? <ScheduleTable installments={b.installments} /> : <p className="text-sm text-muted-foreground">No schedule yet. The booking is awaiting approval.</p>}
          </Section>

          {b.commissions.length > 0 && (
            <Section title="Commission ledger" description="Rates frozen from the mandate at accrual. Lines become earned when the collection trigger is met.">
              <CommissionTable
                lines={b.commissions}
                renderActions={(l) => (
                  <SettleButton action={settleCommissionAction} line={l} canApprove={can(actor, "commission.approve")} canSettle={can(actor, "commission.settle")} />
                )}
              />
            </Section>
          )}

          <Section title="Audit trail" description="Every state change on this booking, written in the same transaction as the change itself.">
            <ol className="space-y-2 text-sm">
              {b.timeline.map((e) => (
                <li key={e.id} className="grid grid-cols-[130px_1fr] gap-3">
                  <span className="text-xs text-muted-foreground">{formatDateTime(e.at)}</span>
                  <span>
                    <span className="mr-1.5 rounded bg-muted px-1.5 py-0.5 font-mono text-[10px]">{e.type}</span>
                    {e.summary} <span className="text-xs text-muted-foreground">· {e.actorName}</span>
                  </span>
                </li>
              ))}
            </ol>
          </Section>
        </div>

        <div className="space-y-5">
          {live && can(actor, "payment.record") && b.totals.outstanding > 0 && (
            <Section title="Record a payment" description="Allocated to instalments in due order. Bank references must be unique.">
              <ActionForm action={recordPaymentAction} resetOnSuccess className="grid gap-3">
                <input type="hidden" name="bookingId" value={b.id} />
                <div className="grid gap-1.5">
                  <Label htmlFor="amount">Amount (₹)</Label>
                  <Input
                    id="amount"
                    name="amount"
                    inputMode="numeric"
                    required
                    defaultValue={b.installments.find((i) => i.amountReceived < i.amountDue && i.status !== "CANCELLED")?.amountDue ?? ""}
                    data-testid="payment-amount"
                  />
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div className="grid gap-1.5">
                    <Label htmlFor="mode">Mode</Label>
                    <select id="mode" name="mode" className={selectClass} defaultValue="NEFT">
                      {PAYMENT_MODES.map((m) => (
                        <option key={m} value={m}>
                          {humanize(m)}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="grid gap-1.5">
                    <Label htmlFor="reference">UTR / reference</Label>
                    <Input id="reference" name="reference" required data-testid="payment-reference" />
                  </div>
                </div>
                <SubmitButton data-testid="record-payment">Record payment</SubmitButton>
              </ActionForm>
            </Section>
          )}

          <Section title="Price snapshot" description="Frozen at booking; later price revisions do not change it.">
            <DefinitionList
              className="text-xs"
              items={[
                ["Unit", `${snap.unitNo} · ${snap.config} · ${snap.superSqft} sq ft`],
                ["Rate", `${formatINR(Number(snap.ratePerSqft))}/sq ft`],
                ["Basic", formatINR(Number(snap.basicAmount))],
                ["Floor rise", formatINR(Number(snap.floorRiseAmount))],
                ["PLC", formatINR(Number(snap.plcAmount))],
                ["Parking", formatINR(Number(snap.parkingAmount))],
                ["Other charges", formatINR(Number(snap.otherCharges))],
                ["List price", formatINR(b.listPrice)],
                ["Discount", `−${formatINR(b.discountAmount)}`],
                [<strong key="a">Agreement value</strong>, <strong key="v">{formatINR(b.agreementValue)}</strong>],
              ]}
            />
          </Section>

          <Section title="Customer">
            <DefinitionList
              items={[
                ["Name", b.customer.name],
                ["Mobile", b.customer.phone ?? "—"],
                ["Email", b.customer.email ?? "—"],
                ["Source", humanize(b.lead.source)],
              ]}
            />
          </Section>

          {b.payments.length > 0 && (
            <Section title="Receipts">
              <ul className="space-y-2 text-sm">
                {b.payments.map((p) => (
                  <li key={p.id} className="flex items-start justify-between gap-2">
                    <div>
                      <div className="font-medium tabular">{formatINR(p.amount)}</div>
                      <div className="text-xs text-muted-foreground">
                        {humanize(p.mode)} · {p.reference} · {p.recordedBy.name}
                      </div>
                    </div>
                    <span className="text-xs text-muted-foreground">{formatDate(p.receivedAt)}</span>
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
