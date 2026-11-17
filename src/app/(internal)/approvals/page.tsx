import Link from "next/link";
import type { Metadata } from "next";
import { formatBps, formatINR } from "@/lib/money";
import { formatDateTime } from "@/lib/format";
import { db } from "@/lib/db";
import { requireActor } from "@/modules/identity/session";
import { EmptyState, Money, PageHeader } from "@/components/app/ui-bits";
import { BookingStatusPill } from "@/components/app/status";
import { ConfirmAction } from "@/components/app/interactive";
import { approveBookingAction, rejectBookingAction } from "../actions";

export const metadata: Metadata = { title: "Approvals" };

export default async function ApprovalsPage() {
  await requireActor({ permission: "discount.approve.management" });
  const pending = await db.booking.findMany({
    where: { status: { in: ["PENDING_MGMT_APPROVAL", "PENDING_DEV_APPROVAL"] } },
    orderBy: { bookedAt: "asc" },
    include: {
      unit: { select: { unitNo: true } },
      project: { select: { name: true } },
      customer: { select: { name: true } },
      salesExec: { select: { name: true } },
      broker: { select: { firmName: true } },
      mandate: { select: { execMaxDiscountBps: true, mgmtMaxDiscountBps: true } },
    },
  });
  return (
    <>
      <PageHeader title="Discount approvals" subtitle="Above the sales exec's band. Above the mandate band, the developer decides next." />
      {pending.length === 0 ? (
        <EmptyState title="Nothing waiting for approval." />
      ) : (
        <div className="grid gap-3 lg:grid-cols-2">
          {pending.map((b) => (
            <div key={b.id} className="rounded-xl border bg-card p-4 shadow-xs" data-testid={`approval-${b.code}`}>
              <div className="flex items-start justify-between gap-2">
                <div>
                  <Link href={`/bookings/${b.id}`} className="font-semibold hover:underline">
                    {b.code}
                  </Link>
                  <div className="text-xs text-muted-foreground">
                    {b.unit.unitNo} · {b.project.name} · {b.customer.name} · {b.broker ? `via ${b.broker.firmName}` : "direct"} · by {b.salesExec.name}
                  </div>
                </div>
                <BookingStatusPill status={b.status} />
              </div>
              <div className="mt-3 grid grid-cols-3 gap-2 text-sm">
                <div>
                  <div className="text-xs text-muted-foreground">List price</div>
                  <Money value={b.listPrice} />
                </div>
                <div>
                  <div className="text-xs text-muted-foreground">Discount</div>
                  <span className="font-medium">
                    {formatINR(b.discountAmount)} ({formatBps(b.discountBps)})
                  </span>
                </div>
                <div>
                  <div className="text-xs text-muted-foreground">Agreement value</div>
                  <Money value={b.agreementValue} className="font-medium" />
                </div>
              </div>
              <p className="mt-2 text-xs text-muted-foreground">
                Bands: exec ≤ {formatBps(b.mandate.execMaxDiscountBps)}, soleX ≤ {formatBps(b.mandate.mgmtMaxDiscountBps)}, above → developer. Requested {formatDateTime(b.bookedAt)}.
              </p>
              {b.status === "PENDING_MGMT_APPROVAL" ? (
                <div className="mt-3 flex gap-2">
                  <ConfirmAction
                    action={approveBookingAction}
                    fields={{ bookingId: b.id }}
                    label="Approve"
                    title={`Approve ${formatBps(b.discountBps)} on ${b.code}?`}
                    description={b.approvalLevel === "DEVELOPER" ? "It will then go to the developer for final approval." : "The booking is confirmed immediately."}
                    confirmLabel="Approve"
                    testId={`approve-${b.code}`}
                  />
                  <ConfirmAction
                    action={rejectBookingAction}
                    fields={{ bookingId: b.id }}
                    label="Reject"
                    variant="outline"
                    title={`Reject the discount on ${b.code}?`}
                    reason={{ label: "Reason" }}
                    confirmLabel="Reject"
                  />
                </div>
              ) : (
                <p className="mt-3 text-xs font-medium text-[oklch(0.45_0.1_65)]">Approved by soleX ({b.mgmtApprovedBy}). Waiting for the developer.</p>
              )}
            </div>
          ))}
        </div>
      )}
    </>
  );
}
