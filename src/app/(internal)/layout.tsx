import { db } from "@/lib/db";
import { requireActor } from "@/modules/identity/session";
import { can } from "@/modules/identity/permissions";
import { INTERNAL_ROLES } from "@/modules/identity/roles";
import { DemoBanner, Wordmark } from "@/components/app/brand";
import { SidebarNav, TopNav, type NavItem } from "@/components/app/nav";
import { UserBlock } from "@/components/app/user-menu";

export const dynamic = "force-dynamic";

export default async function InternalLayout({ children }: { children: React.ReactNode }) {
  const actor = await requireActor({ roles: INTERNAL_ROLES });
  // Discount approvals are decided from the command centre's queue; its nav badge shows how many wait.
  const pendingApprovals = can(actor, "discount.approve.management")
    ? await db.booking.count({ where: { status: "PENDING_MGMT_APPROVAL" } })
    : 0;

  const items: NavItem[] = [
    can(actor, "command.view") && { href: "/command-centre", label: "Command centre", icon: "gauge", badge: pendingApprovals },
    can(actor, "lead.view") && { href: "/leads", label: actor.role === "SALES" ? "My leads" : "Leads", icon: "users" },
    { href: "/projects", label: "Projects & inventory", icon: "building" },
    { href: "/bookings", label: "Bookings", icon: "clipboard" },
    can(actor, "finance.view") && { href: "/finance", label: "Finance", icon: "landmark" },
    can(actor, "audit.view") && { href: "/activity", label: "Audit & integrity", icon: "activity" },
  ].filter(Boolean) as NavItem[];

  return (
    <div className="flex min-h-screen flex-col">
      <DemoBanner />
      <div className="flex flex-1">
        <aside className="sticky top-0 hidden h-screen w-60 shrink-0 flex-col bg-sidebar px-3 py-4 md:flex">
          <div className="px-3 pb-6">
            <Wordmark inverted className="text-2xl" />
            <div className="text-[10px] uppercase tracking-[0.2em] text-sidebar-primary">Mandate Sales OS</div>
          </div>
          <SidebarNav items={items} />
          <div className="mt-auto border-t border-sidebar-border px-2 pt-4">
            <UserBlock actor={actor} inverted />
          </div>
        </aside>
        <div className="flex min-w-0 flex-1 flex-col">
          <header className="flex items-center justify-between gap-3 border-b bg-card px-4 py-2 md:hidden">
            <Wordmark className="text-xl" />
            <UserBlock actor={actor} />
          </header>
          <div className="border-b bg-card px-2 py-1 md:hidden">
            <TopNav items={items} />
          </div>
          <main className="mx-auto w-full max-w-[1400px] flex-1 px-4 py-6 md:px-8">{children}</main>
        </div>
      </div>
    </div>
  );
}
