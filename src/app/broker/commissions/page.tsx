import type { Metadata } from "next";
import { Info } from "lucide-react";
import { formatBps } from "@/lib/money";
import { formatDate } from "@/lib/format";
import { requireActor } from "@/modules/identity/session";
import { getBrokerCommissions } from "@/modules/reporting/portals";
import { EmptyState, Money, PageHeader } from "@/components/app/ui-bits";
import { BookingStatusPill, Pill } from "@/components/app/status";
import { cn } from "@/lib/utils";

export const metadata: Metadata = { title: "Brokerage" };

const PARTNER_STATUS: Record<string, { label: string; tone: "neutral" | "gold" | "info" | "success" | "danger" }> = {
  ACCRUED: { label: "Accruing: payable after agreement stage", tone: "neutral" },
  EARNED: { label: "Earned: awaiting approval", tone: "gold" },
  APPROVED: { label: "Approved: payment scheduled", tone: "info" },
  PAID: { label: "Paid", tone: "success" },
  REVERSED: { label: "Reversed (booking cancelled)", tone: "danger" },
};

export default async function BrokerCommissions() {
  const actor = await requireActor({ roles: ["BROKER"] });
  const lines = await getBrokerCommissions(actor);
  const total = (statuses: string[]) => lines.filter((l) => statuses.includes(l.status)).reduce((s, l) => s + l.amount, 0);
  return (
    <>
      <PageHeader title="Brokerage statement" subtitle="Brokerage per booking, at the rate agreed for each mandate." />
      <div className="mb-4 grid grid-cols-3 gap-3">
        {[
          ["Accruing", total(["ACCRUED"])],
          ["Payable", total(["EARNED", "APPROVED"])],
          ["Paid", total(["PAID"])],
        ].map(([label, v]) => (
          <div key={label as string} className="rounded-xl border bg-card p-3">
            <div className="text-xs text-muted-foreground">{label}</div>
            <div className="mt-1 text-lg font-semibold">
              <Money value={v as number} />
            </div>
          </div>
        ))}
      </div>
      <p className="mb-4 flex items-start gap-2 rounded-lg bg-muted/60 p-3 text-xs text-muted-foreground">
        <Info className="mt-0.5 size-3.5 shrink-0" /> Brokerage becomes payable once the customer has paid the agreed share of the agreement value (the agreement stage). If a booking is cancelled, unpaid brokerage is reversed and paid brokerage is recovered.
      </p>
      {lines.length === 0 ? (
        <EmptyState title="No brokerage yet." hint="It appears here as soon as one of your customers books." />
      ) : (
        <div className="space-y-2" data-testid="brokerage-lines">
          {lines.map((l) => (
            <div key={l.id} className="rounded-xl border bg-card p-4 shadow-xs">
              <div className="flex items-start justify-between gap-2">
                <div>
                  <div className="font-medium">
                    {l.booking.customer.name} · {l.booking.unit.unitNo}
                  </div>
                  <div className="text-xs text-muted-foreground">
                    {l.booking.project.name} · {l.booking.code} · booked {formatDate(l.booking.bookedAt)}
                  </div>
                </div>
                <div className={cn("text-right font-semibold", l.amount < 0 && "text-destructive")}>
                  <Money value={l.amount} compact={false} />
                  <div className="text-xs font-normal text-muted-foreground">{formatBps(l.rateBps)} of agreement value</div>
                </div>
              </div>
              <div className="mt-2 flex flex-wrap items-center gap-2">
                <Pill tone={PARTNER_STATUS[l.status]?.tone ?? "neutral"}>{l.isAdjustment ? "Recovery due" : (PARTNER_STATUS[l.status]?.label ?? l.status)}</Pill>
                <BookingStatusPill status={l.booking.status} />
                {l.reference && <span className="text-xs text-muted-foreground">UTR {l.reference}</span>}
              </div>
            </div>
          ))}
        </div>
      )}
    </>
  );
}
