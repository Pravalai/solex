"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  Activity,
  BadgeCheck,
  Building2,
  ClipboardList,
  FileSpreadsheet,
  Gauge,
  Handshake,
  Landmark,
  LayoutDashboard,
  Users,
  Wallet,
  type LucideIcon,
} from "lucide-react";
import { cn } from "@/lib/utils";

// Icons are referenced by name so server components can pass plain data.
const ICONS = {
  gauge: Gauge,
  building: Building2,
  users: Users,
  clipboard: ClipboardList,
  check: BadgeCheck,
  landmark: Landmark,
  activity: Activity,
  dashboard: LayoutDashboard,
  wallet: Wallet,
  handshake: Handshake,
  sheet: FileSpreadsheet,
} satisfies Record<string, LucideIcon>;

export type NavItem = { href: string; label: string; icon: keyof typeof ICONS; badge?: number; exact?: boolean };

function isActive(pathname: string, item: NavItem) {
  return item.exact ? pathname === item.href : pathname === item.href || pathname.startsWith(`${item.href}/`);
}

export function SidebarNav({ items }: { items: NavItem[] }) {
  const pathname = usePathname();
  return (
    <nav className="flex flex-col gap-0.5">
      {items.map((item) => {
        const Icon = ICONS[item.icon];
        const active = isActive(pathname, item);
        return (
          <Link
            key={item.href}
            href={item.href}
            className={cn(
              "flex items-center gap-2.5 rounded-md px-3 py-2 text-sm transition-colors",
              active ? "bg-sidebar-accent font-medium text-white" : "text-sidebar-foreground/80 hover:bg-sidebar-accent/60 hover:text-white",
            )}
          >
            <Icon className={cn("size-4", active && "text-sidebar-primary")} />
            <span className="flex-1">{item.label}</span>
            {item.badge ? (
              <span className="rounded-full bg-sidebar-primary px-1.5 text-[11px] font-semibold text-sidebar-primary-foreground">{item.badge}</span>
            ) : null}
          </Link>
        );
      })}
    </nav>
  );
}

export function TopNav({ items }: { items: NavItem[] }) {
  const pathname = usePathname();
  return (
    <nav className="flex gap-1 overflow-x-auto">
      {items.map((item) => {
        const Icon = ICONS[item.icon];
        const active = isActive(pathname, item);
        return (
          <Link
            key={item.href}
            href={item.href}
            className={cn(
              "flex shrink-0 items-center gap-1.5 rounded-md px-3 py-2 text-sm transition-colors",
              active ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-muted hover:text-foreground",
            )}
          >
            <Icon className="size-4" />
            {item.label}
            {item.badge ? <span className="rounded-full bg-gold px-1.5 text-[11px] font-semibold text-white">{item.badge}</span> : null}
          </Link>
        );
      })}
    </nav>
  );
}

/** Thumb-friendly bottom navigation for the broker portal on phones. */
export function BottomNav({ items }: { items: NavItem[] }) {
  const pathname = usePathname();
  return (
    <nav className="fixed inset-x-0 bottom-0 z-30 grid border-t bg-card/95 backdrop-blur sm:hidden" style={{ gridTemplateColumns: `repeat(${items.length}, 1fr)` }}>
      {items.map((item) => {
        const Icon = ICONS[item.icon];
        const active = isActive(pathname, item);
        return (
          <Link key={item.href} href={item.href} className={cn("flex flex-col items-center gap-0.5 py-2.5 text-[11px]", active ? "text-primary font-medium" : "text-muted-foreground")}>
            <Icon className="size-5" />
            {item.label}
          </Link>
        );
      })}
    </nav>
  );
}
