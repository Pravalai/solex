import Link from "next/link";
import type { LucideIcon } from "lucide-react";
import { ArrowUpRight, Info } from "lucide-react";
import { formatINR, formatINRCompact } from "@/lib/money";
import { cn } from "@/lib/utils";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

export function Money({ value, compact = true, className }: { value: number; compact?: boolean; className?: string }) {
  if (!compact) return <span className={cn("tabular", className)}>{formatINR(value)}</span>;
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span className={cn("tabular cursor-default", className)}>{formatINRCompact(value)}</span>
      </TooltipTrigger>
      <TooltipContent>{formatINR(value)}</TooltipContent>
    </Tooltip>
  );
}

export function PageHeader({
  title,
  subtitle,
  eyebrow,
  actions,
}: {
  title: React.ReactNode;
  subtitle?: React.ReactNode;
  eyebrow?: React.ReactNode;
  actions?: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-3 pb-5 sm:flex-row sm:items-end sm:justify-between">
      <div className="min-w-0">
        {eyebrow && <div className="mb-1 text-xs font-medium uppercase tracking-wider text-gold">{eyebrow}</div>}
        <h1 className="text-2xl font-semibold tracking-tight text-foreground">{title}</h1>
        {subtitle && <p className="mt-1 text-sm text-muted-foreground">{subtitle}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

export function KpiCard({
  label,
  value,
  sub,
  href,
  icon: Icon,
  tone = "default",
}: {
  label: string;
  value: React.ReactNode;
  sub?: React.ReactNode;
  href?: string;
  icon?: LucideIcon;
  tone?: "default" | "warning" | "danger";
}) {
  const body = (
    <div
      className={cn(
        "group relative h-full rounded-xl border bg-card p-4 shadow-xs transition-colors",
        href && "hover:border-primary/30 hover:bg-accent/40",
        tone === "warning" && "border-status-hold/50",
        tone === "danger" && "border-destructive/40",
      )}
    >
      <div className="flex items-center justify-between gap-2 text-xs font-medium text-muted-foreground">
        <span className="flex items-center gap-1.5">
          {Icon && <Icon className="size-3.5" />}
          {label}
        </span>
        {href && <ArrowUpRight className="size-3.5 opacity-0 transition-opacity group-hover:opacity-100" />}
      </div>
      <div className="mt-2 text-2xl font-semibold tracking-tight tabular">{value}</div>
      {sub && <div className="mt-1 text-xs text-muted-foreground">{sub}</div>}
    </div>
  );
  return href ? (
    <Link href={href} className="block">
      {body}
    </Link>
  ) : (
    body
  );
}

export function Section({
  title,
  description,
  actions,
  children,
  className,
}: {
  title: React.ReactNode;
  description?: React.ReactNode;
  actions?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <section className={cn("rounded-xl border bg-card shadow-xs", className)}>
      <div className="flex flex-wrap items-start justify-between gap-2 border-b px-4 py-3">
        <div>
          <h2 className="text-sm font-semibold">{title}</h2>
          {description && <p className="text-xs text-muted-foreground">{description}</p>}
        </div>
        {actions}
      </div>
      <div className="p-4">{children}</div>
    </section>
  );
}

/** A small "i" that explains a rule or a figure on hover/focus, instead of a paragraph on the page. */
export function InfoTip({ children, className, label = "How this works" }: { children: React.ReactNode; className?: string; label?: string }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button type="button" aria-label={label} className={cn("inline-flex shrink-0 text-muted-foreground/70 hover:text-foreground focus-visible:text-foreground", className)}>
          <Info className="size-3.5" />
        </button>
      </TooltipTrigger>
      <TooltipContent className="max-w-72 text-xs leading-relaxed">{children}</TooltipContent>
    </Tooltip>
  );
}

/** URL-driven tabs (server rendered, shareable, survive refresh). */
export function TabLinks({ tabs, active, className }: { tabs: { key: string; label: React.ReactNode; href: string; count?: number }[]; active: string; className?: string }) {
  return (
    <nav className={cn("flex flex-wrap gap-1", className)}>
      {tabs.map((t) => (
        <Link
          key={t.key}
          href={t.href}
          aria-current={active === t.key ? "page" : undefined}
          className={cn(
            "flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm transition-colors",
            active === t.key ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-muted hover:text-foreground",
          )}
        >
          {t.label}
          {t.count ? <span className={cn("rounded-full px-1.5 text-[11px] font-semibold tabular", active === t.key ? "bg-white/20" : "bg-muted text-foreground")}>{t.count}</span> : null}
        </Link>
      ))}
    </nav>
  );
}

export function EmptyState({ title, hint }: { title: string; hint?: string }) {
  return (
    <div className="rounded-lg border border-dashed p-6 text-center">
      <p className="text-sm font-medium">{title}</p>
      {hint && <p className="mt-1 text-xs text-muted-foreground">{hint}</p>}
    </div>
  );
}

export function Meter({ value, max, className, tone = "primary" }: { value: number; max: number; className?: string; tone?: "primary" | "gold" | "warning" }) {
  const pct = max > 0 ? Math.min(100, Math.round((value / max) * 100)) : 0;
  return (
    <div className={cn("h-1.5 w-full overflow-hidden rounded-full bg-muted", className)}>
      <div
        className={cn("h-full rounded-full", tone === "primary" && "bg-primary", tone === "gold" && "bg-gold", tone === "warning" && "bg-status-hold")}
        style={{ width: `${pct}%` }}
      />
    </div>
  );
}

export function DefinitionList({ items, className }: { items: [React.ReactNode, React.ReactNode][]; className?: string }) {
  return (
    <dl className={cn("grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-sm", className)}>
      {items.map(([k, v], i) => (
        <div key={i} className="contents">
          <dt className="text-muted-foreground">{k}</dt>
          <dd className="text-right font-medium tabular sm:text-left">{v}</dd>
        </div>
      ))}
    </dl>
  );
}
