import Link from "next/link";
import type { Metadata } from "next";
import { CheckCircle2, Mail, MessageCircle, Smartphone, XCircle, BellRing } from "lucide-react";
import { formatDateTime, humanize } from "@/lib/format";
import { requireActor } from "@/modules/identity/session";
import { getActivity } from "@/modules/reporting/finance";
import { runIntegrityChecks } from "@/modules/reporting/integrity";
import { PageHeader, Section } from "@/components/app/ui-bits";
import { SimulatedBadge } from "@/components/app/brand";
import { cn } from "@/lib/utils";

export const metadata: Metadata = { title: "Activity & integrity" };

const CHANNEL_ICON = { WHATSAPP: MessageCircle, EMAIL: Mail, SMS: Smartphone, IN_APP: BellRing } as const;

export default async function ActivityPage({ searchParams }: PageProps<"/activity">) {
  const actor = await requireActor({ permission: "audit.view" });
  const sp = await searchParams;
  const type = typeof sp.type === "string" && sp.type ? sp.type : undefined;
  const [activity, checks] = await Promise.all([getActivity(actor, { type }), runIntegrityChecks()]);
  const allOk = checks.every((c) => c.ok);

  return (
    <>
      <PageHeader
        eyebrow="Governance"
        title="Activity & integrity"
        subtitle="The audit trail is written in the same transaction as each change. The integrity checks re-verify the whole database every time this page loads."
      />

      <Section
        title={
          <span className="flex items-center gap-2" data-testid="integrity-status">
            {allOk ? <CheckCircle2 className="size-4 text-status-available" /> : <XCircle className="size-4 text-destructive" />}
            {allOk ? `All ${checks.length} integrity checks pass` : "Integrity violations found"}
          </span>
        }
        description="Live invariants across inventory, bookings, collections and the commission ledger"
        className="mb-5"
      >
        <ul className="grid gap-2 md:grid-cols-2">
          {checks.map((c) => (
            <li key={c.key} className={cn("flex items-start gap-2 rounded-lg border p-3 text-sm", !c.ok && "border-destructive/40 bg-destructive/5")}>
              {c.ok ? <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-status-available" /> : <XCircle className="mt-0.5 size-4 shrink-0 text-destructive" />}
              <div>
                <div>{c.label}</div>
                {c.violations.map((v) => (
                  <div key={v} className="text-xs text-destructive">
                    {v}
                  </div>
                ))}
              </div>
            </li>
          ))}
        </ul>
      </Section>

      <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_400px]">
        <Section
          title="Audit trail"
          description="Latest 120 events"
          actions={
            <form action="/activity" className="flex items-center gap-2">
              <select name="type" defaultValue={type ?? ""} className="h-8 rounded-lg border bg-card px-2 text-xs" aria-label="Filter by event type">
                <option value="">All event types</option>
                {activity.types.map((t) => (
                  <option key={t.type} value={t.type}>
                    {t.type} ({t.count})
                  </option>
                ))}
              </select>
              <button className="h-8 rounded-lg border px-2 text-xs hover:bg-muted" type="submit">
                Filter
              </button>
            </form>
          }
        >
          <ol className="space-y-2 text-sm">
            {activity.events.map((e) => (
              <li key={e.id} className="grid gap-1 border-b pb-2 last:border-0 sm:grid-cols-[120px_1fr]">
                <span className="text-xs text-muted-foreground">{formatDateTime(e.at)}</span>
                <span>
                  <span className="mr-1.5 rounded bg-muted px-1.5 py-0.5 font-mono text-[10px]">{e.type}</span>
                  {e.entityType === "Booking" ? (
                    <Link href={`/bookings/${e.entityId}`} className="hover:underline">
                      {e.summary}
                    </Link>
                  ) : e.entityType === "Lead" ? (
                    <Link href={`/leads/${e.entityId}`} className="hover:underline">
                      {e.summary}
                    </Link>
                  ) : (
                    e.summary
                  )}
                  <span className="text-xs text-muted-foreground">
                    {" "}
                    · {e.actorName} ({humanize(e.actorRole)})
                  </span>
                </span>
              </li>
            ))}
          </ol>
        </Section>

        <Section
          title={
            <span className="flex items-center gap-2">
              Notification outbox <SimulatedBadge />
            </span>
          }
          description="What would be sent by WhatsApp Business API, email or SMS. Nothing leaves this demo."
          className="h-fit"
        >
          <ul className="space-y-3">
            {activity.notifications.map((n) => {
              const Icon = CHANNEL_ICON[n.channel as keyof typeof CHANNEL_ICON] ?? BellRing;
              return (
                <li key={n.id} className="rounded-lg border p-2.5 text-xs">
                  <div className="flex items-center justify-between gap-2 text-muted-foreground">
                    <span className="flex items-center gap-1.5 font-medium text-foreground">
                      <Icon className="size-3.5 text-gold" />
                      {humanize(n.channel)} → {n.recipient}
                    </span>
                    <span>{formatDateTime(n.createdAt)}</span>
                  </div>
                  {n.subject && <div className="mt-1 font-medium">{n.subject}</div>}
                  <p className="mt-0.5">{n.body}</p>
                </li>
              );
            })}
          </ul>
        </Section>
      </div>
    </>
  );
}
