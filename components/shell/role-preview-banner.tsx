"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { AlertCircle, Loader2 } from "lucide-react";
import { useAppUser } from "@/lib/auth/permission-context";
import { setRolePreview } from "@/lib/auth/role-simulation-actions";

/**
 * Sits in normal document flow (not `fixed inset-0`), so it needs no
 * `useModalGuard` — see AGENTS.md's Auto-reload guard: that guard only has to
 * find `role="dialog"` / `aria-modal`, and a banner is neither.
 */
export function RolePreviewBanner() {
  const user = useAppUser();
  const router = useRouter();
  const [exiting, startExit] = useTransition();

  if (user.simulatedRoleIds.length === 0) return null;

  function onExit() {
    startExit(async () => {
      const result = await setRolePreview([]);
      if (result.ok) router.refresh();
    });
  }

  // Every previewed role, named in one line — this is the "elsewhere" the
  // Topbar's `<MultiSelect hideChips>` points to instead of a chip row it has
  // no width for. `permissions` on `AppUser` is already the UNION of all of
  // these (see `getRolesPreview`), so what's said here is exactly what's
  // enforced, not a summary of it.
  const roleList = user.roleNames.join(", ");

  return (
    <div className="flex items-center justify-between gap-4 border-b border-warning/30 bg-warning/10 px-4 py-1.5 text-xs text-warning">
      <span className="flex items-center gap-1.5">
        <AlertCircle className="h-3.5 w-3.5 shrink-0" />
        Previewing as <strong>{roleList}</strong> — pages and actions none of
        these roles can use are hidden or blocked, exactly as they would be
        for an operator holding only them.
      </span>
      <button
        type="button"
        onClick={onExit}
        disabled={exiting}
        className="flex shrink-0 items-center gap-1 font-medium underline underline-offset-2 disabled:opacity-60"
      >
        {exiting && <Loader2 className="h-3 w-3 animate-spin" />}
        Exit preview
      </button>
    </div>
  );
}
