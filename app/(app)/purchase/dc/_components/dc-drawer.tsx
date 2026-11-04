"use client";

import type { ReactNode } from "react";
import { useRouter } from "next/navigation";
import { ToggleGroup } from "@/components/ui/segmented";
import { RecordTabTitle } from "@/components/shell/record-tab-title";

/**
 * THE DELIVERY CHALLANS HUB'S ONE FORM PANEL. The URL holds what is open
 * (`?new=process|production|rejection|replacement`, `?edit=<id>&type=…`, `?receive=<id>&type=…`),
 * so a reload or a shared link reopens the same form, and the page renders it server-side
 * with its data.
 *
 * IN THE PAGE, NOT A DRAWER OVER IT (user 2026-11-02, screenshot 3965: "use this full screen
 * like Raise PO — why this open-centre type of screen"). It was a full-screen `Sheet`, which
 * hid the sidebar and floated the form in the middle of an overlay. Now the page shows this
 * INSTEAD of the register, exactly as Raise PO swaps its list for the editor; the form's own
 * Cancel / Dispatch go back to the register on the same type tab. The name is kept so the
 * page's call sites read as before.
 */
export type NewType = "process" | "production" | "general" | "department" | "rejection" | "replacement";

export function DcDrawer({
  title,
  type,
  chooser,
  showBack = false,
  entry,
  children,
}: {
  title: string;
  /** The register tab to return to. */
  type: string | null;
  /** Show the DC Type selector (a new DC only). */
  chooser?: NewType | null;
  /** Only where the content has no Cancel of its own (the Rejection / Replacement notes). */
  showBack?: boolean;
  /** The open DC's number — names the workspace tab "DC-0009 · Delivery Challan" while it is
   *  open (screenshot 4002). Omit on a new DC: there is no number yet. */
  entry?: string | null;
  children: ReactNode;
}) {
  const router = useRouter();
  const back = `/purchase/dc${type ? `?type=${type}` : ""}`;
  return (
    // `data-dc-editor`: page.tsx hides the page's floating "← Back" while a form is open.
    <div data-dc-editor className="space-y-3">
      <RecordTabTitle entry={entry} inPage />
      <div className="flex flex-wrap items-center gap-3">
        {chooser ? (
          <>
            <span className="text-sm font-medium text-muted-foreground">DC Type</span>
            <ToggleGroup<NewType>
              label="DC type"
              value={chooser}
              onChange={(t) => router.replace(`/purchase/dc?new=${t}&type=${t}`)}
              options={[
                { value: "process", label: "Job Work DC" },
                { value: "production", label: "Inter-Unit DC" },
                { value: "general", label: "General DC" },
                { value: "department", label: "Department Delivery" },
                { value: "rejection", label: "Rejection DC" },
                { value: "replacement", label: "Replacement DC" },
              ]}
            />
          </>
        ) : (
          <h2 className="text-base font-bold">{title}</h2>
        )}
        {/* The way back to the list when a form has no Cancel of its own (the Rejection /
            Replacement notes). A text link, not a button (AGENTS, "one job, one button"). */}
        {showBack ? (
          <button type="button" onClick={() => router.push(back)} className="ml-auto text-sm text-muted-foreground hover:text-foreground hover:underline">
            ← Delivery Challans
          </button>
        ) : null}
      </div>
      {children}
    </div>
  );
}
