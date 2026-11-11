"use client";

import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis, type TooltipContentProps } from "recharts";

type Series = { key: string; name: string; color: string };

function TrendTooltip({ active, payload, label, series }: TooltipContentProps<number, string> & { series: Series[] }) {
  if (!active || !payload?.length) return null;
  const row = payload[0].payload as Record<string, number>;
  const total = series.reduce((s, x) => s + (row[x.key] ?? 0), 0);
  return (
    <div className="rounded-lg border bg-popover px-3 py-2 text-xs shadow-md">
      <div className="mb-1 font-medium text-foreground">{label}</div>
      {series.map((s) => (
        <div key={s.key} className="flex items-center justify-between gap-4">
          <span className="flex items-center gap-1.5 text-muted-foreground">
            <span className="size-2 rounded-sm" style={{ background: s.color }} />
            {s.name}
          </span>
          <span className="tabular text-foreground">
            ₹{(row[s.key] ?? 0).toFixed(2)} Cr · {row[`${s.key}_n`] ?? 0}
          </span>
        </div>
      ))}
      <div className="mt-1 flex justify-between border-t pt-1 font-medium text-foreground">
        <span>Total</span>
        <span className="tabular">₹{total.toFixed(2)} Cr</span>
      </div>
    </div>
  );
}

/** Booking value per month, stacked by project. Colours follow the project, never its rank. */
export function BookingsTrendChart({ data, series }: { data: Record<string, string | number>[]; series: Series[] }) {
  return (
    <div>
      <div className="mb-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground" aria-hidden>
        {series.map((s) => (
          <span key={s.key} className="flex items-center gap-1.5">
            <span className="size-2.5 rounded-sm" style={{ background: s.color }} />
            {s.name}
          </span>
        ))}
      </div>
      <div className="h-56" role="img" aria-label="Booking value by month and project, in crore rupees">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={data} margin={{ top: 8, right: 4, bottom: 0, left: -12 }}>
            <CartesianGrid vertical={false} stroke="var(--border)" strokeDasharray="0" />
            <XAxis dataKey="month" tickLine={false} axisLine={{ stroke: "var(--border)" }} tick={{ fontSize: 11, fill: "var(--muted-foreground)" }} />
            <YAxis tickLine={false} axisLine={false} tick={{ fontSize: 11, fill: "var(--muted-foreground)" }} tickFormatter={(v: number) => `₹${v}Cr`} width={56} />
            <Tooltip cursor={{ fill: "var(--muted)", opacity: 0.6 }} content={(props) => <TrendTooltip {...(props as TooltipContentProps<number, string>)} series={series} />} />
            {series.map((s, i) => (
              <Bar
                key={s.key}
                dataKey={s.key}
                name={s.name}
                stackId="value"
                fill={s.color}
                stroke="var(--card)"
                strokeWidth={2}
                maxBarSize={36}
                radius={i === series.length - 1 ? [4, 4, 0, 0] : 0}
                isAnimationActive={false}
              />
            ))}
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
