"use client";

import { useActionState, useEffect, useEffectEvent, useRef } from "react";
import { useFormStatus } from "react-dom";
import { toast } from "sonner";
import { Loader2 } from "lucide-react";
import type { ActionResult } from "@/lib/action";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

type Props = {
  action: (form: FormData) => Promise<ActionResult>;
  children: React.ReactNode | ((state: ActionResult | null) => React.ReactNode);
  className?: string;
  onSuccess?: (result: ActionResult) => void;
  resetOnSuccess?: boolean;
  /** Show the error inline under the form as well as in a toast. */
  inlineError?: boolean;
};

/** Binds a server action to a form: pending state, toast feedback, inline error. */
export function ActionForm({ action, children, className, onSuccess, resetOnSuccess, inlineError = true }: Props) {
  const formRef = useRef<HTMLFormElement>(null);
  // Feedback is given as soon as the server answers: the refreshed page may no longer render this form.
  const [state, formAction] = useActionState<ActionResult | null, FormData>(async (_prev, form) => {
    const result = await action(form);
    if (result.ok) {
      if (result.message) toast.success(result.message);
    } else {
      toast.error(result.error);
    }
    return result;
  }, null);
  const handleResult = useEffectEvent((result: ActionResult) => {
    if (!result.ok) return;
    if (resetOnSuccess) formRef.current?.reset();
    onSuccess?.(result);
  });

  useEffect(() => {
    if (state) handleResult(state);
  }, [state]);

  return (
    <form ref={formRef} action={formAction} className={className}>
      {typeof children === "function" ? children(state) : children}
      {inlineError && state && !state.ok && (
        <p role="alert" className="mt-2 rounded-md bg-destructive/10 px-3 py-2 text-xs text-destructive" data-testid="form-error">
          {state.error}
        </p>
      )}
    </form>
  );
}

export function SubmitButton({
  children,
  className,
  variant,
  size,
  disabled,
  ...rest
}: React.ComponentProps<typeof Button>) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" className={cn(className)} variant={variant} size={size} disabled={pending || disabled} {...rest}>
      {pending && <Loader2 className="size-4 animate-spin" />}
      {children}
    </Button>
  );
}
