import Link from "next/link";
import type { Metadata } from "next";
import type { CommissionKind, CommissionStatus } from "@/generated/prisma/enums";
import { formatDate, humanize } from "@/lib/format";
import { formatINRCompact } from "@/lib/money";
import { requireActor } from "@/modules/identity/session";
import { can } from "@/modules/identity/permissions";
import { getCollections, getCommissionLedger } from "@/modules/reporting/finance";
import { EmptyState, KpiCard, Money, PageHeader, Section } from "@/components/app/ui-bits";
import { BookingStatusPill, CommissionStatusPill, Pill } from "@/components/app/status";
import { COMMISSION_KIND_LABEL } from "@/components/app/finance-tables";
import { SettleButton } from "@/components/app/settle-buttons";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { cn } from "@/lib/utils";
import { settleCommissionAction } from "../actions";

export const metadata: Metadata = { title: "Collections & commission" };

const KINDS: { key: string; label: string; kind?: CommissionKind }[] = [
  { key: "ALL", label: "All lines" },
  { key: "DEVELOPER_FEE", label: "soleX fee (receivable)", kind: "DEVELOPER_FEE" },
  { key: "BROKER_PAYOUT", label: "Partner brokerage", kind: "BROKER_PAYOUT" },
  { key: "EMPLOYEE_INCENTIVE", label: "Sales incentives", kind: "EMPLOYEE_INCENTIVE" },
];
const STATUSES: CommissionStatus[] = ["ACCRUED", "EARNED", "INVOICED", "APPROVED", "RECEIVED", "PAID", "REVERSED"];

export default async function FinancePage({ searchParams }: PageProps<"/finance">) {
  const actor = await requireActor({ permission: "finance.view" });
  const sp = await searchParams;
  const tab = sp.tab === "commissions" ? "commissions" : "collections";
  const kindKey = typeof sp.kind === "string" ? sp.kind : "ALL";
  const status = typeof sp.status === "string" && STATUSES.includes(sp.status as CommissionStatus) ? (sp.status as CommissionStatus) : undefined;
  const [collections, ledger] = await Promise.all([
    getCollections(actor),
    getCommissionLedger(actor, { kind: KINDS.find((k) => k.key === kindKey)?.kind, status }),
  ]);
  const s = ledger.summary;
  const link = (extra: Record<string, string | undefined>) => {
    const p = new URLSearchParams();
    for (const [k, v] of Object.entries({ tab, kind: kindKey, status, ...extra })) if (v) p.set(k, v);
    return `/finance?${p}`;
  };

  return (
    <>
      <PageHeader
        eyebrow="Finance"
        title="Collections & commission"
        subtitle="Customer collections drive commission: a line only becomes earned once the booking's collection trigger is met."
      />
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <KpiCard label="Overdue customer instalments" tone={collections.overdue > 0 ? "danger" : "default"} value={<Money value={collections.overdue} />} sub="Across live bookings" />
        <KpiCard label="Received this month" value={<Money value={collections.receivedThisMonth} />} sub={`${collections.paymentsThisMonth} receipts · ${formatINRCompact(collections.upcoming)} due in the next 45 days`} />
        <KpiCard
          label="soleX fee to collect from developers"
          value={<Money value={s.fee.toInvoice + s.fee.invoiced} />}
          sub={`${formatINRCompact(s.fee.toInvoice)} to invoice · ${formatINRCompact(s.fee.invoiced)} invoiced · ${formatINRCompact(s.fee.received)} received`}
          href={link({ tab: "commissions", kind: "DEVELOPER_FEE", status: undefined })}
        />
        <KpiCard
          label="Payable to partners & staff"
          value={<Money value={s.payable.toApprove + s.payable.toPay} />}
          sub={`${formatINRCompact(s.payable.toApprove)} awaiting approval · ${formatINRCompact(s.payable.toPay)} approved · ${formatINRCompact(s.payable.paid)} paid${s.clawbacks.count ? ` · ${formatINRCompact(s.clawbacks.open)} to recover (${s.clawbacks.count} clawbacks)` : ""}`}
          href={link({ tab: "commissions", kind: "BROKER_PAYOUT", status: undefined })}
        />
      </div>

      <div className="mt-5 mb-3 flex gap-1">
        {(["collections", "commissions"] as const).map((t) => (
          <Link
            key={t}
            href={`/finance?tab=${t}`}
            className={cn("rounded-md px-3 py-1.5 text-sm", tab === t ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-muted")}
          >
            {t === "collections" ? "Collections" : "Commission ledger"}
          </Link>
        ))}
      </div>

      {tab === "collections" ? (
        <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_340px]">
          <Section title="Instalments due" description="Overdue first, then the next 45 days. Open a booking to record a receipt.">
            {collections.rows.length === 0 ? (
              <EmptyState title="Nothing due." />
            ) : (
              <div className="-mx-4 overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="pl-4">Booking</TableHead>
                      <TableHead>Milestone</TableHead>
                      <TableHead>Due</TableHead>
                      <TableHead className="text-right">Outstanding</TableHead>
                      <TableHead className="pr-4">Status</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {collections.rows.map((r) => (
                      <TableRow key={r.id}>
                        <TableCell className="pl-4">
                          <Link href={`/bookings/${r.bookingId}`} className="font-medium hover:underline">
                            {r.bookingCode}
                          </Link>
                          <div className="text-xs text-muted-foreground">
                            {r.customer} · {r.unitNo} · {r.project}
                          </div>
                        </TableCell>
                        <TableCell className="text-sm">{r.label}</TableCell>
                        <TableCell className="text-sm">{formatDate(r.dueDate)}</TableCell>
                        <TableCell className="text-right">
                          <Money value={r.outstanding} compact={false} />
                        </TableCell>
                        <TableCell className="pr-4">{r.daysOverdue > 0 ? <Pill tone="danger">{r.daysOverdue} days overdue</Pill> : <Pill tone="info">Upcoming</Pill>}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
          </Section>
          <Section title="Refunds due" description="From cancellations, net of the mandate's forfeiture terms">
            {collections.refunds.length === 0 ? (
              <EmptyState title="No refunds pending." />
            ) : (
              <ul className="space-y-2 text-sm">
                {collections.refunds.map((r) => (
                  <li key={r.id} className="flex items-start justify-between gap-2">
                    <div>
                      <Link href={`/bookings/${r.id}`} className="font-medium hover:underline">
                        {r.code}
                      </Link>
                      <div className="text-xs text-muted-foreground">
                        {r.customer.name} · cancelled {formatDate(r.cancelledAt)} · forfeited {formatINRCompact(r.forfeitedAmount)}
                      </div>
                    </div>
                    <Money value={r.refundDue} className="font-medium" />
                  </li>
                ))}
              </ul>
            )}
          </Section>
        </div>
      ) : (
        <Section
          title="Commission ledger"
          description="One line per party per booking, with rates frozen from the mandate. Approving payouts is a management duty; finance records invoices, receipts and payments."
          actions={
            <div className="flex flex-wrap gap-1">
              {KINDS.map((k) => (
                <Link key={k.key} href={link({ kind: k.key })} className={cn("rounded-md border px-2 py-1 text-xs", kindKey === k.key ? "border-primary bg-primary text-primary-foreground" : "hover:bg-muted")}>
                  {k.label}
                </Link>
              ))}
              <span className="mx-1 w-px bg-border" />
              {(["EARNED", "INVOICED", "APPROVED"] as const).map((st) => (
                <Link key={st} href={link({ status: status === st ? undefined : st })} className={cn("rounded-md border px-2 py-1 text-xs", status === st ? "border-gold bg-gold-soft" : "hover:bg-muted")}>
                  {humanize(st)}
                </Link>
              ))}
            </div>
          }
        >
          <div className="-mx-4 overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="pl-4">Booking</TableHead>
                  <TableHead>Line</TableHead>
                  <TableHead>Party</TableHead>
                  <TableHead className="text-right">Amount</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="pr-4 text-right">Next step</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {ledger.lines.map((l) => (
                  <TableRow key={l.id}>
                    <TableCell className="pl-4">
                      <Link href={`/bookings/${l.booking.id}`} className="font-medium hover:underline">
                        {l.booking.code}
                      </Link>
                      <div className="flex items-center gap-1 text-xs text-muted-foreground">
                        {l.booking.unit.unitNo} · {l.project.name} <BookingStatusPill status={l.booking.status} />
                      </div>
                    </TableCell>
                    <TableCell className="text-sm">
                      {COMMISSION_KIND_LABEL[l.kind]}
                      {l.isAdjustment && <Pill tone="danger" className="ml-1">Clawback</Pill>}
                    </TableCell>
                    <TableCell className="text-sm">{l.broker?.firmName ?? l.user?.name ?? "Developer"}</TableCell>
                    <TableCell className={cn("text-right", l.amount < 0 && "text-destructive")}>
                      <Money value={l.amount} compact={false} />
                    </TableCell>
                    <TableCell>
                      <CommissionStatusPill status={l.status} />
                    </TableCell>
                    <TableCell className="pr-4 text-right">
                      <SettleButton action={settleCommissionAction} line={l} canApprove={can(actor, "commission.approve")} canSettle={can(actor, "commission.settle")} />
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </Section>
      )}
    </>
  );
}
