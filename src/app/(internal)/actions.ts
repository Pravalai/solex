"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { formToObject, runAction, runDataAction, type ActionResult, type DataResult } from "@/lib/action";
import { endCall, startCall } from "@/modules/calls/calls";
import type { CallOutcome, CallSession } from "@/modules/calls/types";
import { requireActor } from "@/modules/identity/session";
import { INTERNAL_ROLES } from "@/modules/identity/roles";
import { holdUnit, releaseHold } from "@/modules/inventory/units";
import {
  ACTIVITY_TYPES,
  MANUAL_STAGES,
  changeLeadStage,
  completeVisit,
  confirmVisit,
  createLead,
  logActivity,
  markNoShow,
  reassignLead,
  scheduleVisit,
  sendLeadMessage,
} from "@/modules/crm/leads";
import { approveBooking, cancelBooking, createBooking, rejectBooking } from "@/modules/sales/bookings";
import { PAYMENT_MODES, recordPayment, sendPaymentReminder } from "@/modules/finance/payments";
import { settleCommission } from "@/modules/finance/commissions";

const id = z.string().min(1);
const rupees = z.coerce.number({ error: "Enter an amount in rupees." }).int("Use whole rupees.").min(0);
const optionalDate = z
  .string()
  .optional()
  .transform((v) => (v ? new Date(v) : undefined))
  .refine((d) => d === undefined || !Number.isNaN(d.getTime()), "Enter a valid date.");

async function internalActor() {
  return requireActor({ roles: INTERNAL_ROLES });
}

function refresh() {
  revalidatePath("/", "layout");
}

// ---------------------------------------------------------------- inventory
export async function holdUnitAction(form: FormData): Promise<ActionResult> {
  return runAction(async () => {
    const actor = await internalActor();
    const input = z.object({ unitId: id, version: z.coerce.number().int() }).parse(formToObject(form));
    const unit = await holdUnit(actor, input.unitId, input.version);
    refresh();
    return `${unit.unitNo} is on hold for you.`;
  });
}

export async function releaseHoldAction(form: FormData): Promise<ActionResult> {
  return runAction(async () => {
    const actor = await internalActor();
    const input = z.object({ unitId: id }).parse(formToObject(form));
    const unit = await releaseHold(actor, input.unitId);
    refresh();
    return `${unit.unitNo} released.`;
  });
}

// ------------------------------------------------------------------ booking
export async function createBookingAction(form: FormData): Promise<ActionResult> {
  return runAction(async () => {
    const actor = await internalActor();
    const input = z
      .object({ unitId: id, leadId: z.string({ error: "Choose the lead you are booking for." }).min(1, "Choose the lead you are booking for."), discountAmount: rupees.default(0), version: z.coerce.number().int() })
      .parse(formToObject(form));
    const booking = await createBooking(actor, {
      unitId: input.unitId,
      leadId: input.leadId,
      discountAmount: input.discountAmount,
      expectedVersion: input.version,
    });
    refresh();
    return {
      ok: true,
      id: booking.id,
      message:
        booking.status === "CONFIRMED"
          ? `Booking ${booking.code} confirmed. Payment schedule and commissions created.`
          : `Booking ${booking.code} created and sent for discount approval. The unit is locked meanwhile.`,
    };
  });
}

export async function approveBookingAction(form: FormData): Promise<ActionResult> {
  return runAction(async () => {
    const actor = await internalActor();
    const { bookingId } = z.object({ bookingId: id }).parse(formToObject(form));
    await approveBooking(actor, bookingId);
    refresh();
    return "Discount approved.";
  });
}

export async function rejectBookingAction(form: FormData): Promise<ActionResult> {
  return runAction(async () => {
    const actor = await internalActor();
    const input = z.object({ bookingId: id, reason: z.string({ error: "Give a reason." }).min(3, "Give a reason.") }).parse(formToObject(form));
    await rejectBooking(actor, input.bookingId, input.reason);
    refresh();
    return "Discount rejected and unit released.";
  });
}

export async function cancelBookingAction(form: FormData): Promise<ActionResult> {
  return runAction(async () => {
    const actor = await internalActor();
    const input = z.object({ bookingId: id, reason: z.string({ error: "Give a reason." }).min(3, "Give a reason.") }).parse(formToObject(form));
    await cancelBooking(actor, input.bookingId, input.reason);
    refresh();
    return "Booking cancelled. Inventory released and commissions reversed.";
  });
}

// --------------------------------------------------------------------- CRM
export async function createLeadAction(form: FormData): Promise<ActionResult> {
  return runAction(async () => {
    const actor = await internalActor();
    const input = z
      .object({
        projectId: z.string({ error: "Choose a project." }).min(1),
        name: z.string({ error: "Enter the customer's name." }),
        phone: z.string({ error: "Enter a mobile number." }),
        email: z.email("Enter a valid email.").optional(),
        source: z.enum(["DIRECT", "WEBSITE", "META_ADS", "GOOGLE_ADS", "WALK_IN", "REFERRAL"]),
        configPref: z.string().optional(),
        budgetMax: rupees.optional(),
        campaign: z.string().optional(),
        note: z.string().optional(),
      })
      .parse(formToObject(form));
    const lead = await createLead(actor, input);
    refresh();
    return { ok: true, id: lead.id, message: `Lead ${lead.code} created.` };
  });
}

export async function logActivityAction(form: FormData): Promise<ActionResult> {
  return runAction(async () => {
    const actor = await internalActor();
    const input = z
      .object({ leadId: id, type: z.enum(ACTIVITY_TYPES), note: z.string({ error: "Add a note." }), nextFollowUpAt: optionalDate })
      .parse(formToObject(form));
    await logActivity(actor, input.leadId, { type: input.type, note: input.note, nextFollowUpAt: input.nextFollowUpAt });
    refresh();
    return "Activity logged.";
  });
}

export async function changeStageAction(form: FormData): Promise<ActionResult> {
  return runAction(async () => {
    const actor = await internalActor();
    const input = z
      .object({ leadId: id, stage: z.enum(MANUAL_STAGES as [string, ...string[]]), reason: z.string().optional() })
      .parse(formToObject(form));
    await changeLeadStage(actor, input.leadId, input.stage as (typeof MANUAL_STAGES)[number], input.reason);
    refresh();
    return "Stage updated.";
  });
}

export async function sendLeadMessageAction(form: FormData): Promise<ActionResult> {
  return runAction(async () => {
    const actor = await internalActor();
    const input = z.object({ leadId: id, body: z.string({ error: "Write the message before sending it." }) }).parse(formToObject(form));
    await sendLeadMessage(actor, input.leadId, { body: input.body });
    refresh();
    return "WhatsApp sent (simulated) and logged on the timeline.";
  });
}

export async function reassignLeadAction(form: FormData): Promise<ActionResult> {
  return runAction(async () => {
    const actor = await internalActor();
    const input = z.object({ leadId: id, userId: id }).parse(formToObject(form));
    await reassignLead(actor, input.leadId, input.userId);
    refresh();
    return "Lead reassigned.";
  });
}

// ------------------------------------------------------- calls (simulated)
export async function startCallAction(leadId: string): Promise<DataResult<CallSession>> {
  return runDataAction(async () => {
    const actor = await internalActor();
    return startCall(actor, id.parse(leadId));
  });
}

export async function endCallAction(input: { callId: string; talkSec: number | null }): Promise<DataResult<CallOutcome>> {
  return runDataAction(async () => {
    const actor = await internalActor();
    const parsed = z.object({ callId: id, talkSec: z.number().min(0).max(3600).nullable() }).parse(input);
    const outcome = await endCall(actor, parsed.callId, { talkSec: parsed.talkSec });
    refresh();
    return outcome;
  });
}

export async function scheduleVisitAction(form: FormData): Promise<ActionResult> {
  return runAction(async () => {
    const actor = await internalActor();
    const input = z
      .object({ leadId: id, scheduledAt: z.string({ error: "Pick a date and time." }).transform((v) => new Date(v)), note: z.string().optional() })
      .parse(formToObject(form));
    await scheduleVisit(actor, input.leadId, { scheduledAt: input.scheduledAt, note: input.note });
    refresh();
    return "Site visit scheduled. Confirmation sent to the customer (simulated WhatsApp).";
  });
}

export async function confirmVisitAction(form: FormData): Promise<ActionResult> {
  return runAction(async () => {
    const actor = await internalActor();
    const input = z
      .object({ visitId: id, scheduledAt: z.string({ error: "Pick a date and time." }).transform((v) => new Date(v)) })
      .parse(formToObject(form));
    await confirmVisit(actor, input.visitId, { scheduledAt: input.scheduledAt });
    refresh();
    return "Visit confirmed. Customer and partner notified (simulated WhatsApp).";
  });
}

export async function completeVisitAction(form: FormData): Promise<ActionResult> {
  return runAction(async () => {
    const actor = await internalActor();
    const input = z
      .object({ visitId: id, feedback: z.string({ error: "Record the customer's feedback." }), rating: z.coerce.number().int().min(1).max(5), nextFollowUpAt: optionalDate })
      .parse(formToObject(form));
    await completeVisit(actor, input.visitId, input);
    refresh();
    return "Visit marked completed.";
  });
}

export async function noShowAction(form: FormData): Promise<ActionResult> {
  return runAction(async () => {
    const actor = await internalActor();
    const { visitId } = z.object({ visitId: id }).parse(formToObject(form));
    await markNoShow(actor, visitId);
    refresh();
    return "Marked as no-show.";
  });
}

// ----------------------------------------------------------------- finance
export async function recordPaymentAction(form: FormData): Promise<ActionResult> {
  return runAction(async () => {
    const actor = await internalActor();
    const input = z
      .object({
        bookingId: id,
        amount: z.coerce.number({ error: "Enter the amount received." }).int("Use whole rupees.").positive("Enter the amount received."),
        mode: z.enum(PAYMENT_MODES),
        reference: z.string({ error: "Enter the bank / UTR reference." }),
        receivedAt: optionalDate,
      })
      .parse(formToObject(form));
    await recordPayment(actor, input);
    refresh();
    return "Payment recorded and allocated to instalments.";
  });
}

export async function sendPaymentReminderAction(form: FormData): Promise<ActionResult> {
  return runAction(async () => {
    const actor = await internalActor();
    const { installmentId } = z.object({ installmentId: id }).parse(formToObject(form));
    await sendPaymentReminder(actor, installmentId);
    refresh();
    return "Reminder sent to the customer (simulated WhatsApp).";
  });
}

export async function settleCommissionAction(form: FormData): Promise<ActionResult> {
  return runAction(async () => {
    const actor = await internalActor();
    const input = z
      .object({ commissionId: id, op: z.enum(["INVOICE", "RECEIVE", "APPROVE", "PAY"]), reference: z.string().optional() })
      .parse(formToObject(form));
    await settleCommission(actor, input.commissionId, input.op, input.reference);
    refresh();
    return { INVOICE: "Invoice raised.", RECEIVE: "Receipt recorded.", APPROVE: "Payout approved.", PAY: "Payout marked paid." }[input.op];
  });
}
