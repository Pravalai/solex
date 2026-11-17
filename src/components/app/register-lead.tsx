"use client";

import { ShieldCheck } from "lucide-react";
import type { ActionResult } from "@/lib/action";
import { ActionForm, SubmitButton } from "./action-form";
import { LeadFormFields } from "./new-lead-dialog";

/** Partner lead registration card (broker portal). */
export function RegisterLeadForm({ action, projects }: { action: (form: FormData) => Promise<ActionResult>; projects: { id: string; name: string }[] }) {
  return (
    <ActionForm action={action} resetOnSuccess className="grid gap-3">
      <LeadFormFields projects={projects} withSource={false} />
      <p className="flex items-start gap-1.5 text-xs text-muted-foreground">
        <ShieldCheck className="mt-0.5 size-3.5 shrink-0 text-gold" />
        First to register owns the customer for the protection window. Duplicates are refused without saying who holds them.
      </p>
      <SubmitButton className="h-10 w-full sm:w-auto" data-testid="register-lead">
        Register customer
      </SubmitButton>
    </ActionForm>
  );
}
