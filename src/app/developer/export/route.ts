import { NextResponse, type NextRequest } from "next/server";
import { getActor } from "@/modules/identity/session";
import { can } from "@/modules/identity/permissions";
import { listBookings } from "@/modules/reporting/bookings";
import { db } from "@/lib/db";
import { projectScope } from "@/modules/identity/scope";
import { recordEvent } from "@/modules/audit/audit";

function csvCell(v: unknown): string {
  const s = v === null || v === undefined ? "" : String(v);
  // Quote everything and neutralise spreadsheet formula injection.
  const safe = /^[=+\-@]/.test(s) ? `'${s}` : s;
  return `"${safe.replace(/"/g, '""')}"`;
}

/** Developer MIS: bookings for one of the developer's own projects, as CSV. */
export async function GET(request: NextRequest) {
  const actor = await getActor();
  if (!actor || actor.role !== "DEVELOPER" || !can(actor, "report.export")) {
    return new NextResponse("Not found", { status: 404 });
  }
  const projectId = request.nextUrl.searchParams.get("project") ?? "";
  const project = await db.project.findFirst({ where: { AND: [{ id: projectId }, projectScope(actor)] }, select: { code: true } });
  if (!project) return new NextResponse("Not found", { status: 404 });

  const rows = await listBookings(actor, { projectId });
  const header = ["Booking", "Booked on", "Unit", "Configuration", "Customer", "Channel", "Agreement value (INR)", "Discount (bps)", "Collected (INR)", "Overdue (INR)", "Status"];
  const lines = rows.map((b) =>
    [b.code, b.bookedAt.toISOString().slice(0, 10), b.unitNo, b.config, b.customerName, b.channel, b.agreementValue, b.discountBps, b.received, b.overdue, b.status].map(csvCell).join(","),
  );
  const body = [header.map(csvCell).join(","), ...lines].join("\r\n");
  await recordEvent(db, actor, {
    type: "REPORT_EXPORTED",
    entityType: "Project",
    entityId: projectId,
    projectId,
    summary: `MIS export (${rows.length} bookings) downloaded by ${actor.name}`,
  });
  return new NextResponse(body, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="soleX-MIS-${project.code}-${new Date().toISOString().slice(0, 10)}.csv"`,
    },
  });
}
