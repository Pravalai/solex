"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import type { ActionResult } from "@/lib/action";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { ActionForm, SubmitButton } from "./action-form";

/** Live hold countdown (holds lapse automatically; the server treats expired holds as available). */
export function Countdown({ until, className }: { until: string; className?: string }) {
  const [left, setLeft] = useState<number | null>(null);
  useEffect(() => {
    const tick = () => setLeft(Math.max(0, new Date(until).getTime() - Date.now()));
    tick();
    const t = setInterval(tick, 1000);
    return () => clearInterval(t);
  }, [until]);
  if (left === null) return null;
  const m = Math.floor(left / 60_000);
  const s = Math.floor((left % 60_000) / 1000);
  return <span className={className}>{left === 0 ? "expired" : `${m}:${String(s).padStart(2, "0")} left`}</span>;
}

/** A button that asks for confirmation (and optionally a reason) before running a server action. */
export function ConfirmAction({
  action,
  fields,
  label,
  title,
  description,
  confirmLabel = "Confirm",
  reason,
  variant = "default",
  size = "sm",
  testId,
}: {
  action: (form: FormData) => Promise<ActionResult>;
  fields: Record<string, string>;
  label: React.ReactNode;
  title: string;
  description?: React.ReactNode;
  confirmLabel?: string;
  reason?: { label: string; placeholder?: string };
  variant?: React.ComponentProps<typeof Button>["variant"];
  size?: React.ComponentProps<typeof Button>["size"];
  testId?: string;
}) {
  const [open, setOpen] = useState(false);
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant={variant} size={size} data-testid={testId}>
          {label}
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          {description && <DialogDescription asChild><div>{description}</div></DialogDescription>}
        </DialogHeader>
        <ActionForm action={action} onSuccess={() => setOpen(false)} className="grid gap-3">
          {Object.entries(fields).map(([k, v]) => (
            <input key={k} type="hidden" name={k} value={v} />
          ))}
          {reason && (
            <div className="grid gap-1.5">
              <Label htmlFor="reason">{reason.label}</Label>
              <Textarea id="reason" name="reason" placeholder={reason.placeholder} required />
            </div>
          )}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setOpen(false)}>
              Back
            </Button>
            <SubmitButton variant={variant === "destructive" ? "destructive" : "default"} data-testid={testId ? `${testId}-confirm` : undefined}>
              {confirmLabel}
            </SubmitButton>
          </DialogFooter>
        </ActionForm>
      </DialogContent>
    </Dialog>
  );
}

/** Drawer driven by the URL (?unit=…), so a selected unit is shareable and survives refresh. */
export function UrlSheet({ closeHref, title, description, children }: { closeHref: string; title: React.ReactNode; description?: React.ReactNode; children: React.ReactNode }) {
  const router = useRouter();
  return (
    <Sheet open onOpenChange={(open) => !open && router.push(closeHref, { scroll: false })}>
      <SheetContent className="w-full gap-0 overflow-y-auto sm:max-w-md">
        <SheetHeader className="border-b">
          <SheetTitle>{title}</SheetTitle>
          {description && <SheetDescription asChild><div>{description}</div></SheetDescription>}
        </SheetHeader>
        <div className="space-y-5 p-4">{children}</div>
      </SheetContent>
    </Sheet>
  );
}
