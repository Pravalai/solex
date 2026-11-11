"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { ShieldCheck } from "lucide-react";
import { formatBps, formatINR, toBps } from "@/lib/money";
import { cn } from "@/lib/utils";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import type { ActionResult } from "@/lib/action";
import { ActionForm, SubmitButton } from "./action-form";

type LeadOption = { id: string; code: string; name: string; brokerName: string | null };

/**
 * Book-for-lead form with a live quote. The approval routing shown here is a
 * preview only; the server recomputes it from the mandate and enforces it.
 */
export function BookingForm({
  action,
  unit,
  leads,
  bands,
  defaultLeadId,
}: {
  action: (form: FormData) => Promise<ActionResult>;
  unit: { id: string; unitNo: string; listPrice: number; version: number };
  leads: LeadOption[];
  bands: { execMaxDiscountBps: number; mgmtMaxDiscountBps: number };
  defaultLeadId?: string;
}) {
  const router = useRouter();
  const [leadId, setLeadId] = useState(defaultLeadId && leads.some((l) => l.id === defaultLeadId) ? defaultLeadId : "");
  const [discount, setDiscount] = useState("");
  const amount = Math.max(0, Math.round(Number(discount) || 0));
  const bps = toBps(amount, unit.listPrice);
  const level = bps <= bands.execMaxDiscountBps ? "NONE" : bps <= bands.mgmtMaxDiscountBps ? "MANAGEMENT" : "DEVELOPER";
  const lead = leads.find((l) => l.id === leadId);

  if (leads.length === 0) {
    return (
      <p className="rounded-lg border border-dashed p-3 text-xs text-muted-foreground">
        No lead of yours on this project is ready to book. A lead must be qualified, visited or in negotiation first.
      </p>
    );
  }

  return (
    <ActionForm
      // Navigate as soon as the server answers: the refreshed page no longer renders this form.
      action={async (form) => {
        const result = await action(form);
        if (result.ok && result.id) router.push(`/bookings/${result.id}`);
        return result;
      }}
      className="grid gap-3"
    >
      <input type="hidden" name="unitId" value={unit.id} />
      <input type="hidden" name="version" value={unit.version} />
      <input type="hidden" name="leadId" value={leadId} />
      <div className="grid gap-1.5">
        <Label>Booking for</Label>
        <Select value={leadId} onValueChange={setLeadId}>
          <SelectTrigger className="w-full" data-testid="booking-lead">
            <SelectValue placeholder="Choose a lead" />
          </SelectTrigger>
          <SelectContent>
            {leads.map((l) => (
              <SelectItem key={l.id} value={l.id}>
                {l.name} · {l.code}
                {l.brokerName ? ` · via ${l.brokerName}` : ""}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <div className="grid gap-1.5">
        <Label htmlFor="discountAmount">Discount (₹)</Label>
        <Input
          id="discountAmount"
          name="discountAmount"
          inputMode="numeric"
          placeholder="0"
          value={discount}
          onChange={(e) => setDiscount(e.target.value.replace(/[^\d]/g, ""))}
          data-testid="booking-discount"
        />
      </div>
      <div className="rounded-lg border bg-muted/40 p-3 text-sm">
        <div className="flex justify-between">
          <span className="text-muted-foreground">List price</span>
          <span className="tabular" data-testid="list-price">{formatINR(unit.listPrice)}</span>
        </div>
        <div className="flex justify-between">
          <span className="text-muted-foreground">Discount</span>
          <span className="tabular">
            −{formatINR(amount)} ({formatBps(bps)})
          </span>
        </div>
        <div className="mt-1 flex justify-between border-t pt-1 font-semibold">
          <span>Agreement value</span>
          <span className="tabular">{formatINR(unit.listPrice - amount)}</span>
        </div>
        <div
          className={cn(
            "mt-2 flex items-start gap-1.5 rounded-md px-2 py-1.5 text-xs",
            level === "NONE" ? "bg-status-available/12 text-[oklch(0.38_0.1_155)]" : "bg-status-hold/18 text-[oklch(0.45_0.1_65)]",
          )}
          data-testid="approval-preview"
        >
          <ShieldCheck className="mt-0.5 size-3.5 shrink-0" />
          {level === "NONE" && <span>Within your authority ({formatBps(bands.execMaxDiscountBps)}). Confirms immediately.</span>}
          {level === "MANAGEMENT" && <span>Above {formatBps(bands.execMaxDiscountBps)}: needs soleX management approval. The unit stays locked until then.</span>}
          {level === "DEVELOPER" && (
            <span>Above the mandate band of {formatBps(bands.mgmtMaxDiscountBps)}: needs soleX management and then developer approval.</span>
          )}
        </div>
      </div>
      <SubmitButton disabled={!lead} data-testid="booking-submit">
        Book {unit.unitNo}
        {lead ? ` for ${lead.name.split(" ")[0]}` : ""}
      </SubmitButton>
    </ActionForm>
  );
}
