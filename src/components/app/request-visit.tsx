"use client";

import { useState } from "react";
import { CalendarPlus } from "lucide-react";
import { toLocalInput } from "@/lib/format";
import { requestVisitAction } from "@/app/broker/actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ActionForm, SubmitButton } from "./action-form";

function nextSaturday11() {
  const d = new Date();
  d.setDate(d.getDate() + ((6 - d.getDay() + 7) % 7 || 7));
  d.setHours(11, 0, 0, 0);
  return d;
}

/** Partner asks soleX to arrange a site visit; the sales exec confirms the slot. */
export function RequestVisitButton({ leadId, size = "sm" }: { leadId: string; size?: "sm" | "xs" }) {
  const [open, setOpen] = useState(false);
  if (!open) {
    return (
      <Button size={size} variant="outline" onClick={() => setOpen(true)} data-testid="request-visit">
        <CalendarPlus className="size-3.5" /> Request site visit
      </Button>
    );
  }
  return (
    <ActionForm action={requestVisitAction} onSuccess={() => setOpen(false)} className="flex flex-wrap items-center gap-2">
      <input type="hidden" name="leadId" value={leadId} />
      <Input name="preferredAt" type="datetime-local" defaultValue={toLocalInput(nextSaturday11())} required className="h-8 w-auto" aria-label="Preferred date and time" />
      <SubmitButton size="sm" data-testid="request-visit-send">
        Send request
      </SubmitButton>
      <Button type="button" size="sm" variant="ghost" onClick={() => setOpen(false)}>
        Cancel
      </Button>
    </ActionForm>
  );
}
