import Link from "next/link";
import type { Metadata } from "next";
import { CalendarRange, Handshake, IndianRupee, TrendingUp, Users } from "lucide-react";
import { formatINRCompact } from "@/lib/money";
import { formatDateTime, humanize, pct } from "@/lib/format";
import { requireActor } from "@/modules/identity/session";
import { getCommandCentre } from "@/modules/reporting/command";
import { getManagementQueue } from "@/modules/reporting/queue";
import { InfoTip, KpiCard, Meter, Money, PageHeader, Section, TabLinks } from "@/components/app/ui-bits";
import { Pill } from "@/components/app/status";
import { BookingsTrendChart } from "@/components/app/charts";
import { ActionQueue } from "@/components/app/action-queue";
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
  const view = sp.view === "performance" ? "performance" : "overview";
  const d = await getCommandCentre(actor, { projectId });
  const k = d.kpis;
  const delta = k.bookingsThisMonth.value - k.bookingsPrevMonth.value;
  const link = (extra: Record<string, string | undefined>) => {
    const p = new URLSearchParams();
    for (const [key, v] of Object.entries({ project: projectId, view: view === "performance" ? "performance" : undefined, ...extra })) if (v) p.set(key, v);
    const s = p.toString();
    return s ? `/command-centre?${s}` : "/command-centre";
  };

  return (
    <>
      <PageHeader
        eyebrow={`As of ${formatDateTime(d.asOf)}`}
        title="Command centre"
        actions={
          <form action="/command-centre" className="flex items-center gap-2">
            {view === "performance" && <input type="hidden" name="view" value="performance" />}
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

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4" data-testid="kpis">
        <KpiCard
          label="Units sold vs target"
          icon={TrendingUp}
          href="/projects"
          value={
            <span data-testid="kpi-absorbed">
              {k.absorbed}
              <span className="text-base font-normal text-muted-foreground"> / {k.appointedTarget}</span>
            </span>
          }
          sub={
            <span data-testid="kpi-sold">
              <Money value={k.soldValue} /> booked value
            </span>
          }
        />
        <KpiCard
          label="Collected"
          icon={IndianRupee}
          href="/finance"
          tone={k.overdueAmount > 0 ? "warning" : "default"}
          value={
            <span data-testid="kpi-collected">
              <Money value={k.collected} />
            </span>
          }
          sub={k.overdueAmount > 0 ? <span className="text-destructive">{formatINRCompact(k.overdueAmount)} overdue</span> : "Nothing overdue"}
        />
        <KpiCard
          label="Net margin"
          icon={Handshake}
          href="/finance?tab=commissions"
          value={<Money value={k.netMargin} />}
          sub={
            <span data-testid="kpi-fee">
              Fee <Money value={k.fee.expected} /> less brokerage &amp; incentives
            </span>
          }
        />
        <KpiCard
          label="Booked this month"
          icon={CalendarRange}
          href="/bookings"
          value={<Money value={k.bookingsThisMonth.value} />}
          sub={`${k.bookingsThisMonth.count} bookings · ${delta >= 0 ? "▲" : "▼"} ${formatINRCompact(Math.abs(delta))} vs last month`}
        />
      </div>

      <TabLinks
        className="mt-5 mb-4"
        active={view}
        tabs={[
          { key: "overview", label: "Overview", href: link({ view: undefined }) },
          { key: "performance", label: "Performance", href: link({ view: "performance" }) },
        ]}
      />

      {view === "overview" ? <Overview d={d} showAll={sp.all === "1"} actor={actor} link={link} /> : <Performance d={d} />}
    </>
  );
}

type Data = Awaited<ReturnType<typeof getCommandCentre>>;

async function Overview({ d, showAll, actor, link }: { d: Data; showAll: boolean; actor: Awaited<ReturnType<typeof requireActor>>; link: (e: Record<string, string | undefined>) => string }) {
  const queue = await getManagementQueue(actor, d.mandates, showAll ? 50 : 8);
  return (
    <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_380px]">
      <ActionQueue title="Needs your decision" queue={queue} showAllHref={link({ all: "1" })} emptyHint="No approvals, slipping mandates or blocked fees right now." />
      <Section
        title={
          <span className="flex items-center gap-1.5">
            Mandates
            <InfoTip>Units sold against the straight-line pace needed to reach target by the end of each mandate. The tick marks where sales should be today.</InfoTip>
          </span>
        }
        className="h-fit"
      >
        <ul className="space-y-4" data-testid="mandates">
          {d.mandates.map((m) => (
            <li key={m.projectId} data-testid={`mandate-${m.projectCode}`}>
              <div className="flex items-center justify-between gap-2">
                <Link href={`/projects/${m.projectId}`} className="flex min-w-0 items-center gap-2 text-sm font-medium hover:underline">
                  <span className="size-2.5 shrink-0 rounded-sm" style={{ background: m.color }} />
                  <span className="truncate">{m.projectName}</span>
                </Link>
                <Pill tone={HEALTH[m.health].tone}>{HEALTH[m.health].label}</Pill>
              </div>
              <div className="relative mt-2">
                <Meter value={m.absorbed} max={m.targetUnits} tone="gold" />
                <span className="absolute top-[-2px] h-2.5 w-0.5 bg-foreground/60" style={{ left: `${pct(m.expectedByNow, m.targetUnits)}%` }} title={`Pace needed by today: ${m.expectedByNow}`} />
              </div>
              <div className="mt-1.5 flex flex-wrap justify-between gap-x-3 text-xs text-muted-foreground tabular">
                <span>
                  <strong className="text-foreground">
                    {m.absorbed}/{m.targetUnits}
                  </strong>{" "}
                  sold · pace {m.expectedByNow}
                </span>
                <span className={cn(m.daysLeft < 60 && "font-medium text-[oklch(0.5_0.13_50)]")}>{m.daysLeft}d left</span>
              </div>
              <div className="mt-0.5 text-xs text-muted-foreground">
                Collected <Money value={m.collected} />
                {m.overdue > 0 && <span className="text-destructive"> ({formatINRCompact(m.overdue)} late)</span>} · net <Money value={m.net} className="text-foreground" />
              </div>
            </li>
          ))}
        </ul>
      </Section>
    </div>
  );
}

function Performance({ d }: { d: Data }) {
  const k = d.kpis;
  const funnelMax = Math.max(1, d.funnel[0]?.n ?? 1);
  return (
    <div className="space-y-5">
      <div className="grid gap-5 lg:grid-cols-2">
        <Section title="Booking value by month (₹ Cr)">
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

        <Section title={`Lead to booking: ${pct(d.funnel.at(-1)?.n ?? 0, funnelMax)}% conversion`}>
          <ol className="space-y-2.5">
            {d.funnel.map((f, i) => (
              <li key={f.stage} title={`${f.stage}: ${f.n} leads`}>
                <div className="flex justify-between text-xs">
                  <span className="font-medium">{f.stage}</span>
                  <span className="tabular text-muted-foreground">
                    {f.n}
                    {i > 0 && ` · ${pct(f.n, d.funnel[i - 1].n)}%`}
                  </span>
                </div>
                <div className="mt-1 h-3 rounded-full bg-muted">
                  <div className="h-3 rounded-full bg-[#3b64a8]" style={{ width: `${Math.max(1, (f.n / funnelMax) * 100)}%` }} />
                </div>
              </li>
            ))}
          </ol>
          <p className="mt-3 text-xs text-muted-foreground">
            {k.openLeads} open · {k.newLeadsThisMonth} new this month · {k.visitsLast30} visits in 30 days
          </p>
        </Section>
      </div>

      <div className="grid gap-5 lg:grid-cols-2">
        <Section title="Lead sources">
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

        <Section title="Channel partners">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Partner</TableHead>
                <TableHead className="text-right">Leads</TableHead>
                <TableHead className="text-right">Visits</TableHead>
                <TableHead className="text-right">Bookings</TableHead>
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
                    <Money value={p.brokerage} />
                    <div className="text-xs text-muted-foreground">{formatINRCompact(p.paid)} paid</div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Section>
      </div>

      <Section title="Sales team">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {d.team.map((t) => (
            <Link key={t.id} href={`/leads?owner=${t.id}`} className="rounded-lg border p-3 transition-colors hover:bg-muted/50">
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
            </Link>
          ))}
        </div>
      </Section>
    </div>
  );
}
