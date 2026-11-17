import Link from "next/link";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { NotFoundError } from "@/lib/errors";
import { formatBps, formatINR } from "@/lib/money";
import { formatDate } from "@/lib/format";
import { requireActor } from "@/modules/identity/session";
import { getStackingPlan } from "@/modules/reporting/inventory";
import { InfoTip, Money, PageHeader, Section } from "@/components/app/ui-bits";
import { StackingPlan, StatusLegend } from "@/components/app/stacking-plan";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

export const metadata: Metadata = { title: "Project" };

export default async function BrokerProject({ params }: PageProps<"/broker/projects/[projectId]">) {
  const actor = await requireActor({ roles: ["BROKER"] });
  const { projectId } = await params;
  const plan = await getStackingPlan(actor, projectId).catch((err) => {
    if (err instanceof NotFoundError) notFound();
    throw err;
  });
  const available = plan.towers.flatMap((t) => t.floors.flatMap((f) => f.units)).filter((u) => u.status === "AVAILABLE");

  return (
    <>
      <Link href="/broker/projects" className="mb-3 inline-flex items-center gap-1 text-xs text-muted-foreground">
        <ArrowLeft className="size-3" /> Projects
      </Link>
      <PageHeader
        eyebrow={`${plan.project.city} · RERA ${plan.project.reraNo}`}
        title={plan.project.name}
        subtitle={`${plan.project.locality} · possession ${formatDate(plan.project.possessionDate)} · ${available.length} units available`}
      />
      <Section
        title={
          <span className="flex items-center gap-1.5">
            Live availability <InfoTip>Units shown as unavailable are held, booked or reserved. soleX does not share who holds them.</InfoTip>
          </span>
        }
      >
        <div className="mb-3">
          <StatusLegend brokerView />
        </div>
        <StackingPlan towers={plan.towers} brokerView />
      </Section>

      <Section
        title={
          <span className="flex items-center gap-1.5">
            Price list <InfoTip>Indicative list price including charges. Your soleX relationship manager confirms final pricing.</InfoTip>
          </span>
        }
        className="mt-5"
      >
        <div className="-mx-4 overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="pl-4">Unit</TableHead>
                <TableHead>Type</TableHead>
                <TableHead className="text-right">Super area</TableHead>
                <TableHead>Facing</TableHead>
                <TableHead className="pr-4 text-right">List price</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {available.map((u) => (
                <TableRow key={u.id}>
                  <TableCell className="pl-4 font-medium">{u.unitNo}</TableCell>
                  <TableCell>{u.config}</TableCell>
                  <TableCell className="text-right tabular">{u.superSqft} sq ft</TableCell>
                  <TableCell className="text-sm">{u.facing}</TableCell>
                  <TableCell className="pr-4 text-right">
                    <Money value={u.listPrice} />
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </Section>

      <Section title={plan.project.paymentPlanName} description={`Base rate ${formatINR(plan.project.baseRatePerSqft)}/sq ft`} className="mt-5">
        <ul className="space-y-1 text-sm">
          {plan.planStages.map((s) => (
            <li key={s.label} className="flex justify-between gap-3">
              <span>{s.label}</span>
              <span className="text-muted-foreground tabular">{formatBps(s.bps)}</span>
            </li>
          ))}
        </ul>
      </Section>
    </>
  );
}
