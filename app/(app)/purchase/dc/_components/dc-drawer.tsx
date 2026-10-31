"use client";

import type { ReactNode } from "react";
import { useRouter } from "next/navigation";
import { Sheet } from "@/components/ui/sheet";
import { ToggleGroup } from "@/components/ui/segmented";

/**
 * THE DELIVERY CHALLANS HUB'S ONE DRAWER (user 2026-10-31: "single screen, + New Delivery
 * Challan side-drawer, Receive Back inline"). The URL holds what is open
 * (`?new=process|production|rejection|replacement`, `?edit=<id>&type=…`, `?receive=<id>&type=…`),
 * so a reload or a shared link reopens the same drawer, and the page renders the right form
 * server-side with its data. Closing goes back to the register on the same type tab.
 */
export type NewType = "process" | "production" | "rejection" | "replacement";

export function DcDrawer({
  title,
  type,
  chooser,
  children,
}: {
  title: string;
  /** The register tab to return to. */
  type: string | null;
  /** Show the DC Type selector (a new DC only). */
  chooser?: NewType | null;
  children: ReactNode;
}) {
  const router = useRouter();
  const back = `/purchase/dc${type ? `?type=${type}` : ""}`;
  return (
    <Sheet open onClose={() => router.push(back)} title={title} size="lg">
      <div className="space-y-4 p-4">
        {chooser ? (
          <div className="flex flex-wrap items-center gap-3">
            <span className="text-sm font-medium text-muted-foreground">DC Type</span>
            <ToggleGroup<NewType>
              label="DC type"
              value={chooser}
              onChange={(t) => router.replace(`/purchase/dc?new=${t}&type=${t}`)}
              options={[
                { value: "process", label: "Process DC" },
                { value: "production", label: "Production DC" },
                { value: "rejection", label: "Rejection DC" },
                { value: "replacement", label: "Replacement DC" },
              ]}
            />
          </div>
        ) : null}
        {children}
      </div>
    </Sheet>
  );
}
