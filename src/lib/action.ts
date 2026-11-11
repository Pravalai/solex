import { unstable_rethrow } from "next/navigation";
import { ZodError } from "zod";
import { DomainError } from "./errors";

export type ActionResult =
  | { ok: true; message?: string; id?: string }
  | { ok: false; error: string; code?: string; refId?: string | null };

/**
 * Wraps a server action body: domain errors become user-facing messages,
 * Next.js redirects pass through, and anything unexpected is logged and hidden.
 */
export async function runAction(fn: () => Promise<ActionResult | string | void>): Promise<ActionResult> {
  try {
    const result = await fn();
    if (typeof result === "string") return { ok: true, message: result };
    return result ?? { ok: true };
  } catch (err) {
    unstable_rethrow(err);
    if (err instanceof ZodError) {
      return { ok: false, error: err.issues[0]?.message ?? "Please check the form.", code: "VALIDATION" };
    }
    if (err instanceof DomainError) {
      const refId = (err as DomainError & { existingLeadId?: string | null }).existingLeadId ?? null;
      return { ok: false, error: err.message, code: err.code, refId };
    }
    console.error(err);
    return { ok: false, error: "Something went wrong. Please try again." };
  }
}

/** Reads FormData into a plain object for Zod parsing (empty strings become undefined). */
export function formToObject(form: FormData): Record<string, string | undefined> {
  const out: Record<string, string | undefined> = {};
  for (const [key, value] of form.entries()) {
    if (typeof value === "string") out[key] = value.trim() === "" ? undefined : value.trim();
  }
  return out;
}
