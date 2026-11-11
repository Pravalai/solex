import type { CommissionKind, CommissionStatus, InstallmentStatus } from "@/generated/prisma/enums";
import { formatBps } from "@/lib/money";
import { formatDate } from "@/lib/format";
import { cn } from "@/lib/utils";
import { Table, TableBody, TableCell, TableFooter, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { CommissionStatusPill, Pill } from "./status";
import { Money } from "./ui-bits";

type InstallmentRow = {
  id: string;
  seq: number;
  label: string;
  bps: number;
  dueDate: Date;
  amountDue: number;
  amountReceived: number;
  status: InstallmentStatus;
  overdue: boolean;
};

export function ScheduleTable({ installments }: { installments: InstallmentRow[] }) {
  const due = installments.reduce((s, i) => s + i.amountDue, 0);
  const received = installments.reduce((s, i) => s + i.amountReceived, 0);
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>#</TableHead>
          <TableHead>Milestone</TableHead>
          <TableHead>Due</TableHead>
          <TableHead className="text-right">Amount</TableHead>
          <TableHead className="text-right">Received</TableHead>
          <TableHead>Status</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {installments.map((i) => (
          <TableRow key={i.id} data-testid={`installment-${i.seq}`}>
            <TableCell className="text-muted-foreground">{i.seq}</TableCell>
            <TableCell>
              {i.label} <span className="text-xs text-muted-foreground">({formatBps(i.bps)})</span>
            </TableCell>
            <TableCell className={cn(i.overdue && "font-medium text-destructive")}>{formatDate(i.dueDate)}</TableCell>
            <TableCell className="text-right">
              <Money value={i.amountDue} compact={false} />
            </TableCell>
            <TableCell className="text-right">
              <Money value={i.amountReceived} compact={false} />
            </TableCell>
            <TableCell>
              {i.overdue ? (
                <Pill tone="danger">Overdue</Pill>
              ) : (
                <Pill tone={i.status === "PAID" ? "success" : i.status === "PARTIAL" ? "warning" : i.status === "CANCELLED" ? "neutral" : "info"}>
                  {i.status === "DUE" ? "Due" : i.status.charAt(0) + i.status.slice(1).toLowerCase()}
                </Pill>
              )}
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
      <TableFooter>
        <TableRow>
          <TableCell colSpan={3}>Total</TableCell>
          <TableCell className="text-right">
            <Money value={due} compact={false} />
          </TableCell>
          <TableCell className="text-right">
            <Money value={received} compact={false} />
          </TableCell>
          <TableCell />
        </TableRow>
      </TableFooter>
    </Table>
  );
}

export const COMMISSION_KIND_LABEL: Record<CommissionKind, string> = {
  DEVELOPER_FEE: "soleX fee (receivable from developer)",
  BROKER_PAYOUT: "Partner brokerage (payable)",
  EMPLOYEE_INCENTIVE: "Sales incentive (payable)",
};

type CommissionRow = {
  id: string;
  kind: CommissionKind;
  status: CommissionStatus;
  rateBps: number;
  baseAmount: number;
  amount: number;
  isAdjustment: boolean;
  reference: string | null;
  broker?: { firmName: string } | null;
  user?: { name: string } | null;
};

export function CommissionTable({
  lines,
  labels = COMMISSION_KIND_LABEL,
  renderActions,
}: {
  lines: CommissionRow[];
  labels?: Partial<Record<CommissionKind, string>>;
  renderActions?: (line: CommissionRow) => React.ReactNode;
}) {
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Line</TableHead>
          <TableHead>Party</TableHead>
          <TableHead className="text-right">Rate</TableHead>
          <TableHead className="text-right">Amount</TableHead>
          <TableHead>Status</TableHead>
          {renderActions && <TableHead />}
        </TableRow>
      </TableHeader>
      <TableBody>
        {lines.map((l) => (
          <TableRow key={l.id} data-testid={`commission-${l.kind}${l.isAdjustment ? "-adj" : ""}`} data-status={l.status}>
            <TableCell className="text-sm">
              {labels[l.kind] ?? l.kind}
              {l.isAdjustment && <Pill tone="danger" className="ml-2">Clawback</Pill>}
              {l.reference && <div className="text-xs text-muted-foreground">Ref {l.reference}</div>}
            </TableCell>
            <TableCell className="text-sm">{l.broker?.firmName ?? l.user?.name ?? "Developer"}</TableCell>
            <TableCell className="text-right tabular">{formatBps(l.rateBps)}</TableCell>
            <TableCell className={cn("text-right", l.amount < 0 && "text-destructive")}>
              <Money value={l.amount} compact={false} />
            </TableCell>
            <TableCell>
              <CommissionStatusPill status={l.status} />
            </TableCell>
            {renderActions && <TableCell className="text-right">{renderActions(l)}</TableCell>}
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}
