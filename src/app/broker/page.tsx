import Link from "next/link";
import type { Metadata } from "next";
import { ArrowRight, Clock } from "lucide-react";
import { formatDateTime } from "@/lib/format";
import { cn } from "@/lib/utils";
import { requireActor } from "@/modules/identity/session";
import { getBrokerHome, getBrokerUpdates } from "@/modules/reporting/portals";
import { Money, PageHeader, Section } from "@/components/app/ui-bits";
import { RegisterLeadForm } from "@/components/app/register-lead";
import { RequestVisitButton } from "@/components/app/request-visit";
import { registerLeadAction } from "./actions";

export const metadata: Metadata = { title: "Partner home" };

const TONE = { good: "bg-status-available", info: "bg-status-booked", bad: "bg-muted-foreground/50" } as const;

export default async function BrokerHome() {
  const actor = await requireActor({ roles: ["BROKER"] });
  const [home, feed] = await Promise.all([getBrokerHome(actor), getBrokerUpdates(actor)]);
  const s = home.stats;
  const b = home.brokerage;
  return (
    <>
      <PageHeader title={`Welcome, ${actor.name.split(" ")[0]}`} />
      <p className="-mt-3 mb-5 text-sm text-muted-foreground" data-testid="broker-stats">
        <Link href="/broker/leads" className="hover:text-foreground">
          <strong className="text-foreground tabular">{s.leads}</strong> customers
        </Link>{" "}
        · <strong className="text-foreground tabular" data-testid="broker-bookings">{s.bookings}</strong> booked ·{" "}
        <Link href="/broker/commissions" className="hover:text-foreground">
          {b.payable > 0 && (
            <>
              <strong className="text-foreground">
                <Money value={b.payable} />
              </strong>{" "}
              brokerage payable ·{" "}
            </>
          )}
          <Money value={b.accrued} /> brokerage on the way
        </Link>
      </p>

      <div className="grid gap-5 lg:grid-cols-2">
        <Section title="Register a customer">
          <RegisterLeadForm action={registerLeadAction} projects={home.projects.map((p) => ({ id: p.id, name: p.name }))} />
        </Section>

        <div className="space-y-5">
          {feed.needsVisit.length > 0 && (
            <Section title="Needs you" className="border-status-hold/50">
              <ul className="space-y-3" data-testid="broker-needs-visit">
                {feed.needsVisit.map((l) => (
                  <li key={l.id} className="flex flex-wrap items-center justify-between gap-2">
                    <div className="min-w-0">
                      <div className="text-sm font-medium">{l.name}</div>
                      <div className="flex items-center gap-1 text-xs text-[oklch(0.5_0.13_50)]">
                        <Clock className="size-3" /> Protection ends in {l.daysLeft} {l.daysLeft === 1 ? "day" : "days"}, no site visit yet
                      </div>
                    </div>
                    <RequestVisitButton leadId={l.id} />
                  </li>
                ))}
              </ul>
            </Section>
          )}

          <Section
            title="Latest on your customers"
            actions={
              <Link href="/broker/leads" className="flex items-center gap-1 text-xs font-medium text-primary hover:underline">
                All customers <ArrowRight className="size-3" />
              </Link>
            }
          >
            {feed.updates.length === 0 ? (
              <p className="text-sm text-muted-foreground">No updates in the last two weeks.</p>
            ) : (
              <ul className="space-y-3" data-testid="broker-updates">
                {feed.updates.map((u) => (
                  <li key={u.id} className="flex items-start gap-2.5 text-sm">
                    <span className={cn("mt-1.5 size-2 shrink-0 rounded-full", TONE[u.tone])} />
                    <div className="min-w-0 flex-1">
                      <div>
                        <span className="font-medium">{u.text}</span>
                      </div>
                      <div className="text-xs text-muted-foreground">
                        {u.who} · {formatDateTime(u.at)}
                      </div>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </Section>
        </div>
      </div>
    </>
  );
}
