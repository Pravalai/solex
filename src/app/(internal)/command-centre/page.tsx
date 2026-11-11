import Link from "next/link";
import type { Metadata } from "next";
import { AlarmClock, AlertTriangle, BadgeCheck, Building2, CalendarClock, Handshake, IndianRupee, Landmark, TrendingUp, Undo2, Users } from "lucide-react";
import { formatBps, formatINRCompact } from "@/lib/money";
import { formatDateTime, humanize, pct } from "@/lib/format";
import { requireActor } from "@/modules/identity/session";
import { getCommandCentre } from "@/modules/reporting/command";
import { KpiCard, Meter, Money, PageHeader, Section } from "@/components/app/ui-bits";
import { Pill } from "@/components/app/status";
import { BookingsTrendChart } from "@/components/app/charts";
import { selectClass } from "@/components/app/styles";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { cn } from "@/lib/utils";

export const metadata: Metadata = { title: "Command centre" };

const HEALTH = {
  ON_TRACK: { label: "On track", tone: "success" as const },
  BEHIND: { label: "Behind pace", tone: "warning" as const },
  AT_RISK: { label: "At risk", tone: "danger" as const },
};

export default async function CommandCentrePage({ searchParams }: PageProps<"/command-centre">) {
  const actor = await requireActor({ permission: "command.view" });
  const sp = await searchParams;
  const projectId = typeof sp.project === "string" && sp.project ? sp.project : undefined;
  const d = await getCommandCentre(actor, { projectId });
  const k = d.kpis;
  const delta = k.bookingsThisMonth.value - k.bookingsPrevMonth.value;
  const alertCount = d.alerts.pending.length + d.alerts.overdueCollections.length + d.alerts.expiringMandates.length + d.alerts.refunds.length;
  const funnelMax = Math.max(1, d.funnel[0]?.n ?? 1);

  return (
    <>
      <PageHeader
        eyebrow={`As of ${formatDateTime(d.asOf)}`}
        title="Command centre"
        subtitle="All mandates at a glance. Every figure is computed live from bookings, collections and the commission ledger, and each one links through to its detail."
        actions={
          <form action="/command-centre" className="flex items-center gap-2">
            <select name="project" defaultValue={projectId ?? ""} className={cn(selectClass, "w-48")} aria-label="Filter by project">
              <option value="">All mandates</option>
              {d.projects.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
            <Button type="submit" variant="outline">
              Apply
            </Button>
          </form>
        }
      />

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-6" data-testid="kpis">
        <KpiCard
          label="Absorption"
          icon={Building2}
          href="/projects"
          value={
            <span data-testid="kpi-absorbed">
              {k.absorbed}
              <span className="text-base font-normal text-muted-foreground"> / {k.appointedTarget} target</span>
            </span>
          }
          sub={`${k.available} units available · ${formatINRCompact(k.unsoldValue)} available stock ·${k.activeMandates} mandates`}
        />
        <KpiCard label="Sold value (live bookings)" icon={TrendingUp} href="/bookings" value={<span data-testid="kpi-sold"><Money value={k.soldValue} /></span>} sub={`This month ${formatINRCompact(k.bookingsThisMonth.value)} (${k.bookingsThisMonth.count}) · ${delta >= 0 ? "▲" : "▼"} ${formatINRCompact(Math.abs(delta))} vs last`} />
        <KpiCard label="Collected" icon={IndianRupee} href="/finance" value={<span data-testid="kpi-collected"><Money value={k.collected} /></span>} sub={`${formatINRCompact(k.collectedThisMonth)} this month · ${formatINRCompact(k.dueNext30)} due in 30 days`} />
        <KpiCard
          label="Overdue collections"
          icon={AlarmClock}
          href="/finance"
          tone={k.overdueAmount > 0 ? "danger" : "default"}
          value={<Money value={k.overdueAmount} />}
          sub={`${k.overdueCount} bookings behind schedule`}
        />
        <KpiCard
          label="soleX fee (developer receivable)"
          icon={Landmark}
          href="/finance?tab=commissions"
          value={<span data-testid="kpi-fee"><Money value={k.fee.expected} /></span>}
          sub={`${formatINRCompact(k.fee.received)} received · ${formatINRCompact(k.fee.earned)} earned, unpaid · ${formatINRCompact(k.fee.accrued)} not yet earned`}
        />
        <KpiCard
          label="Net margin after channel costs"
          icon={Handshake}
          href="/finance?tab=commissions"
          value={<Money value={k.netMargin} />}
          sub={`Partner brokerage ${formatINRCompact(k.payouts.expected)} (${formatINRCompact(k.payouts.payable)} payable${k.payouts.clawbackDue > 0 ? `, ${formatINRCompact(k.payouts.clawbackDue)} clawback due` : ""}) · incentives ${formatINRCompact(k.incentives)}`}
        />
      </div>

      <div className="mt-5 grid gap-5 2xl:grid-cols-[minmax(0,1fr)_360px]">
        <div className="space-y-5">
          <Section title="Mandate health" description="Absorption is compared with the pace needed to hit target by the end of the mandate term.">
            <div className="-mx-4 overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="pl-4">Mandate</TableHead>
                    <TableHead>Absorption vs pace</TableHead>
                    <TableHead className="text-right">Booked value</TableHead>
                    <TableHead className="text-right">Collected</TableHead>
                    <TableHead className="text-right">soleX fee</TableHead>
                    <TableHead className="text-right">Channel cost</TableHead>
                    <TableHead className="text-right">Net</TableHead>
                    <TableHead>Term</TableHead>
                    <TableHead className="pr-4">Health</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {d.mandates.map((m) => (
                    <TableRow key={m.projectId} data-testid={`mandate-${m.projectCode}`}>
                      <TableCell className="pl-4">
                        <Link href={`/projects/${m.projectId}`} className="flex items-center gap-2 font-medium hover:underline">
                          <span className="size-2.5 shrink-0 rounded-sm" style={{ background: m.color }} />
                          {m.projectName}
                        </Link>
                        <div className="pl-4.5 text-xs text-muted-foreground">
                          {m.developerName} · {m.city}
                        </div>
                      </TableCell>
                      <TableCell className="min-w-44">
                        <div className="flex justify-between text-xs tabular">
                          <span>
                            {m.absorbed} / {m.targetUnits}
                          </span>
                          <span className="text-muted-foreground">pace {m.expectedByNow}</span>
                        </div>
                        <div className="relative mt-1">
                          <Meter value={m.absorbed} max={m.targetUnits} tone="gold" />
                          <span className="absolute top-[-2px] h-2.5 w-0.5 bg-foreground/60" style={{ left: `${pct(m.expectedByNow, m.targetUnits)}%` }} title="Pace needed by today" />
                        </div>
                      </TableCell>
                      <TableCell className="text-right">
                        <Money value={m.bookingValue} />
                      </TableCell>
                      <TableCell className="text-right">
                        <Money value={m.collected} />
                        {m.overdue > 0 && <div className="text-xs text-destructive">{formatINRCompact(m.overdue)} overdue</div>}
                      </TableCell>
                      <TableCell className="text-right">
                        <Money value={m.fee} />
                      </TableCell>
                      <TableCell className="text-right text-muted-foreground">
                        <Money value={m.partnerCost + m.incentiveCost} />
                      </TableCell>
                      <TableCell className="text-right font-medium">
                        <Money value={m.net} />
                      </TableCell>
                      <TableCell className={cn("text-sm", m.daysLeft < 60 && "font-medium text-[oklch(0.5_0.13_50)]")}>{m.daysLeft}d left</TableCell>
                      <TableCell className="pr-4">
                        <Pill tone={HEALTH[m.health].tone}>{HEALTH[m.health].label}</Pill>
                        {m.pendingApprovals > 0 && <div className="mt-1 text-xs text-muted-foreground">{m.pendingApprovals} pending approval</div>}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </Section>

          <div className="grid gap-5 lg:grid-cols-2">
            <Section title="Booking value by month" description="Confirmed bookings, by booking date, ₹ crore">
              <BookingsTrendChart data={d.trend} series={d.trendSeries} />
              <details className="mt-3 text-xs">
                <summary className="cursor-pointer text-muted-foreground">View as table</summary>
                <table className="mt-2 w-full tabular">
                  <thead>
                    <tr className="text-muted-foreground">
                      <th className="text-left font-normal">Month</th>
                      {d.trendSeries.map((s) => (
                        <th key={s.key} className="text-right font-normal">
                          {s.key}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {d.trend.map((r) => (
                      <tr key={String(r.month)}>
                        <td>{r.month}</td>
                        {d.trendSeries.map((s) => (
                          <td key={s.key} className="text-right">
                            ₹{Number(r[s.key]).toFixed(2)} Cr ({r[`${s.key}_n`]})
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </details>
            </Section>

            <Section title="Lead-to-booking funnel" description="Every lead captured under the selected mandates">
              <ol className="space-y-2.5">
                {d.funnel.map((f, i) => (
                  <li key={f.stage} title={`${f.stage}: ${f.n} leads`}>
                    <div className="flex justify-between text-xs">
                      <span className="font-medium">{f.stage}</span>
                      <span className="tabular text-muted-foreground">
                        {f.n}
                        {i > 0 && ` · ${pct(f.n, d.funnel[i - 1].n)}% of previous`}
                      </span>
                    </div>
                    <div className="mt-1 h-3 rounded-full bg-muted">
                      <div className="h-3 rounded-full bg-[#3b64a8]" style={{ width: `${Math.max(1, (f.n / funnelMax) * 100)}%` }} />
                    </div>
                  </li>
                ))}
              </ol>
              <p className="mt-3 text-xs text-muted-foreground">
                Overall lead → booking conversion <strong className="text-foreground">{pct(d.funnel.at(-1)?.n ?? 0, funnelMax)}%</strong> · {k.openLeads} open leads · {k.newLeadsThisMonth} new this month
              </p>
            </Section>
          </div>

          <div className="grid gap-5 lg:grid-cols-2">
            <Section title="Lead sources" description="Which channels turn into bookings (live bookings only)">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Source</TableHead>
                    <TableHead className="text-right">Leads</TableHead>
                    <TableHead className="text-right">Bookings</TableHead>
                    <TableHead>Conversion</TableHead>
                    <TableHead className="text-right">Value</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {d.sources
                    .filter((s) => s.leads > 0)
                    .map((s) => (
                      <TableRow key={s.source}>
                        <TableCell>{s.source === "BROKER" ? "Channel partners" : humanize(s.source)}</TableCell>
                        <TableCell className="text-right tabular">{s.leads}</TableCell>
                        <TableCell className="text-right tabular">{s.bookings}</TableCell>
                        <TableCell className="w-28">
                          <div className="flex items-center gap-2" title={`${(s.conversion * 100).toFixed(1)}%`}>
                            <div className="h-1.5 flex-1 rounded-full bg-muted">
                              <div className="h-1.5 rounded-full bg-[#3b64a8]" style={{ width: `${Math.min(100, s.conversion * 400)}%` }} />
                            </div>
                            <span className="w-9 text-right text-xs tabular">{(s.conversion * 100).toFixed(0)}%</span>
                          </div>
                        </TableCell>
                        <TableCell className="text-right">
                          <Money value={s.value} />
                        </TableCell>
                      </TableRow>
                    ))}
                </TableBody>
              </Table>
            </Section>

            <Section title="Channel partners" description="Attributed leads, bookings and brokerage">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Partner</TableHead>
                    <TableHead className="text-right">Leads</TableHead>
                    <TableHead className="text-right">Visits</TableHead>
                    <TableHead className="text-right">Bookings</TableHead>
                    <TableHead className="text-right">Value</TableHead>
                    <TableHead className="text-right">Brokerage</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {d.partners.map((p) => (
                    <TableRow key={p.id}>
                      <TableCell>
                        <div className="font-medium">{p.firmName}</div>
                        <div className="text-xs text-muted-foreground">{p.code}</div>
                      </TableCell>
                      <TableCell className="text-right tabular">{p.leads}</TableCell>
                      <TableCell className="text-right tabular">{p.visits}</TableCell>
                      <TableCell className="text-right tabular">{p.bookings}</TableCell>
                      <TableCell className="text-right">
                        <Money value={p.value} />
                      </TableCell>
                      <TableCell className="text-right">
                        <Money value={p.brokerage} />
                        <div className="text-xs text-muted-foreground">{formatINRCompact(p.paid)} paid</div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </Section>
          </div>

          <Section title="Sales team" description="Open pipeline and follow-up discipline per exec">
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              {d.team.map((t) => (
                <div key={t.id} className="rounded-lg border p-3">
                  <div className="flex items-center gap-2 text-sm font-medium">
                    <Users className="size-4 text-gold" />
                    {t.name}
                  </div>
                  <div className="mt-2 grid grid-cols-3 gap-2 text-center text-xs">
                    <div>
                      <div className="text-lg font-semibold tabular">{t.open}</div>
                      <div className="text-muted-foreground">open</div>
                    </div>
                    <div>
                      <div className={cn("text-lg font-semibold tabular", t.overdue > 0 && "text-[oklch(0.5_0.13_50)]")}>{t.overdue}</div>
                      <div className="text-muted-foreground">overdue</div>
                    </div>
                    <div>
                      <div className="text-lg font-semibold tabular">{t.bookings}</div>
                      <div className="text-muted-foreground">booked</div>
                    </div>
                  </div>
                  <div className="mt-2 text-center text-xs text-muted-foreground">
                    <Money value={t.value} /> sold
                  </div>
                </div>
              ))}
            </div>
          </Section>
        </div>

        <Section
          title={
            <span className="flex items-center gap-2">
              <AlertTriangle className="size-4 text-status-hold" /> Needs attention
              <Pill tone="warning">{alertCount}</Pill>
            </span>
          }
          description="Approvals, overdue money and expiring commitments"
          className="order-first h-fit 2xl:sticky 2xl:top-4 2xl:order-none"
        >
          <div className="grid gap-5 text-sm md:grid-cols-2 2xl:grid-cols-1" data-testid="alerts">
            <AlertGroup icon={BadgeCheck} title="Discount approvals" empty="Nothing waiting.">
              {d.alerts.pending.map((p) => (
                <Link key={p.id} href={`/bookings/${p.id}`} className="flex justify-between gap-2 rounded-md px-2 py-1.5 hover:bg-muted">
                  <span>
                    {p.code} · {p.unitNo} <span className="text-muted-foreground">· {formatBps(p.discountBps)}</span>
                  </span>
                  <span className="shrink-0 text-xs text-muted-foreground">{p.status === "PENDING_DEV_APPROVAL" ? "with developer" : "with you"}</span>
                </Link>
              ))}
            </AlertGroup>
            <AlertGroup icon={AlarmClock} title="Overdue collections" empty="All instalments are on time.">
              {d.alerts.overdueCollections.slice(0, 6).map((o) => (
                <Link key={o.id} href={`/bookings/${o.id}`} className="flex justify-between gap-2 rounded-md px-2 py-1.5 hover:bg-muted">
                  <span className="truncate">
                    {o.code} · {o.customer}
                  </span>
                  <span className="shrink-0 text-xs">
                    <span className="font-medium text-destructive">{formatINRCompact(o.amount)}</span> <span className="text-muted-foreground">{o.daysLate}d</span>
                  </span>
                </Link>
              ))}
            </AlertGroup>
            <AlertGroup icon={CalendarClock} title="Mandates ending within 60 days" empty="No mandate is close to expiry.">
              {d.alerts.expiringMandates.map((m) => (
                <Link key={m.projectId} href={`/projects/${m.projectId}`} className="flex justify-between gap-2 rounded-md px-2 py-1.5 hover:bg-muted">
                  <span>{m.projectName}</span>
                  <span className="shrink-0 text-xs text-muted-foreground">
                    {m.daysLeft}d · {m.absorbed}/{m.targetUnits} sold
                  </span>
                </Link>
              ))}
            </AlertGroup>
            <AlertGroup icon={Undo2} title="Refunds due after cancellation" empty="No refunds pending.">
              {d.alerts.refunds.map((r) => (
                <Link key={r.id} href={`/bookings/${r.id}`} className="flex justify-between gap-2 rounded-md px-2 py-1.5 hover:bg-muted">
                  <span>
                    {r.code} · {r.customer}
                  </span>
                  <span className="shrink-0 text-xs font-medium">{formatINRCompact(r.refundDue)}</span>
                </Link>
              ))}
            </AlertGroup>
            <div className="rounded-lg bg-muted/60 p-3 text-xs text-muted-foreground md:col-span-2 2xl:col-span-1">
              {k.overdueFollowUps} leads have an overdue follow-up and {k.visitsLast30} site visits were completed in the last 30 days.{" "}
              <Link href="/leads?tab=OVERDUE" className="font-medium text-foreground hover:underline">
                Review follow-ups →
              </Link>
            </div>
          </div>
        </Section>
      </div>
    </>
  );
}

function AlertGroup({ icon: Icon, title, empty, children }: { icon: typeof AlarmClock; title: string; empty: string; children: React.ReactNode }) {
  const items = Array.isArray(children) ? children.filter(Boolean) : children ? [children] : [];
  return (
    <div>
      <div className="mb-1 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        <Icon className="size-3.5" /> {title}
      </div>
      {items.length === 0 ? <p className="px-2 text-xs text-muted-foreground">{empty}</p> : <div className="-mx-2">{children}</div>}
    </div>
  );
}
