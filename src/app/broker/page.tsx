import Link from "next/link";
import type { Metadata } from "next";
import { ArrowRight, Building2 } from "lucide-react";
import { formatINRCompact } from "@/lib/money";
import { requireActor } from "@/modules/identity/session";
import { getBrokerHome } from "@/modules/reporting/portals";
import { KpiCard, Money, PageHeader, Section } from "@/components/app/ui-bits";
import { RegisterLeadForm } from "@/components/app/register-lead";
import { registerLeadAction } from "./actions";

export const metadata: Metadata = { title: "Partner home" };

export default async function BrokerHome() {
  const actor = await requireActor({ roles: ["BROKER"] });
  const home = await getBrokerHome(actor);
  const s = home.stats;
  return (
    <>
      <PageHeader eyebrow={`${home.broker.firmName} · ${home.broker.code}`} title={`Welcome, ${actor.name.split(" ")[0]}`} subtitle="Your customers, bookings and brokerage across soleX mandates." />

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <KpiCard label="Customers registered" value={s.leads} sub={`${s.active} active · ${s.visits} visited`} href="/broker/leads" />
        <KpiCard label="Bookings" value={<span data-testid="broker-bookings">{s.bookings}</span>} sub={`${(s.conversion * 100).toFixed(0)}% of your customers`} href="/broker/leads" />
        <KpiCard label="Sales value" value={<Money value={s.salesValue} />} sub="Live bookings" />
        <KpiCard
          label="Brokerage"
          value={<Money value={home.brokerage.accrued + home.brokerage.payable + home.brokerage.paid} />}
          sub={`${formatINRCompact(home.brokerage.paid)} paid · ${formatINRCompact(home.brokerage.payable)} payable`}
          href="/broker/commissions"
        />
      </div>

      <div className="mt-5 grid gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <Section title="Register a customer" description="Takes under a minute. You will see their progress here.">
          <RegisterLeadForm action={registerLeadAction} projects={home.projects.map((p) => ({ id: p.id, name: p.name }))} />
        </Section>
        <Section title="Your projects" description="Projects soleX has authorised you to sell">
          <ul className="space-y-2">
            {home.projects.map((p) => (
              <li key={p.id}>
                <Link href={`/broker/projects/${p.id}`} className="flex items-center gap-3 rounded-lg border p-3 hover:bg-muted/50">
                  <Building2 className="size-5 text-gold" />
                  <div className="min-w-0 flex-1">
                    <div className="font-medium">{p.name}</div>
                    <div className="text-xs text-muted-foreground">
                      {p.locality}, {p.city} · {p.available} units available{p.fromPrice ? ` from ${formatINRCompact(p.fromPrice)}` : ""} · {p.configs.join(", ")}
                    </div>
                  </div>
                  <ArrowRight className="size-4 text-muted-foreground" />
                </Link>
              </li>
            ))}
          </ul>
        </Section>
      </div>
    </>
  );
}
