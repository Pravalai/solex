import { LogOut } from "lucide-react";
import type { Actor } from "@/modules/identity/actor";
import { ROLE_LABEL } from "@/modules/identity/roles";
import { logoutAction } from "@/app/auth-actions";
import { cn } from "@/lib/utils";

export function UserBlock({ actor, inverted = false }: { actor: Actor; inverted?: boolean }) {
  const initials = actor.name
    .split(" ")
    .map((p) => p[0])
    .join("")
    .slice(0, 2);
  return (
    <div className="flex items-center gap-2.5">
      <div
        className={cn(
          "grid size-8 shrink-0 place-items-center rounded-full text-xs font-semibold",
          inverted ? "bg-sidebar-primary text-sidebar-primary-foreground" : "bg-primary text-primary-foreground",
        )}
      >
        {initials}
      </div>
      <div className="min-w-0 flex-1 leading-tight">
        <div className={cn("truncate text-sm font-medium", inverted && "text-white")} data-testid="current-user">
          {actor.name}
        </div>
        <div className={cn("truncate text-xs", inverted ? "text-sidebar-foreground/70" : "text-muted-foreground")}>
          {ROLE_LABEL[actor.role]}
        </div>
      </div>
      <form action={logoutAction}>
        <button
          type="submit"
          className={cn("rounded-md p-1.5", inverted ? "text-sidebar-foreground/70 hover:bg-sidebar-accent hover:text-white" : "text-muted-foreground hover:bg-muted")}
          title="Sign out"
          aria-label="Sign out"
        >
          <LogOut className="size-4" />
        </button>
      </form>
    </div>
  );
}
