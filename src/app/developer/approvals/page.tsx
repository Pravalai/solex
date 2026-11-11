import type { Metadata } from "next";
import { formatBps, formatINR } from "@/lib/money";
import { formatDateTime } from "@/lib/format";
import { requireActor } from "@/modules/identity/session";
import { listDeveloperApprovals } from "@/modules/reporting/portals";
import { EmptyState, Money, PageHeader } from "@/components/app/ui-bits";
import { ConfirmAction } from "@/components/app/interactive";
import { developerApproveAction, developerRejectAction } from "../actions";

export const metadata: Metadata = { title: "Approvals" };

export default async function DeveloperApprovals() {
  const actor = await requireActor({ roles: ["DEVELOPER"] });
  const pending = await listDeveloperApprovals(actor);
  return (
    <>
      <PageHeader
        eyebrow="Pricing control"
        title="Discount approvals"
        subtitle="soleX can approve discounts within the band agreed in the mandate. Anything larger needs your decision here."
      />
      {pending.length === 0 ? (
        <EmptyState title="Nothing needs your approval." />
      ) : (
        <div className="grid gap-3 lg:grid-cols-2">
          {pending.map((b) => (
            <div key={b.id} className="rounded-xl border bg-card p-4 shadow-xs" data-testid={`dev-approval-${b.code}`}>
              <div className="font-semibold">
                {b.code} · {b.unit.unitNo}
              </div>
              <div className="text-xs text-muted-foreground">
                {b.project.name} · {b.unit.config} · {b.unit.superSqft} sq ft · {b.customer.name}
              </div>
              <div className="mt-3 grid grid-cols-3 gap-2 text-sm">
                <div>
                  <div className="text-xs text-muted-foreground">List price</div>
                  <Money value={b.listPrice} />
                </div>
                <div>
                  <div className="text-xs text-muted-foreground">Discount requested</div>
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
                Mandate band {formatBps(b.mandate.mgmtMaxDiscountBps)}. Endorsed by {b.mgmtApprovedBy} (soleX) on {formatDateTime(b.mgmtApprovedAt)}.
              </p>
              <div className="mt-3 flex gap-2">
                <ConfirmAction
                  action={developerApproveAction}
                  fields={{ bookingId: b.id }}
                  label="Approve"
                  title={`Approve ${formatBps(b.discountBps)} on ${b.unit.unitNo}?`}
                  description="The booking is confirmed, the customer's payment schedule is issued and the soleX fee starts accruing."
                  confirmLabel="Approve discount"
                  testId={`dev-approve-${b.code}`}
                />
                <ConfirmAction
                  action={developerRejectAction}
                  fields={{ bookingId: b.id }}
                  label="Reject"
                  variant="outline"
                  title="Reject this discount?"
                  description="The unit is released and soleX will renegotiate with the customer."
                  reason={{ label: "Reason for soleX" }}
                  confirmLabel="Reject"
                />
              </div>
            </div>
          ))}
        </div>
      )}
    </>
  );
}
