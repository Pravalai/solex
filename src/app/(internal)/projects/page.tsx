import Link from "next/link";
import type { Metadata } from "next";
import { CalendarClock, MapPin } from "lucide-react";
import { requireActor } from "@/modules/identity/session";
import { listProjects } from "@/modules/reporting/inventory";
import { Money, Meter, PageHeader } from "@/components/app/ui-bits";
import { Pill, UNIT_STATUS_STYLE } from "@/components/app/status";
import { cn } from "@/lib/utils";

export const metadata: Metadata = { title: "Projects & inventory" };

export default async function ProjectsPage() {
  const actor = await requireActor();
  const projects = await listProjects(actor);
  return (
    <>
      <PageHeader title="Projects & inventory" />
      <div className="grid gap-4 lg:grid-cols-2 xl:grid-cols-3">
        {projects.map((p) => {
          const absorbed = p.absorbed ?? 0;
          const segments = (["SOLD", "BOOKED", "HOLD", "BLOCKED", "AVAILABLE"] as const).map((s) => ({ s, n: p.counts[s] }));
          return (
            <Link key={p.id} href={`/projects/${p.id}`} className="group rounded-xl border bg-card p-5 shadow-xs transition-colors hover:border-primary/30" data-testid={`project-${p.code}`}>
              <div className="flex items-start justify-between gap-3">
                <div>
                  <div className="text-xs text-muted-foreground">{p.developerName}</div>
                  <h2 className="text-lg font-semibold group-hover:text-primary">{p.name}</h2>
                  <div className="mt-0.5 flex items-center gap-1 text-xs text-muted-foreground">
                    <MapPin className="size-3" /> {p.locality}, {p.city}
                  </div>
                </div>
                {p.mandate && (
                  <Pill tone={p.mandate.daysLeft < 60 ? "warning" : "gold"}>
                    <CalendarClock className="mr-1 size-3" />
                    {p.mandate.daysLeft}d left
                  </Pill>
                )}
              </div>
              <div className="mt-4 flex h-2.5 overflow-hidden rounded-full bg-muted">
                {segments.map(({ s, n }) =>
                  n > 0 ? <div key={s} className={cn(UNIT_STATUS_STYLE[s].dot)} style={{ width: `${(n / Math.max(1, p.counts.total)) * 100}%` }} title={`${UNIT_STATUS_STYLE[s].label}: ${n}`} /> : null,
                )}
              </div>
              <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-xs text-muted-foreground">
                <span className="font-medium text-foreground">{p.counts.total} appointed units:</span>
                <span>{p.counts.AVAILABLE} available</span>
                {p.counts.HOLD > 0 && <span>{p.counts.HOLD} on hold</span>}
                {p.counts.BLOCKED > 0 && <span>{p.counts.BLOCKED} blocked</span>}
                <span>{p.counts.BOOKED + p.counts.SOLD} booked/sold</span>
              </div>
              {p.counts.retained > 0 && (
                <div className="mt-1 text-xs text-muted-foreground">+ {p.counts.retained} more retained by the developer (not in the mandate)</div>
              )}
              {p.targetUnits != null && (
                <div className="mt-4 grid grid-cols-2 gap-4 border-t pt-4 text-sm">
                  <div>
                    <div className="text-xs text-muted-foreground">Absorption vs target</div>
                    <div className="mt-1 font-semibold tabular">
                      {absorbed} / {p.targetUnits}
                    </div>
                    <Meter value={absorbed} max={p.targetUnits} className="mt-1.5" tone="gold" />
                    <div className="mt-1 text-[11px] text-muted-foreground">Mandate commits to selling {p.targetUnits} of {p.counts.total} by its end date</div>
                  </div>
                  <div>
                    <div className="text-xs text-muted-foreground">Booked value · available stock</div>
                    <div className="mt-1 font-semibold">
                      <Money value={p.soldValue ?? 0} /> <span className="font-normal text-muted-foreground">·</span> <Money value={p.availableValue} className="text-muted-foreground" />
                    </div>
                    <div className="mt-1 text-[11px] text-muted-foreground">Agreement value of live bookings · list price of available units</div>
                  </div>
                </div>
              )}
            </Link>
          );
        })}
      </div>
    </>
  );
}
