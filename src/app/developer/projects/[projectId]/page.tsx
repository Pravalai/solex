import Link from "next/link";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { ArrowLeft, Download } from "lucide-react";
import { NotFoundError } from "@/lib/errors";
import { formatBps } from "@/lib/money";
import { formatDate } from "@/lib/format";
import { requireActor } from "@/modules/identity/session";
import { getStackingPlan } from "@/modules/reporting/inventory";
import { listBookings } from "@/modules/reporting/bookings";
import { getDeveloperFeeStatement } from "@/modules/reporting/portals";
import { DefinitionList, Money, PageHeader, Section } from "@/components/app/ui-bits";
import { BookingStatusPill } from "@/components/app/status";
import { StackingPlan, StatusLegend } from "@/components/app/stacking-plan";
import { CommissionTable } from "@/components/app/finance-tables";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { cn } from "@/lib/utils";

export const metadata: Metadata = { title: "Project" };

export default async function DeveloperProject({ params }: PageProps<"/developer/projects/[projectId]">) {
  const actor = await requireActor({ roles: ["DEVELOPER"] });
  const { projectId } = await params;
  const plan = await getStackingPlan(actor, projectId).catch((err) => {
    if (err instanceof NotFoundError) notFound();
    throw err;
  });
  const [bookings, fees] = await Promise.all([listBookings(actor, { projectId }), getDeveloperFeeStatement(actor, projectId)]);
  const m = plan.mandate;

  return (
    <>
      <Link href="/developer" className="mb-3 inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground">
        <ArrowLeft className="size-3" /> Portfolio
      </Link>
      <PageHeader
        eyebrow={`RERA ${plan.project.reraNo}`}
        title={plan.project.name}
        subtitle={`${plan.project.locality}, ${plan.project.city} · possession ${formatDate(plan.project.possessionDate)}`}
        actions={
          <Button asChild variant="outline">
            <a href={`/developer/export?project=${projectId}`}>
              <Download className="size-4" /> Download MIS (CSV)
            </a>
          </Button>
        }
      />
      <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_320px]">
        <Section title="Inventory" description="Full project, including units you have retained outside the soleX mandate" actions={<StatusLegend />}>
          <StackingPlan towers={plan.towers} />
        </Section>
        {m && (
          <Section title={`Mandate ${m.code}`} description={`${formatDate(m.startDate)} – ${formatDate(m.endDate)} · ${m.daysLeft} days left`} className="h-fit">
            <DefinitionList
              className="text-xs"
              items={[
                ["Target", `${m.targetUnits} units`],
                ["soleX fee", `${formatBps(m.soleXFeeBps)}${m.feeTierBps ? ` → ${formatBps(m.feeTierBps)} after ${m.feeTierUnits}` : ""}`],
                ["Fee earned at", `${formatBps(m.earningTriggerBps)} collected`],
                ["soleX may approve discounts up to", formatBps(m.mgmtMaxDiscountBps)],
                ["Above that", "Your approval"],
                ["Cancellation forfeiture", formatBps(m.forfeitureBps)],
              ]}
            />
          </Section>
        )}
      </div>

      <Section title="Bookings" description="Every booking on your project. Customer contact details stay with the soleX team." className="mt-5">
        <div className="-mx-4 overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="pl-4">Booking</TableHead>
                <TableHead>Unit</TableHead>
                <TableHead>Customer</TableHead>
                <TableHead>Channel</TableHead>
                <TableHead className="text-right">Agreement value</TableHead>
                <TableHead className="text-right">Collected</TableHead>
                <TableHead className="text-right">Overdue</TableHead>
                <TableHead className="pr-4">Status</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {bookings.map((b) => (
                <TableRow key={b.id} data-testid={`dev-booking-${b.code}`}>
                  <TableCell className="pl-4">
                    <div className="font-medium">{b.code}</div>
                    <div className="text-xs text-muted-foreground">{formatDate(b.bookedAt)}</div>
                  </TableCell>
                  <TableCell>{b.unitNo}</TableCell>
                  <TableCell>{b.customerName}</TableCell>
                  <TableCell>{b.channel}</TableCell>
                  <TableCell className="text-right">
                    <Money value={b.agreementValue} />
                    {b.discountBps > 0 && <div className="text-xs text-muted-foreground">−{formatBps(b.discountBps)}</div>}
                  </TableCell>
                  <TableCell className="text-right">
                    <Money value={b.received} />
                  </TableCell>
                  <TableCell className={cn("text-right", b.overdue > 0 && "text-destructive")}>{b.overdue > 0 ? <Money value={b.overdue} /> : "—"}</TableCell>
                  <TableCell className="pr-4">
                    <BookingStatusPill status={b.status} />
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </Section>

      <Section title="soleX fee statement" description="What you owe soleX under this mandate. Each line becomes payable once its booking reaches the collection trigger." className="mt-5">
        <CommissionTable lines={fees} labels={{ DEVELOPER_FEE: "soleX fee" }} />
      </Section>
    </>
  );
}
