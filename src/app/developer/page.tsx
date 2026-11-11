import Link from "next/link";
import type { Metadata } from "next";
import { ArrowRight, Download } from "lucide-react";
import { formatBps, formatINRCompact } from "@/lib/money";
import { pct } from "@/lib/format";
import { requireActor } from "@/modules/identity/session";
import { getDeveloperPortfolio } from "@/modules/reporting/portals";
import { KpiCard, Meter, Money, PageHeader } from "@/components/app/ui-bits";
import { Pill, UNIT_STATUS_STYLE } from "@/components/app/status";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export const metadata: Metadata = { title: "Portfolio" };

export default async function DeveloperHome() {
  const actor = await requireActor({ roles: ["DEVELOPER"] });
  const projects = await getDeveloperPortfolio(actor);
  const sumOf = (f: (p: (typeof projects)[number]) => number) => projects.reduce((s, p) => s + f(p), 0);
  const pending = sumOf((p) => p.pendingApprovals);

  return (
    <>
      <PageHeader
        eyebrow="Mandated to soleX"
        title="Your projects"
        subtitle="Live sales, collections and soleX fees for every project you have mandated to soleX."
        actions={
          pending > 0 && (
            <Button asChild>
              <Link href="/developer/approvals">
                {pending} discount approval{pending > 1 ? "s" : ""} waiting <ArrowRight className="size-4" />
              </Link>
            </Button>
          )
        }
      />
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <KpiCard label="Units sold under mandate" value={sumOf((p) => p.counts.BOOKED + p.counts.SOLD)} sub={`of ${sumOf((p) => p.mandate?.targetUnits ?? 0)} targeted`} />
        <KpiCard label="Booked value" value={<span data-testid="dev-booked-value"><Money value={sumOf((p) => p.bookedValue)} /></span>} sub={`${sumOf((p) => p.liveBookings)} live bookings · ${sumOf((p) => p.cancellations)} cancelled`} />
        <KpiCard label="Collected from customers" value={<Money value={sumOf((p) => p.collected)} />} sub={`${formatINRCompact(sumOf((p) => p.overdue))} overdue`} tone={sumOf((p) => p.overdue) > 0 ? "warning" : "default"} />
        <KpiCard label="soleX fee payable" value={<Money value={sumOf((p) => p.fee.payable)} />} sub={`${formatINRCompact(sumOf((p) => p.fee.paid))} paid · ${formatINRCompact(sumOf((p) => p.fee.accrued))} accruing`} />
      </div>

      <div className="mt-5 grid gap-4 lg:grid-cols-2">
        {projects.map((p) => {
          const appointed = p.counts.AVAILABLE + p.counts.HOLD + p.counts.BLOCKED + p.counts.BOOKED + p.counts.SOLD;
          const sold = p.counts.BOOKED + p.counts.SOLD;
          return (
            <div key={p.id} className="rounded-xl border bg-card p-5 shadow-xs" data-testid={`dev-project-${p.name}`}>
              <div className="flex items-start justify-between gap-2">
                <div>
                  <Link href={`/developer/projects/${p.id}`} className="text-lg font-semibold hover:underline">
                    {p.name}
                  </Link>
                  <div className="text-xs text-muted-foreground">
                    {p.locality}, {p.city}
                    {p.mandate && ` · mandate ${p.mandate.code} · soleX fee ${formatBps(p.mandate.soleXFeeBps)}`}
                  </div>
                </div>
                {p.mandate && <Pill tone={p.mandate.daysLeft < 60 ? "warning" : "gold"}>{p.mandate.daysLeft}d left on mandate</Pill>}
              </div>
              <div className="mt-4 flex h-2.5 overflow-hidden rounded-full bg-muted">
                {(["SOLD", "BOOKED", "HOLD", "BLOCKED", "AVAILABLE"] as const).map((s) =>
                  p.counts[s] > 0 ? <div key={s} className={cn(UNIT_STATUS_STYLE[s].dot)} style={{ width: `${(p.counts[s] / Math.max(1, appointed)) * 100}%` }} title={`${UNIT_STATUS_STYLE[s].label}: ${p.counts[s]}`} /> : null,
                )}
              </div>
              <div className="mt-1.5 text-xs text-muted-foreground">
                {appointed} units mandated: {p.counts.AVAILABLE} available
                {p.counts.HOLD > 0 && ` · ${p.counts.HOLD} on hold`}
                {p.counts.BLOCKED > 0 && ` · ${p.counts.BLOCKED} blocked`} · {sold} booked/sold
                {p.counts.retained > 0 && ` (+ ${p.counts.retained} retained by you)`}
              </div>
              <div className="mt-4 grid grid-cols-3 gap-3 border-t pt-4 text-sm">
                <div>
                  <div className="text-xs text-muted-foreground">Against target</div>
                  <div className="font-semibold tabular">
                    {sold} / {p.mandate?.targetUnits ?? "—"}
                  </div>
                  <Meter value={sold} max={p.mandate?.targetUnits ?? 1} tone="gold" className="mt-1" />
                </div>
                <div>
                  <div className="text-xs text-muted-foreground">Booked · collected</div>
                  <div className="font-semibold">
                    <Money value={p.bookedValue} /> · <Money value={p.collected} />
                  </div>
                </div>
                <div>
                  <div className="text-xs text-muted-foreground">soleX fee payable</div>
                  <div className="font-semibold">
                    <Money value={p.fee.payable} />
                  </div>
                </div>
              </div>
              <div className="mt-4 rounded-lg bg-muted/50 p-3 text-xs">
                <div className="mb-1 font-medium">Sales funnel (aggregate)</div>
                <div className="flex flex-wrap gap-x-4 gap-y-1 text-muted-foreground">
                  <span>{p.funnel.enquiries} enquiries</span>
                  <span>{p.funnel.active} in progress</span>
                  <span>{p.funnel.visits} site visits</span>
                  <span>
                    {p.funnel.booked} booked ({pct(p.funnel.booked, p.funnel.enquiries)}%)
                  </span>
                </div>
              </div>
              <div className="mt-4 flex flex-wrap gap-2">
                <Button asChild size="sm">
                  <Link href={`/developer/projects/${p.id}`}>Open project</Link>
                </Button>
                <Button asChild size="sm" variant="outline">
                  <a href={`/developer/export?project=${p.id}`} data-testid="mis-export">
                    <Download className="size-3.5" /> MIS (CSV)
                  </a>
                </Button>
              </div>
            </div>
          );
        })}
      </div>
    </>
  );
}
