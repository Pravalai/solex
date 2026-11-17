"use client";

import { useState } from "react";
import type { CommissionKind, CommissionStatus } from "@/generated/prisma/enums";
import type { ActionResult } from "@/lib/action";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ActionForm, SubmitButton } from "./action-form";

type Op = "INVOICE" | "RECEIVE" | "APPROVE" | "PAY";

const NEXT: Record<string, { op: Op; label: string; needsRef?: string } | undefined> = {
  "DEVELOPER_FEE:EARNED": { op: "INVOICE", label: "Raise invoice", needsRef: "Invoice no." },
  "DEVELOPER_FEE:INVOICED": { op: "RECEIVE", label: "Mark received" },
  "BROKER_PAYOUT:EARNED": { op: "APPROVE", label: "Approve payout" },
  "BROKER_PAYOUT:APPROVED": { op: "PAY", label: "Mark paid", needsRef: "UTR" },
  "EMPLOYEE_INCENTIVE:EARNED": { op: "APPROVE", label: "Approve" },
  "EMPLOYEE_INCENTIVE:APPROVED": { op: "PAY", label: "Mark paid", needsRef: "Payroll ref" },
};

const ADJUSTMENT_LABEL: Record<Op, string> = {
  INVOICE: "Issue credit note",
  RECEIVE: "Mark adjusted",
  APPROVE: "Approve recovery",
  PAY: "Mark recovered",
};

/** The single next settlement step for a commission line, if the user may take it. */
export function SettleButton({
  action,
  line,
  canApprove,
  canSettle,
  size = "xs",
}: {
  action: (form: FormData) => Promise<ActionResult>;
  line: { id: string; kind: CommissionKind; status: CommissionStatus; isAdjustment?: boolean };
  canApprove: boolean;
  canSettle: boolean;
  size?: "xs" | "sm";
}) {
  const inputClass = size === "sm" ? "h-8 w-32 text-sm" : "h-6 w-28 text-xs";
  const [open, setOpen] = useState(false);
  const base = NEXT[`${line.kind}:${line.status}`];
  if (!base) return null;
  // Clawback lines run the same lifecycle in reverse: a credit note to the developer, a recovery from the payee.
  const next = line.isAdjustment ? { ...base, label: ADJUSTMENT_LABEL[base.op] } : base;
  if (next.op === "APPROVE" ? !canApprove : !canSettle) {
    return <span className="text-xs text-muted-foreground">{next.op === "APPROVE" ? "Awaiting management" : "Awaiting finance"}</span>;
  }
  if (next.needsRef && !open) {
    return (
      <Button size={size} variant={size === "sm" ? "default" : "outline"} onClick={() => setOpen(true)} data-testid={`settle-${line.kind}`}>
        {next.label}
      </Button>
    );
  }
  return (
    <ActionForm action={action} className="flex items-center justify-end gap-1" inlineError={false}>
      <input type="hidden" name="commissionId" value={line.id} />
      <input type="hidden" name="op" value={next.op} />
      {next.needsRef && <Input name="reference" placeholder={next.needsRef} className={inputClass} required autoFocus />}
      <SubmitButton size={size} variant={next.needsRef || size === "sm" ? "default" : "outline"} data-testid={next.needsRef ? `settle-${line.kind}-confirm` : `settle-${line.kind}`}>
        {next.needsRef ? "Save" : next.label}
      </SubmitButton>
    </ActionForm>
  );
}
