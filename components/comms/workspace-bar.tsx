import Link from "next/link";
import { Settings, Users } from "lucide-react";
import { StatusPill } from "@/components/ui/status-pill";
import { Truncated } from "@/components/ui/truncated";
import { isAdminRole, memberStatusTone, type Workspace } from "@/lib/comms/workspace";
import { initials } from "./message-body";

/**
 * The workspace's identity at the top of the hub frame (0750): the company's
 * workspace name, a Paused pill while an owner has suspended it, the People
 * directory, and — for owners and admins only — the settings gear. One slim
 * row, so the views below keep their own headers unchanged.
 */
export function WorkspaceBar({ workspace: w }: { workspace: Workspace }) {
  const suspended = w.status === "suspended";
  return (
    <div className="flex items-center gap-2 border-b border-border bg-surface-muted/40 px-3 py-1.5">
      <span
        aria-hidden
        className="flex h-6 w-6 shrink-0 items-center justify-center rounded-control bg-primary text-[10px] font-semibold text-primary-foreground"
      >
        {initials(w.name)}
      </span>
      <div className="min-w-0 flex-1">
        <Truncated className="block text-sm font-semibold text-heading" text={w.name} />
        {w.description && <Truncated className="hidden text-xs text-muted-foreground @2xl/comms:block" text={w.description} />}
      </div>
      {suspended && <StatusPill tone={memberStatusTone("suspended")}>Paused</StatusPill>}
      <Link
        href="/comms/people"
        className="inline-flex items-center gap-1 rounded-control px-2 py-1 text-xs font-medium text-muted-foreground hover:bg-surface-muted hover:text-foreground"
      >
        <Users className="h-3.5 w-3.5" aria-hidden /> People
      </Link>
      {isAdminRole(w.my_role) && (
        <Link
          href="/comms/workspace"
          aria-label="Workspace settings"
          title="Workspace settings"
          className="rounded-control p-1.5 text-muted-foreground hover:bg-surface-muted hover:text-foreground"
        >
          <Settings className="h-4 w-4" aria-hidden />
        </Link>
      )}
    </div>
  );
}

/**
 * A deactivated person reaching the hub. The database already refuses them
 * every read and write (comm_can_read_at / comm_actor); this says why, instead
 * of an empty inbox that reads as "nobody wrote to you".
 */
export function WorkspaceDeactivated({ workspace: w }: { workspace: Workspace }) {
  return (
    <div className="mx-auto max-w-xl space-y-2 p-6" role="alert">
      <h1 className="text-lg font-semibold text-heading">{w.name}</h1>
      <div className="rounded-md border border-border bg-surface-muted p-4">
        <p className="text-sm font-semibold text-foreground">Your access to Messages has been deactivated.</p>
        <p className="mt-1 text-sm text-muted-foreground">
          A workspace owner or admin switched it off. Your messages are kept under your name. Ask them to reactivate you
          if you still need Messages.
        </p>
      </div>
    </div>
  );
}
