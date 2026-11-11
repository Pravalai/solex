import type { Metadata } from "next";
import { CalendarCheck, ShieldCheck } from "lucide-react";
import { formatDate, formatDateTime } from "@/lib/format";
import { requireActor } from "@/modules/identity/session";
import { getBrokerHome, listBrokerLeads } from "@/modules/reporting/portals";
import { EmptyState, PageHeader, Section } from "@/components/app/ui-bits";
import { BookingStatusPill, LeadStagePill } from "@/components/app/status";
import { RegisterLeadForm } from "@/components/app/register-lead";
import { registerLeadAction } from "../actions";

export const metadata: Metadata = { title: "My customers" };

export default async function BrokerLeads() {
  const actor = await requireActor({ roles: ["BROKER"] });
  const [leads, home] = await Promise.all([listBrokerLeads(actor), getBrokerHome(actor)]);
  return (
    <>
      <PageHeader title="My customers" subtitle="Everyone you have registered, and where they are in the journey." />
      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_380px]">
        <div className="space-y-2" data-testid="broker-leads">
          {leads.length === 0 && <EmptyState title="You have not registered anyone yet." />}
          {leads.map((l) => (
            <div key={l.id} className="rounded-xl border bg-card p-4 shadow-xs">
              <div className="flex items-start justify-between gap-2">
                <div>
                  <div className="font-medium">{l.name}</div>
                  <div className="text-xs text-muted-foreground">
                    {l.project} · {l.phone} · registered {formatDate(l.createdAt)}
                  </div>
                </div>
                <LeadStagePill stage={l.stage} />
              </div>
              <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
                {l.relationshipManager && <span>soleX RM: {l.relationshipManager}</span>}
                {l.lastVisit && (
                  <span className="flex items-center gap-1">
                    <CalendarCheck className="size-3" /> Visit {l.lastVisit.status.toLowerCase().replace("_", " ")} {formatDateTime(l.lastVisit.scheduledAt)}
                  </span>
                )}
                {l.protectedDaysLeft !== null && (
                  <span className="flex items-center gap-1 text-[oklch(0.4_0.1_155)]">
                    <ShieldCheck className="size-3" /> Attribution protected {l.protectedDaysLeft} more days
                  </span>
                )}
              </div>
              {l.booking && (
                <div className="mt-2 flex items-center gap-2 rounded-md bg-muted/60 px-2 py-1.5 text-xs">
                  Booked {l.booking.unitNo} · {l.booking.code} <BookingStatusPill status={l.booking.status} />
                </div>
              )}
            </div>
          ))}
        </div>
        <Section title="Register a customer" className="h-fit">
          <RegisterLeadForm action={registerLeadAction} projects={home.projects.map((p) => ({ id: p.id, name: p.name }))} />
        </Section>
      </div>
    </>
  );
}
