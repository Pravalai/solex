"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { formToObject, runAction, type ActionResult } from "@/lib/action";
import { requireActor } from "@/modules/identity/session";
import { approveBooking, rejectBooking } from "@/modules/sales/bookings";

export async function developerApproveAction(form: FormData): Promise<ActionResult> {
  return runAction(async () => {
    const actor = await requireActor({ roles: ["DEVELOPER"] });
    const { bookingId } = z.object({ bookingId: z.string().min(1) }).parse(formToObject(form));
    await approveBooking(actor, bookingId);
    revalidatePath("/", "layout");
    return "Approved. The booking is confirmed and soleX has been notified.";
  });
}

export async function developerRejectAction(form: FormData): Promise<ActionResult> {
  return runAction(async () => {
    const actor = await requireActor({ roles: ["DEVELOPER"] });
    const input = z.object({ bookingId: z.string().min(1), reason: z.string({ error: "Give a reason." }).min(3, "Give a reason.") }).parse(formToObject(form));
    await rejectBooking(actor, input.bookingId, input.reason);
    revalidatePath("/", "layout");
    return "Rejected. The unit has been released.";
  });
}
