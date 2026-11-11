import { db } from "@/lib/db";
import { requireActor } from "@/modules/identity/session";
import { DemoBanner, Wordmark } from "@/components/app/brand";
import { BottomNav, TopNav, type NavItem } from "@/components/app/nav";
import { UserBlock } from "@/components/app/user-menu";

export const dynamic = "force-dynamic";

const ITEMS: NavItem[] = [
  { href: "/broker", label: "Home", icon: "dashboard", exact: true },
  { href: "/broker/projects", label: "Projects", icon: "building" },
  { href: "/broker/leads", label: "My leads", icon: "users" },
  { href: "/broker/commissions", label: "Brokerage", icon: "wallet" },
];

export default async function BrokerLayout({ children }: { children: React.ReactNode }) {
  const actor = await requireActor({ roles: ["BROKER"] });
  const broker = await db.broker.findUniqueOrThrow({ where: { id: actor.brokerId! }, select: { firmName: true, code: true } });
  return (
    <div className="flex min-h-screen flex-col pb-16 sm:pb-0">
      <DemoBanner />
      <header className="sticky top-0 z-20 border-b bg-card/95 backdrop-blur">
        <div className="mx-auto flex max-w-5xl items-center justify-between gap-3 px-4 py-2.5">
          <div className="flex items-baseline gap-2">
            <Wordmark className="text-xl" />
            <span className="text-xs font-medium text-muted-foreground">Partner portal</span>
          </div>
          <div className="hidden text-right text-xs sm:block">
            <div className="font-medium">{broker.firmName}</div>
            <div className="text-muted-foreground">Partner code {broker.code}</div>
          </div>
          <div className="w-44 sm:w-52">
            <UserBlock actor={actor} />
          </div>
        </div>
        <div className="mx-auto hidden max-w-5xl px-3 pb-2 sm:block">
          <TopNav items={ITEMS} />
        </div>
      </header>
      <main className="mx-auto w-full max-w-5xl flex-1 px-4 py-5">{children}</main>
      <BottomNav items={ITEMS} />
    </div>
  );
}
