import { db } from "@/lib/db";
import { requireActor } from "@/modules/identity/session";
import { DemoBanner, Wordmark } from "@/components/app/brand";
import { TopNav, type NavItem } from "@/components/app/nav";
import { UserBlock } from "@/components/app/user-menu";

export const dynamic = "force-dynamic";

export default async function DeveloperLayout({ children }: { children: React.ReactNode }) {
  const actor = await requireActor({ roles: ["DEVELOPER"] });
  const [developer, pending] = await Promise.all([
    db.developer.findUniqueOrThrow({ where: { id: actor.developerId! }, select: { name: true } }),
    db.booking.count({ where: { status: "PENDING_DEV_APPROVAL", project: { developerId: actor.developerId! } } }),
  ]);
  const items: NavItem[] = [
    { href: "/developer", label: "Portfolio", icon: "dashboard", exact: true },
    { href: "/developer/approvals", label: "Approvals", icon: "check", badge: pending },
  ];
  return (
    <div className="flex min-h-screen flex-col">
      <DemoBanner />
      <header className="border-b bg-card">
        <div className="mx-auto flex max-w-[1300px] flex-wrap items-center justify-between gap-3 px-4 py-2.5 md:px-8">
          <div className="flex items-center gap-4">
            <div className="flex items-baseline gap-2">
              <Wordmark className="text-xl" />
              <span className="text-xs font-medium text-muted-foreground">Developer portal</span>
            </div>
            <span className="hidden h-5 w-px bg-border sm:block" />
            <span className="hidden text-sm font-medium sm:block">{developer.name}</span>
          </div>
          <TopNav items={items} />
          <div className="w-56">
            <UserBlock actor={actor} />
          </div>
        </div>
      </header>
      <main className="mx-auto w-full max-w-[1300px] flex-1 px-4 py-6 md:px-8">{children}</main>
    </div>
  );
}
