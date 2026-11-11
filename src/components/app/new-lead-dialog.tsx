"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Plus } from "lucide-react";
import type { ActionResult } from "@/lib/action";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { ActionForm, SubmitButton } from "./action-form";
import { selectClass } from "./styles";

const SOURCES = [
  ["WEBSITE", "Website"],
  ["META_ADS", "Meta ads"],
  ["GOOGLE_ADS", "Google ads"],
  ["WALK_IN", "Walk-in"],
  ["REFERRAL", "Referral"],
  ["DIRECT", "Direct / phone"],
] as const;


/**
 * Lead capture form. `sources` is omitted on the broker portal, where the source
 * is always the partner and attribution is assigned on the server.
 */
export function LeadFormFields({ projects, withSource = true }: { projects: { id: string; name: string }[]; withSource?: boolean }) {
  return (
    <div className="grid gap-3">
      <div className="grid gap-1.5">
        <Label htmlFor="projectId">Project</Label>
        <select id="projectId" name="projectId" className={selectClass} required defaultValue={projects.length === 1 ? projects[0].id : ""}>
          <option value="" disabled>
            Choose a project
          </option>
          {projects.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="grid gap-1.5">
          <Label htmlFor="name">Customer name</Label>
          <Input id="name" name="name" required autoComplete="off" />
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor="phone">Mobile</Label>
          <Input id="phone" name="phone" inputMode="tel" placeholder="98xxxxxxxx" required autoComplete="off" />
        </div>
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="grid gap-1.5">
          <Label htmlFor="configPref">Looking for</Label>
          <select id="configPref" name="configPref" className={selectClass} defaultValue="3BHK">
            <option value="2BHK">2 BHK</option>
            <option value="3BHK">3 BHK</option>
          </select>
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor="budgetMax">Budget up to (₹)</Label>
          <Input id="budgetMax" name="budgetMax" inputMode="numeric" placeholder="25000000" />
        </div>
      </div>
      {withSource && (
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="grid gap-1.5">
            <Label htmlFor="source">Source</Label>
            <select id="source" name="source" className={selectClass} defaultValue="WEBSITE">
              {SOURCES.map(([v, l]) => (
                <option key={v} value={v}>
                  {l}
                </option>
              ))}
            </select>
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="campaign">Campaign (optional)</Label>
            <Input id="campaign" name="campaign" />
          </div>
        </div>
      )}
      <div className="grid gap-1.5">
        <Label htmlFor="note">Note (optional)</Label>
        <Textarea id="note" name="note" rows={2} />
      </div>
    </div>
  );
}

export function NewLeadDialog({ action, projects }: { action: (form: FormData) => Promise<ActionResult>; projects: { id: string; name: string }[] }) {
  const [open, setOpen] = useState(false);
  const router = useRouter();
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button data-testid="new-lead">
          <Plus className="size-4" /> New lead
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Capture a lead</DialogTitle>
          <DialogDescription>Duplicates within the mandate&apos;s attribution window are blocked automatically.</DialogDescription>
        </DialogHeader>
        <ActionForm
          action={action}
          onSuccess={(r) => {
            setOpen(false);
            if (r.ok && r.id) router.push(`/leads/${r.id}`);
          }}
        >
          {(state) => (
            <>
              <LeadFormFields projects={projects} />
              {state && !state.ok && state.refId && (
                <Button variant="link" size="sm" className="mt-2 px-0" onClick={() => router.push(`/leads/${state.refId}`)} type="button">
                  Open the existing lead →
                </Button>
              )}
              <div className="mt-4 flex justify-end">
                <SubmitButton>Create lead</SubmitButton>
              </div>
            </>
          )}
        </ActionForm>
      </DialogContent>
    </Dialog>
  );
}
