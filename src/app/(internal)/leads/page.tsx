import Link from "next/link";
import type { Metadata } from "next";
import { AlarmClock, CalendarDays, Search } from "lucide-react";
import type { LeadSource, LeadStage } from "@/generated/prisma/enums";
import { db } from "@/lib/db";
import { formatDate, formatDateTime, humanize } from "@/lib/format";
import { requireActor } from "@/modules/identity/session";
import { can } from "@/modules/identity/permissions";
import { projectScope } from "@/modules/identity/scope";
import { leadStageCounts, listLeads, myAgenda, type LeadFilters } from "@/modules/reporting/leads";
import { EmptyState, Money, PageHeader } from "@/components/app/ui-bits";
import { LeadStagePill, leadStageLabel } from "@/components/app/status";
import { NewLeadDialog } from "@/components/app/new-lead-dialog";
import { selectClass } from "@/components/app/styles";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { cn } from "@/lib/utils";
import { createLeadAction } from "../actions";

export const metadata: Metadata = { title: "Leads" };

const TABS: { key: string; label: string; stage?: LeadFilters["stage"] }[] = [
  { key: "OPEN", label: "Open", stage: "OPEN" },
  { key: "OVERDUE", label: "Overdue follow-ups", stage: "OVERDUE" },
  { key: "VISIT_PLANNED", label: "Visit planned", stage: "VISIT_PLANNED" },
  { key: "NEGOTIATION", label: "Negotiation", stage: "NEGOTIATION" },
  { key: "BOOKED", label: "Booked", stage: "BOOKED" },
  { key: "LOST", label: "Lost", stage: "LOST" },
  { key: "ALL", label: "All" },
];

const FUNNEL: LeadStage[] = ["NEW", "CONTACTED", "QUALIFIED", "FOLLOW_UP", "VISIT_PLANNED", "VISIT_DONE", "NEGOTIATION", "BOOKING_INITIATED", "BOOKED"];

export default async function LeadsPage({ searchParams }: PageProps<"/leads">) {
  const actor = await requireActor({ permission: "lead.view" });
  const sp = await searchParams;
  const tab = typeof sp.tab === "string" ? sp.tab : "OPEN";
  const q = typeof sp.q === "string" ? sp.q : undefined;
  const projectId = typeof sp.project === "string" && sp.project ? sp.project : undefined;
  const source = typeof sp.source === "string" && sp.source ? (sp.source as LeadSource) : undefined;
  const stage = TABS.find((t) => t.key === tab)?.stage;

  const [leads, counts, agenda, projects] = await Promise.all([
    listLeads(actor, { stage, q, projectId, source }),
    leadStageCounts(actor),
    myAgenda(actor),
    db.project.findMany({ where: projectScope(actor), select: { id: true, name: true }, orderBy: { name: "asc" } }),
  ]);
  const qs = (extra: Record<string, string | undefined>) => {
    const p = new URLSearchParams();
    const merged = { tab, q, project: projectId, source, ...extra };
    for (const [k, v] of Object.entries(merged)) if (v) p.set(k, v);
    return `/leads?${p}`;
  };

  return (
    <>
      <PageHeader
        eyebrow={actor.role === "SALES" ? "My workspace" : "Sales CRM"}
        title={actor.role === "SALES" ? "My leads" : "Leads"}
        subtitle="Every enquiry, from every channel, with source and partner attribution."
        actions={can(actor, "lead.create") && <NewLeadDialog action={createLeadAction} projects={projects} />}
      />

      <div className="mb-5 grid gap-3 md:grid-cols-[minmax(0,1fr)_1fr_2fr]">
        <Link href={qs({ tab: "OVERDUE" })} className={cn("rounded-xl border bg-card p-4 shadow-xs", agenda.overdue > 0 && "border-status-hold/60")}>
          <div className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
            <AlarmClock className="size-3.5" /> Overdue follow-ups
          </div>
          <div className="mt-1 text-2xl font-semibold tabular">{agenda.overdue}</div>
        </Link>
        <div className="rounded-xl border bg-card p-4 shadow-xs">
          <div className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
            <CalendarDays className="size-3.5" /> Site visits, next 3 days
          </div>
          <div className="mt-1 text-2xl font-semibold tabular">{agenda.visits.length}</div>
        </div>
        <div className="rounded-xl border bg-card p-4 shadow-xs">
          <div className="text-xs font-medium text-muted-foreground">Upcoming visits</div>
          {agenda.visits.length === 0 ? (
            <p className="mt-2 text-xs text-muted-foreground">Nothing scheduled.</p>
          ) : (
            <ul className="mt-2 space-y-1 text-sm">
              {agenda.visits.slice(0, 4).map((v) => (
                <li key={v.id} className="flex justify-between gap-2">
                  <Link href={`/leads/${v.lead.id}`} className="truncate hover:underline">
                    {v.lead.name} <span className="text-muted-foreground">· {v.project.name}</span>
                  </Link>
                  <span className="shrink-0 text-xs text-muted-foreground">{formatDateTime(v.scheduledAt)}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>

      <div className="mb-4 flex flex-wrap gap-1 rounded-xl border bg-card p-1">
        {FUNNEL.map((s) => (
          <div key={s} className="flex min-w-[88px] flex-1 flex-col items-center rounded-lg px-2 py-1.5 text-center">
            <span className="text-lg font-semibold tabular">{counts[s] ?? 0}</span>
            <span className="text-[10px] text-muted-foreground">{leadStageLabel(s)}</span>
          </div>
        ))}
      </div>

      <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap gap-1">
          {TABS.map((t) => (
            <Link
              key={t.key}
              href={qs({ tab: t.key })}
              className={cn("rounded-md px-3 py-1.5 text-sm", tab === t.key ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-muted")}
            >
              {t.label}
            </Link>
          ))}
        </div>
        <form className="flex flex-wrap items-center gap-2" action="/leads">
          <input type="hidden" name="tab" value={tab} />
          <select name="project" defaultValue={projectId ?? ""} className={cn(selectClass, "w-40")}>
            <option value="">All projects</option>
            {projects.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
          <select name="source" defaultValue={source ?? ""} className={cn(selectClass, "w-36")}>
            <option value="">All sources</option>
            {["BROKER", "META_ADS", "GOOGLE_ADS", "WEBSITE", "WALK_IN", "REFERRAL", "DIRECT"].map((s) => (
              <option key={s} value={s}>
                {humanize(s)}
              </option>
            ))}
          </select>
          <div className="relative">
            <Search className="absolute top-2 left-2 size-4 text-muted-foreground" />
            <Input name="q" defaultValue={q} placeholder="Name, code or phone" className="w-52 pl-8" />
          </div>
          <Button type="submit" variant="outline">
            Filter
          </Button>
        </form>
      </div>

      {leads.length === 0 ? (
        <EmptyState title="No leads match these filters." />
      ) : (
        <div className="rounded-xl border bg-card shadow-xs">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Lead</TableHead>
                <TableHead>Project</TableHead>
                <TableHead>Source</TableHead>
                <TableHead>Stage</TableHead>
                {actor.role !== "SALES" && <TableHead>Owner</TableHead>}
                <TableHead>Wants</TableHead>
                <TableHead>Next follow-up</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {leads.map((l) => (
                <TableRow key={l.id}>
                  <TableCell>
                    <Link href={`/leads/${l.id}`} className="font-medium hover:underline" data-testid={`lead-row-${l.code}`}>
                      {l.name}
                    </Link>
                    <div className="text-xs text-muted-foreground">{l.code}</div>
                  </TableCell>
                  <TableCell className="text-sm">{l.project.name}</TableCell>
                  <TableCell className="text-sm">
                    {l.brokerName ? (
                      <span>
                        Partner · <span className="font-medium">{l.brokerName}</span>
                      </span>
                    ) : (
                      humanize(l.source)
                    )}
                    {l.campaign && <div className="text-xs text-muted-foreground">{l.campaign}</div>}
                  </TableCell>
                  <TableCell>
                    <LeadStagePill stage={l.stage} />
                  </TableCell>
                  {actor.role !== "SALES" && <TableCell className="text-sm">{l.assignedTo ?? "—"}</TableCell>}
                  <TableCell className="text-sm">
                    {l.configPref ?? "—"}
                    {l.budgetMax ? (
                      <span className="text-muted-foreground">
                        {" "}
                        · up to <Money value={l.budgetMax} />
                      </span>
                    ) : null}
                  </TableCell>
                  <TableCell className={cn("text-sm", l.overdue && "font-medium text-[oklch(0.5_0.13_50)]")}>
                    {l.nextFollowUpAt ? formatDate(l.nextFollowUpAt) : "—"}
                    {l.overdue && <span className="ml-1 text-xs">overdue</span>}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </>
  );
}
