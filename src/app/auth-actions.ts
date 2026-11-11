"use server";

import { redirect } from "next/navigation";
import { z } from "zod";
import { homePathFor } from "@/modules/identity/roles";
import { signIn, signOut } from "@/modules/identity/session";
import { formToObject, runAction, type ActionResult } from "@/lib/action";

const LoginSchema = z.object({
  email: z.email("Enter your email address."),
  password: z.string("Enter your password.").min(1, "Enter your password."),
  next: z.string().optional(),
});

export async function loginAction(form: FormData): Promise<ActionResult> {
  let destination = "/";
  const result = await runAction(async () => {
    const input = LoginSchema.parse(formToObject(form));
    const actor = await signIn(input.email, input.password);
    if (!actor) return { ok: false, error: "Email or password is incorrect." };
    // Only follow same-site relative paths (no open redirects).
    destination = input.next && input.next.startsWith("/") && !input.next.startsWith("//") ? input.next : homePathFor(actor.role);
  });
  if (result.ok) redirect(destination);
  return result;
}

export async function logoutAction(): Promise<void> {
  await signOut();
  redirect("/login");
}
