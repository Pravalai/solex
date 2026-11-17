"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { formToObject, runAction, type ActionResult } from "@/lib/action";
import { requireActor } from "@/modules/identity/session";
import { createLead, requestVisit } from "@/modules/crm/leads";

/** Partner lead registration. Source and attribution are set on the server, never taken from the form. */
export async function registerLeadAction(form: FormData): Promise<ActionResult> {
  return runAction(async () => {
    const actor = await requireActor({ roles: ["BROKER"] });
    const input = z
      .object({
        projectId: z.string({ error: "Choose a project." }).min(1),
        name: z.string({ error: "Enter the customer's name." }),
        phone: z.string({ error: "Enter a mobile number." }),
        email: z.email("Enter a valid email.").optional(),
        configPref: z.string().optional(),
        budgetMax: z.coerce.number().int().min(0).optional(),
        note: z.string().optional(),
      })
      .parse(formToObject(form));
    const lead = await createLead(actor, input);
    revalidatePath("/broker", "layout");
    return { ok: true, id: lead.id, message: `${lead.name} registered and protected. soleX will call them within 24 hours.` };
  });
}

/** A partner asks soleX to arrange a site visit for one of their own customers. */
export async function requestVisitAction(form: FormData): Promise<ActionResult> {
  return runAction(async () => {
    const actor = await requireActor({ roles: ["BROKER"] });
    const input = z
      .object({
        leadId: z.string().min(1),
        preferredAt: z.string({ error: "Pick a preferred date and time." }).transform((v) => new Date(v)),
        note: z.string().optional(),
      })
      .parse(formToObject(form));
    await requestVisit(actor, input.leadId, { preferredAt: input.preferredAt, note: input.note });
    revalidatePath("/broker", "layout");
    return "Visit requested. soleX will confirm the slot with you.";
  });
}
