import { cn } from "@/lib/utils";

export function Wordmark({ className, inverted = false }: { className?: string; inverted?: boolean }) {
  return (
    <span className={cn("font-semibold tracking-tight", inverted ? "text-white" : "text-primary", className)}>
      sole<span className="text-gold">X</span>
    </span>
  );
}

export function SimulatedBadge({ label = "Simulated", className }: { label?: string; className?: string }) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-full border border-dashed border-gold/60 bg-gold-soft px-2 py-0.5 text-[11px] font-medium text-[oklch(0.45_0.07_70)]",
        className,
      )}
      title="Not connected to a real provider in this demo"
    >
      {label}
    </span>
  );
}

export function DemoBanner() {
  return (
    <div className="bg-gold-soft text-[oklch(0.42_0.06_70)] border-b border-gold/30 px-4 py-1 text-center text-xs">
      Evaluation demo · all people, projects and numbers are fictional · messages and payments are simulated
    </div>
  );
}
