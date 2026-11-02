"use client";

import type { ReactNode } from "react";
import { Check } from "lucide-react";
import { Truncated } from "@/components/ui/truncated";
import { cn } from "@/lib/utils";

/**
 * THE PURCHASE DOCUMENT SURFACE — Raise PO's look, shared (user 2026-11-02: "check raise
 * po then plan this page ui"). Raise PO built it first (one frame, a title row of chips,
 * a tinted pill row, an order rail beside a frameless grid, a sticky bottom bar); the GRN
 * entry now wears the same pieces. They live here so the two screens read them from ONE
 * place rather than each keeping its own copy of the hairline colours.
 */

/** ONE FRAME — no card inside a card; sections are parted by hairlines (`DOC_RULE`). */
export const DOC_FRAME = "rounded-xl border border-[#dde4eb] bg-white";
export const DOC_RULE = "border-t border-[#dde4eb]";
/** A fact chip in the title row — a number, a date, the unit. */
export const DOC_CHIP = "rounded-md border border-[#dde4eb] px-2 py-0.5 text-xs tabular-nums text-muted-foreground";
/** The tinted pill row under the title. */
export const DOC_PILL_ROW = "flex flex-wrap items-center gap-x-1 gap-y-2 border-t border-[#dde4eb] bg-[#fafbfc] px-4 py-2.5";

/**
 * THE GRID HEADER IN THE ORDERS TABLE BAND (user 2026-10-23, screenshot 3697): the soft
 * blue `--table-head-bg` every `DataTable` header wears, labels on ONE line.
 */
export const GRID_HEAD = "whitespace-nowrap bg-[var(--table-head-bg)]";
/**
 * DENSE, ONE SIZE WITH THE RAIL (user 2026-10-30): 12px cells, 11px headers — one wrapper
 * on the grid pane rather than a size on every cell. These screens only.
 */
export const DENSE = "[&_td]:text-xs [&_.text-sm]:text-xs [&_th]:text-[11px]";

/** The bottom bar's "why it waits" chip, by state. */
export const HINT_CHIP_TONES = {
  todo: { box: "border-[#f1d48a] bg-[#fff7e0] text-[#8a5800]", dot: "bg-[#d9a400]" },
  md: { box: "border-[#f5b8b0] bg-[#fdecea] text-[#b42318]", dot: "bg-[#d92d20]" },
  ready: { box: "border-[#a6dcb9] bg-[#e8f6ee] text-[#14803f]", dot: "bg-[#14803f]" },
} as const;
export type HintKind = keyof typeof HINT_CHIP_TONES;

/**
 * THE BOTTOM BAR, ON THE BOTTOM EDGE (user 2026-10-24, screenshot 3713). `<main>` has
 * `md:pb-6`, so `md:-bottom-6` cancels exactly that padding; the phone keeps `bottom-0`,
 * where the padding is the tab bar's room.
 */
export const DOC_BOTTOM_BAR =
  "sticky bottom-0 z-10 flex flex-wrap items-center gap-x-4 gap-y-2 rounded-b-xl border-t border-[#dde4eb] bg-[#fafbfc] px-4 py-2.5 md:-bottom-6";

/** A rail's band heading ("On this GRN", "More POs"). */
export function RailSectionLabel({ children }: { children: ReactNode }) {
  return (
    <div className="flex h-6 items-center border-b border-[#dde4eb] bg-[#f5f7f9] px-2.5 text-[10.5px] font-semibold tracking-wide text-muted-foreground uppercase">
      {children}
    </div>
  );
}

/**
 * ONE RAIL ROW — a tick and a name, two buttons: the tick toggles, the name opens a ticked
 * row on the right (and ticks an unticked one). Both are buttons, so Tab — fields only —
 * passes over (lib/focus.ts). Raise PO's order row, generalised.
 */
export function RailTickRow({
  on,
  active,
  label,
  title,
  badge,
  onTick,
  onOpen,
}: {
  on: boolean;
  active: boolean;
  label: string;
  title?: string;
  badge?: ReactNode;
  onTick: () => void;
  onOpen: () => void;
}) {
  return (
    <div
      className={cn(
        "grid h-7 grid-cols-[1.75rem_minmax(0,1fr)] items-center border-b border-[#e8edf2]",
        on && "bg-white shadow-[inset_3px_0_0_#037bb8]",
        on && active && "bg-[#eef6fc]",
      )}
    >
      <button
        type="button"
        role="checkbox"
        aria-checked={on}
        aria-label={`${on ? "Untick" : "Tick"} ${label}`}
        onClick={onTick}
        className="grid h-full place-items-center focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
      >
        <span
          aria-hidden
          className={cn(
            "grid size-4 place-items-center rounded border-[1.5px] border-muted-foreground text-white",
            on && "border-[#037bb8] bg-[#037bb8]",
          )}
        >
          {on ? <Check className="size-3" strokeWidth={3} /> : null}
        </span>
      </button>
      <button
        type="button"
        aria-current={on && active ? true : undefined}
        title={title}
        onClick={onOpen}
        className="mr-1 flex h-full min-w-0 items-center gap-1.5 rounded px-1.5 text-left focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-[#037bb8]"
      >
        <Truncated className="min-w-0 font-mono text-xs font-semibold tabular-nums">{label}</Truncated>
        <span className="flex-1" />
        {badge}
      </button>
    </div>
  );
}

