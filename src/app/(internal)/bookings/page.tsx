import Link from "next/link";
import type { Metadata } from "next";
import type { BookingStatus } from "@/generated/prisma/enums";
import { formatDate } from "@/lib/format";
import { formatBps } from "@/lib/money";
import { requireActor } from "@/modules/identity/session";
import { listBookings } from "@/modules/reporting/bookings";
import { EmptyState, Money, PageHeader } from "@/components/app/ui-bits";
import { BookingStatusPill } from "@/components/app/status";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { cn } from "@/lib/utils";

export const metadata: Metadata = { title: "Bookings" };

const TABS: { key: string; label: string; status?: BookingStatus | "LIVE" | "PENDING" }[] = [
  { key: "LIVE", label: "Live", status: "LIVE" },
  { key: "PENDING", label: "Awaiting approval", status: "PENDING" },
  { key: "CANCELLED", label: "Cancelled", status: "CANCELLED" },
  { key: "ALL", label: "All" },
];

export default async function BookingsPage({ searchParams }: PageProps<"/bookings">) {
  const actor = await requireActor({ permission: "booking.view" });
  const sp = await searchParams;
  const tab = typeof sp.tab === "string" ? sp.tab : "LIVE";
  const projectId = typeof sp.project === "string" ? sp.project : undefined;
  const bookings = await listBookings(actor, { status: TABS.find((t) => t.key === tab)?.status, projectId });
  const total = bookings.reduce((s, b) => s + b.agreementValue, 0);
  const received = bookings.reduce((s, b) => s + b.received, 0);

  return (
    <>
      <PageHeader
        eyebrow="Sales"
        title="Bookings"
        subtitle={
          <>
            {bookings.length} bookings · <Money value={total} /> agreement value · <Money value={received} /> collected
          </>
        }
      />
      <div className="mb-3 flex flex-wrap gap-1">
        {TABS.map((t) => (
          <Link
            key={t.key}
            href={`/bookings?tab=${t.key}${projectId ? `&project=${projectId}` : ""}`}
            className={cn("rounded-md px-3 py-1.5 text-sm", tab === t.key ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-muted")}
          >
            {t.label}
          </Link>
        ))}
      </div>
      {bookings.length === 0 ? (
        <EmptyState title="No bookings here." />
      ) : (
        <div className="rounded-xl border bg-card shadow-xs">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Booking</TableHead>
                <TableHead>Unit</TableHead>
                <TableHead>Customer</TableHead>
                <TableHead>Channel</TableHead>
                <TableHead className="text-right">Agreement value</TableHead>
                <TableHead className="text-right">Collected</TableHead>
                <TableHead className="text-right">Overdue</TableHead>
                <TableHead>Status</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {bookings.map((b) => (
                <TableRow key={b.id}>
                  <TableCell>
                    <Link href={`/bookings/${b.id}`} className="font-medium hover:underline">
                      {b.code}
                    </Link>
                    <div className="text-xs text-muted-foreground">{formatDate(b.bookedAt)}</div>
                  </TableCell>
                  <TableCell className="text-sm">
                    {b.unitNo} <span className="text-muted-foreground">· {b.project.name}</span>
                  </TableCell>
                  <TableCell className="text-sm">
                    {b.customerName}
                    <div className="text-xs text-muted-foreground">{b.salesExec}</div>
                  </TableCell>
                  <TableCell className="text-sm">{b.channel}</TableCell>
                  <TableCell className="text-right">
                    <Money value={b.agreementValue} />
                    {b.discountBps > 0 && <div className="text-xs text-muted-foreground">−{formatBps(b.discountBps)}</div>}
                  </TableCell>
                  <TableCell className="text-right">
                    <Money value={b.received} />
                  </TableCell>
                  <TableCell className={cn("text-right", b.overdue > 0 && "font-medium text-destructive")}>{b.overdue > 0 ? <Money value={b.overdue} /> : "—"}</TableCell>
                  <TableCell>
                    <BookingStatusPill status={b.status} />
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
