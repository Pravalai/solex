import type { Metadata } from "next";
import { Building2, Handshake, Landmark, LineChart, UserRound } from "lucide-react";
import { db } from "@/lib/db";
import type { Role } from "@/generated/prisma/enums";
import { ROLE_LABEL } from "@/modules/identity/roles";
import { Wordmark } from "@/components/app/brand";
import { ActionForm, SubmitButton } from "@/components/app/action-form";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { loginAction } from "../auth-actions";

export const metadata: Metadata = { title: "Sign in" };
export const dynamic = "force-dynamic";

const ROLE_ICON: Record<Role, typeof Building2> = {
  MANAGEMENT: LineChart,
  SALES: UserRound,
  FINANCE: Landmark,
  BROKER: Handshake,
  DEVELOPER: Building2,
};

const ROLE_STORY: Record<Role, string> = {
  MANAGEMENT: "Command centre across all mandates, approvals, cancellations",
  SALES: "Own leads, site visits, holds and bookings on allocated projects",
  FINANCE: "Collections, receipts and commission settlement",
  BROKER: "Partner portal: own leads, approved inventory, brokerage",
  DEVELOPER: "Developer portal: own projects, sales, collections, approvals",
};

export default async function LoginPage({ searchParams }: PageProps<"/login">) {
  const { next } = await searchParams;
  const users = await db.user.findMany({
    where: { active: true },
    orderBy: [{ role: "asc" }, { name: "asc" }],
    select: { email: true, name: true, title: true, role: true },
  });
  const order: Role[] = ["MANAGEMENT", "SALES", "FINANCE", "BROKER", "DEVELOPER"];
  const grouped = order.map((role) => ({ role, users: users.filter((u) => u.role === role) })).filter((g) => g.users.length > 0);

  return (
    <div className="grid min-h-screen lg:grid-cols-[minmax(380px,460px)_1fr]">
      <aside className="relative hidden flex-col justify-between overflow-hidden bg-sidebar p-10 text-sidebar-foreground lg:flex">
        <div>
          <Wordmark inverted className="text-3xl" />
          <p className="mt-1 text-xs uppercase tracking-[0.2em] text-sidebar-primary">Mandate Sales OS</p>
        </div>
        <div className="space-y-6">
          <p className="text-2xl font-medium leading-snug text-white">
            One operating system for every mandate: inventory, sales, partners, collections and commissions, connected.
          </p>
          <ul className="space-y-2 text-sm text-sidebar-foreground/80">
            <li>· A lead registered by a partner flows to booking, inventory, collections and commission without re-entry</li>
            <li>· Every stakeholder sees only what their role and mandate allow</li>
            <li>· Double bookings and inconsistent ledgers are prevented at the database level</li>
          </ul>
        </div>
        <p className="text-xs text-sidebar-foreground/60">Round 2 evaluation demo · fictional data</p>
      </aside>

      <main className="flex flex-col justify-center px-4 py-10 sm:px-10">
        <div className="mx-auto w-full max-w-3xl">
          <div className="mb-8 lg:hidden">
            <Wordmark className="text-3xl" />
          </div>
          <h1 className="text-2xl font-semibold tracking-tight">Sign in</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Pick a demo persona to explore each stakeholder&apos;s view. All demo accounts use the password <code className="rounded bg-muted px-1">demo1234</code>.
          </p>

          <div className="mt-6 grid gap-4 md:grid-cols-2">
            {grouped.map(({ role, users }) => {
              const Icon = ROLE_ICON[role];
              return (
                <div key={role} className="rounded-xl border bg-card p-4 shadow-xs">
                  <div className="flex items-center gap-2 text-sm font-semibold">
                    <Icon className="size-4 text-gold" />
                    {ROLE_LABEL[role]}
                  </div>
                  <p className="mt-0.5 text-xs text-muted-foreground">{ROLE_STORY[role]}</p>
                  <div className="mt-3 space-y-1.5">
                    {users.map((u) => (
                      <ActionForm key={u.email} action={loginAction} inlineError={false}>
                        <input type="hidden" name="email" value={u.email} />
                        <input type="hidden" name="password" value="demo1234" />
                        {next && <input type="hidden" name="next" value={next} />}
                        <SubmitButton variant="outline" className="h-auto w-full justify-start py-2 text-left" data-testid={`persona-${u.email}`}>
                          <span className="flex flex-col">
                            <span className="text-sm font-medium">{u.name}</span>
                            <span className="text-xs font-normal text-muted-foreground">{u.title}</span>
                          </span>
                        </SubmitButton>
                      </ActionForm>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>

          <details className="mt-6 rounded-xl border bg-card p-4">
            <summary className="cursor-pointer text-sm font-medium">Sign in with email and password</summary>
            <ActionForm action={loginAction} className="mt-4 grid gap-3 sm:max-w-sm">
              {next && <input type="hidden" name="next" value={next} />}
              <div className="grid gap-1.5">
                <Label htmlFor="email">Email</Label>
                <Input id="email" name="email" type="email" autoComplete="username" required />
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor="password">Password</Label>
                <Input id="password" name="password" type="password" autoComplete="current-password" required />
              </div>
              <SubmitButton>Sign in</SubmitButton>
            </ActionForm>
          </details>
        </div>
      </main>
    </div>
  );
}
