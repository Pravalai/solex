import Link from "next/link";
import type { Metadata } from "next";
import { ArrowRight, Building2 } from "lucide-react";
import { formatINRCompact } from "@/lib/money";
import { requireActor } from "@/modules/identity/session";
import { getBrokerHome } from "@/modules/reporting/portals";
import { PageHeader } from "@/components/app/ui-bits";

export const metadata: Metadata = { title: "Projects" };

export default async function BrokerProjects() {
  const actor = await requireActor({ roles: ["BROKER"] });
  const { projects } = await getBrokerHome(actor);
  return (
    <>
      <PageHeader title="Projects" subtitle="Live availability and current price lists for the projects you are authorised on." />
      <div className="grid gap-3 sm:grid-cols-2">
        {projects.map((p) => (
          <Link key={p.id} href={`/broker/projects/${p.id}`} className="flex items-center gap-3 rounded-xl border bg-card p-4 shadow-xs hover:bg-muted/40">
            <Building2 className="size-6 text-gold" />
            <div className="flex-1">
              <div className="font-semibold">{p.name}</div>
              <div className="text-xs text-muted-foreground">
                {p.locality}, {p.city}
              </div>
              <div className="mt-1 text-sm">
                {p.available} available{p.fromPrice ? ` · from ${formatINRCompact(p.fromPrice)}` : ""}
              </div>
            </div>
            <ArrowRight className="size-4 text-muted-foreground" />
          </Link>
        ))}
      </div>
    </>
  );
}
