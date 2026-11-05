"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { ToggleGroup } from "@/components/ui/segmented";
import { PERIOD_OPTIONS, type PeriodKey } from "@/lib/analytics/period";

/** Set one search param and keep the rest — a board's period, view and buyer travel together. */
function useParam() {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  return (key: string, value: string | null) => {
    const q = new URLSearchParams(params.toString());
    if (value == null) q.delete(key);
    else q.set(key, value);
    const s = q.toString();
    router.push(s ? `${pathname}?${s}` : pathname);
  };
}

/** This FY · Last FY · All time — one word in the URL (`?p=`), so a board can be linked. */
export function PeriodSwitch({ value }: { value: PeriodKey }) {
  const set = useParam();
  return <ToggleGroup label="Period" value={value} options={PERIOD_OPTIONS} onChange={(next) => set("p", next === "fy" ? null : next)} />;
}

export type BoardView = "picture" | "list";

/** Picture · List — the board, or its full table (Store Overview's Stock / All lots split). */
export function ViewSwitch({ value }: { value: BoardView }) {
  const set = useParam();
  return (
    <ToggleGroup
      label="View"
      role="tablist"
      value={value}
      options={[
        { value: "picture", label: "Picture" },
        { value: "list", label: "List" },
      ]}
      onChange={(next) => set("view", next === "picture" ? null : next)}
    />
  );
}
