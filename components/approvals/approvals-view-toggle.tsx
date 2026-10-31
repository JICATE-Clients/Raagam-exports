"use client";

import { usePathname, useRouter } from "next/navigation";
import { ToggleGroup } from "@/components/ui/segmented";

export type ApprovalsView = "mine" | "all";

/**
 * "Mine | All open" — Super Admin only (the page renders it for nobody else).
 *
 * Driven by `?view=all`, so the choice survives a reload and is a link the
 * admin can share. Reads `usePathname` rather than hard-coding `/approvals`,
 * because `/comms/approvals` renders the same page.
 */
export function ApprovalsViewToggle({ view }: { view: ApprovalsView }) {
  const router = useRouter();
  const pathname = usePathname();
  return (
    <ToggleGroup<ApprovalsView>
      label="Approvals view"
      value={view}
      onChange={(next) => router.push(next === "all" ? `${pathname}?view=all` : pathname)}
      options={[
        { value: "mine", label: "Mine" },
        { value: "all", label: "All open" },
      ]}
    />
  );
}
