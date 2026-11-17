import Link from "next/link";
import type { Metadata } from "next";
import { CalendarCheck, ShieldCheck, UserPlus } from "lucide-react";
import { formatDate, formatDateTime } from "@/lib/format";
import { requireActor } from "@/modules/identity/session";
import { listBrokerLeads } from "@/modules/reporting/portals";
import { EmptyState, PageHeader } from "@/components/app/ui-bits";
import { BookingStatusPill, LeadStagePill } from "@/components/app/status";
import { RequestVisitButton } from "@/components/app/request-visit";
import { Button } from "@/components/ui/button";

export const metadata: Metadata = { title: "My customers" };

const VISIT_TEXT: Record<string, string> = {
  REQUESTED: "Visit requested for",
  SCHEDULED: "Visit scheduled",
  COMPLETED: "Visited",
  NO_SHOW: "Missed visit",
  CANCELLED: "Visit cancelled",
};

export default async function BrokerLeads() {
  const actor = await requireActor({ roles: ["BROKER"] });
  const leads = await listBrokerLeads(actor);
  return (
    <>
      <PageHeader
        title="My customers"
        actions={
          <Button asChild variant="outline">
            <Link href="/broker">
              <UserPlus className="size-4" /> Register a customer
            </Link>
          </Button>
        }
      />
      <div className="max-w-3xl space-y-2" data-testid="broker-leads">
        {leads.length === 0 && <EmptyState title="You have not registered anyone yet." />}
        {leads.map((l) => (
          <div key={l.id} className="rounded-xl border bg-card p-4 shadow-xs">
            <div className="flex items-start justify-between gap-2">
              <div>
                <div className="font-medium">{l.name}</div>
                <div className="text-xs text-muted-foreground">
                  {l.project} · {l.phone} · since {formatDate(l.createdAt)}
                </div>
              </div>
              <LeadStagePill stage={l.stage} />
            </div>
            <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
              {l.relationshipManager && <span>soleX: {l.relationshipManager}</span>}
              {l.lastVisit && (
                <span className="flex items-center gap-1">
                  <CalendarCheck className="size-3" /> {VISIT_TEXT[l.lastVisit.status] ?? l.lastVisit.status} {formatDateTime(l.lastVisit.scheduledAt)}
                </span>
              )}
              {l.protectedDaysLeft !== null && (
                <span className="flex items-center gap-1 text-[oklch(0.4_0.1_155)]">
                  <ShieldCheck className="size-3" /> Protected {l.protectedDaysLeft} more days
                </span>
              )}
            </div>
            {l.booking ? (
              <div className="mt-2 flex items-center gap-2 rounded-md bg-muted/60 px-2 py-1.5 text-xs">
                Booked {l.booking.unitNo} · {l.booking.code} <BookingStatusPill status={l.booking.status} />
              </div>
            ) : (
              l.canRequestVisit && (
                <div className="mt-3">
                  <RequestVisitButton leadId={l.id} size="xs" />
                </div>
              )
            )}
          </div>
        ))}
      </div>
    </>
  );
}
