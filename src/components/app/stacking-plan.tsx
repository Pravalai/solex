import Link from "next/link";
import { Lock } from "lucide-react";
import type { StackUnit } from "@/modules/reporting/inventory";
import { formatINRCompact } from "@/lib/money";
import { cn } from "@/lib/utils";
import { UNIT_STATUS_STYLE } from "./status";

type Tower = { id: string; name: string; retained: boolean; floors: { floor: number; units: StackUnit[] }[] };

export function StatusLegend({ brokerView = false }: { brokerView?: boolean }) {
  const keys = brokerView ? (["AVAILABLE"] as const) : (["AVAILABLE", "HOLD", "BOOKED", "SOLD", "BLOCKED", "RETAINED"] as const);
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
      {keys.map((k) => (
        <span key={k} className="flex items-center gap-1.5">
          <span className={cn("size-3 rounded-sm", UNIT_STATUS_STYLE[k].dot)} />
          {UNIT_STATUS_STYLE[k].label}
        </span>
      ))}
      {brokerView && (
        <span className="flex items-center gap-1.5">
          <span className="size-3 rounded-sm bg-status-blocked" />
          Not available
        </span>
      )}
    </div>
  );
}

/**
 * Tower × floor × stack grid. Each cell is a link (`hrefFor`) so the drawer
 * state lives in the URL. When `hrefFor` is omitted the grid is read-only.
 */
export function StackingPlan({
  towers,
  hrefFor,
  selectedId,
  brokerView = false,
}: {
  towers: Tower[];
  hrefFor?: (unit: StackUnit) => string;
  selectedId?: string;
  brokerView?: boolean;
}) {
  return (
    <div className="flex gap-6 overflow-x-auto pb-2">
      {towers.map((tower) => (
        <div key={tower.id} className="shrink-0">
          <div className="mb-2 flex items-baseline gap-2">
            <h3 className="text-sm font-semibold">Tower {tower.name}</h3>
            {tower.retained && <span className="text-[11px] text-muted-foreground">Retained by developer · outside mandate</span>}
          </div>
          <div className="grid gap-1">
            {tower.floors.map((f) => (
              <div key={f.floor} className="flex items-center gap-1">
                <span className="w-6 text-right text-[10px] text-muted-foreground tabular">{f.floor}</span>
                {f.units.map((u) => {
                  const style = u.retained ? UNIT_STATUS_STYLE.RETAINED : UNIT_STATUS_STYLE[u.status];
                  const content = (
                    <>
                      <span className="flex items-center gap-0.5 text-[11px] font-semibold leading-none">
                        {u.unitNo.split("-")[1]}
                        {u.approvalLock && <Lock className="size-2.5" />}
                      </span>
                      <span className="text-[10px] leading-none opacity-80">{u.config}</span>
                      {!brokerView && <span className="text-[9px] leading-none opacity-70 tabular">{formatINRCompact(u.listPrice).replace("₹", "")}</span>}
                    </>
                  );
                  const cls = cn(
                    "flex h-12 w-[58px] flex-col items-center justify-center gap-0.5 rounded-md border transition-colors",
                    style.cell,
                    u.heldByMe && "ring-2 ring-gold ring-offset-1",
                    selectedId === u.id && "ring-2 ring-primary ring-offset-1",
                  );
                  const label = `${u.unitNo}, ${u.config}, ${u.retained ? "not in mandate" : brokerView && u.status !== "AVAILABLE" ? "not available" : style.label}`;
                  return hrefFor && !u.retained ? (
                    <Link key={u.id} href={hrefFor(u)} scroll={false} className={cls} aria-label={label} title={label} data-testid={`unit-${u.unitNo}`} data-status={u.status}>
                      {content}
                    </Link>
                  ) : (
                    <div key={u.id} className={cls} aria-label={label} title={label} data-testid={`unit-${u.unitNo}`} data-status={u.retained ? "RETAINED" : u.status}>
                      {content}
                    </div>
                  );
                })}
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
