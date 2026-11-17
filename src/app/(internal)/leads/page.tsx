import Link from "next/link";
import type { Metadata } from "next";
import { Search } from "lucide-react";
import type { LeadSource } from "@/generated/prisma/enums";
import { db } from "@/lib/db";
import { formatDate, humanize } from "@/lib/format";
import { requireActor } from "@/modules/identity/session";
import { can } from "@/modules/identity/permissions";
import { projectScope } from "@/modules/identity/scope";
import { leadStageCounts, listLeads, myAgenda, type LeadFilters } from "@/modules/reporting/leads";
import { getSalesQueue } from "@/modules/reporting/queue";
import { CLOSED_STAGES } from "@/modules/crm/leads";
import { EmptyState, Money, PageHeader, TabLinks } from "@/components/app/ui-bits";
import { LeadStagePill } from "@/components/app/status";
import { NewLeadDialog } from "@/components/app/new-lead-dialog";
import { ActionQueue } from "@/components/app/action-queue";
import { selectClass } from "@/components/app/styles";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { cn } from "@/lib/utils";
import { createLeadAction } from "../actions";

export const metadata: Metadata = { title: "Leads" };

const TABS: { key: string; label: string; stage?: LeadFilters["stage"]; managerOnly?: boolean }[] = [
  { key: "OPEN", label: "Open", stage: "OPEN" },
  { key: "OVERDUE", label: "Overdue", stage: "OVERDUE" },
  { key: "HOT", label: "Close to booking", stage: "HOT" },
  { key: "EXPIRING", label: "Protection ending", stage: "EXPIRING", managerOnly: true },
  { key: "BOOKED", label: "Booked", stage: "BOOKED" },
  { key: "LOST", label: "Lost", stage: "LOST" },
  { key: "ALL", label: "All" },
];

const str = (v: string | string[] | undefined) => (typeof v === "string" && v ? v : undefined);

export default async function LeadsPage({ searchParams }: PageProps<"/leads">) {
  const actor = await requireActor({ permission: "lead.view" });
  const sp = await searchParams;
  const isSales = actor.role === "SALES";
  const tab = str(sp.tab) ?? "OPEN";
  // Sales execs land on their task list; the pipeline table is one click away.
  const view = isSales && !sp.tab && sp.view !== "pipeline" ? "today" : "pipeline";
  const q = str(sp.q);
  const projectId = str(sp.project);
  const source = str(sp.source) as LeadSource | undefined;
  const ownerId = !isSales ? str(sp.owner) : undefined;
  const showAll = sp.all === "1";

  const [projects, owners] = await Promise.all([
    db.project.findMany({ where: projectScope(actor), select: { id: true, name: true }, orderBy: { name: "asc" } }),
    !isSales ? db.user.findMany({ where: { role: "SALES", active: true }, select: { id: true, name: true }, orderBy: { name: "asc" } }) : Promise.resolve([]),
  ]);
  const header = (
    <PageHeader
      title={isSales ? "My leads" : "Leads"}
      actions={can(actor, "lead.create") && <NewLeadDialog action={createLeadAction} projects={projects} />}
    />
  );
  const viewTabs = isSales && (
    <TabLinks
      className="mb-4"
      active={view}
      tabs={[
        { key: "today", label: "Today", href: "/leads" },
        { key: "pipeline", label: "Pipeline", href: "/leads?view=pipeline" },
      ]}
    />
  );

  if (view === "today") {
    const [queue, agenda, counts] = await Promise.all([getSalesQueue(actor, showAll ? 100 : 8), myAgenda(actor), leadStageCounts(actor)]);
    const open = Object.entries(counts)
      .filter(([s]) => !CLOSED_STAGES.includes(s as never))
      .reduce((n, [, c]) => n + (c ?? 0), 0);
    return (
      <>
        {header}
        {viewTabs}
        <p className="mb-3 text-sm text-muted-foreground" data-testid="sales-stats">
          <strong className="text-foreground tabular">{open}</strong> open leads · <strong className={cn("tabular", agenda.overdue > 0 ? "text-[oklch(0.5_0.13_50)]" : "text-foreground")}>{agenda.overdue}</strong> overdue follow-ups ·{" "}
          <strong className="text-foreground tabular">{agenda.visits.length}</strong> visits in the next 3 days
        </p>
        <ActionQueue title="To do now" queue={queue} showAllHref="/leads?all=1" emptyHint="No follow-ups due. New leads and visit requests will appear here." />
      </>
    );
  }

  const stage = TABS.find((t) => t.key === tab)?.stage;
  const leads = await listLeads(actor, { stage, q, projectId, source, ownerId });
  const qs = (extra: Record<string, string | undefined>) => {
    const p = new URLSearchParams();
    const merged = { view: isSales ? "pipeline" : undefined, tab, q, project: projectId, source, owner: ownerId, ...extra };
    for (const [k, v] of Object.entries(merged)) if (v) p.set(k, v);
    return `/leads?${p}`;
  };

  return (
    <>
      {header}
      {viewTabs}
      <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
        <TabLinks active={tab} tabs={TABS.filter((t) => !t.managerOnly || !isSales).map((t) => ({ key: t.key, label: t.label, href: qs({ tab: t.key }) }))} />
        <form className="flex flex-wrap items-center gap-2" action="/leads">
          <input type="hidden" name="tab" value={tab} />
          {isSales && <input type="hidden" name="view" value="pipeline" />}
          <select name="project" defaultValue={projectId ?? ""} className={cn(selectClass, "w-40")} aria-label="Project">
            <option value="">All projects</option>
            {projects.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
          {!isSales && (
            <select name="owner" defaultValue={ownerId ?? ""} className={cn(selectClass, "w-40")} aria-label="Owner">
              <option value="">All owners</option>
              {owners.map((o) => (
                <option key={o.id} value={o.id}>
                  {o.name}
                </option>
              ))}
            </select>
          )}
          <select name="source" defaultValue={source ?? ""} className={cn(selectClass, "w-36")} aria-label="Source">
            <option value="">All sources</option>
            {["BROKER", "META_ADS", "GOOGLE_ADS", "WEBSITE", "WALK_IN", "REFERRAL", "DIRECT"].map((s) => (
              <option key={s} value={s}>
                {s === "BROKER" ? "Channel partner" : humanize(s)}
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
                <TableHead>Source</TableHead>
                <TableHead>Stage</TableHead>
                {!isSales && <TableHead>Owner</TableHead>}
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
                    <div className="text-xs text-muted-foreground">
                      {l.code} · {l.project.name}
                    </div>
                  </TableCell>
                  <TableCell className="text-sm">{l.brokerName ? <span className="font-medium">{l.brokerName}</span> : humanize(l.source)}</TableCell>
                  <TableCell>
                    <LeadStagePill stage={l.stage} />
                  </TableCell>
                  {!isSales && <TableCell className="text-sm">{l.assignedTo ?? "—"}</TableCell>}
                  <TableCell className="text-sm">
                    {l.configPref ?? "—"}
                    {l.budgetMax ? (
                      <span className="text-muted-foreground">
                        {" "}
                        · <Money value={l.budgetMax} />
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
