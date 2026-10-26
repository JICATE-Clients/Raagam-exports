"use client";

import { useId, useRef, useState, type KeyboardEvent } from "react";
import { ChevronDown, X } from "lucide-react";
import { useRequiredHold } from "@/components/ui/field";
import { Truncated } from "@/components/ui/truncated";
import { cn } from "@/lib/utils";

/**
 * A FILTER AS "LABEL: VALUE ▾" (user 2026-10-26, PO from Requirement: "this is
 * right like that"). One row of these replaces a band of chip groups that could
 * not line up — a group of two choices and a group of six are the same width here.
 *
 * Every option says how many rows it would leave, and one that would leave none
 * is disabled, so a filter can never walk the operator into an empty list. The
 * caller computes the counts (it knows the other filters); this draws them.
 *
 * Two shapes from one prop:
 * - **optional** — an "Any" choice heads the list, and a set pill turns blue with
 *   a ✕ that clears it;
 * - **`required`** — no Any, no ✕, a red star, amber until chosen, and the
 *   app's mandatory hold (`useRequiredHold`): the PO cannot be made without it.
 *
 * THE KEYBOARD CONTRACT, which a hand-rolled control inherits none of: the
 * trigger is a `<button data-field-trigger>`, so `isFieldLike` counts it as a
 * field — Tab lands on it, Enter moves on from it, ↓ opens it. Focus never
 * leaves the trigger: while open, `aria-expanded` tells `keyFills` the list owns
 * ↑ ↓ and Enter, and Escape is consumed (preventDefault) so the page handler does
 * not navigate away behind it. The ✕ is `tabIndex={-1}`, off the Tab path like
 * every other ✕ (AGENTS.md, Tab lands on fields).
 *
 * Not a modal: the list is an absolutely placed panel, it registers nothing with
 * `lib/reload-guard.ts`, and a click anywhere outside closes it.
 */
export type FilterPillOption = {
  value: string;
  label: string;
  /** A second line in the list — a vendor's lead days and on-time %. */
  sublabel?: string;
  /** Rows this choice would leave. Omitted = not counted. 0 = disabled. */
  count?: number;
  /** "danger" draws the count red — Late. */
  tone?: "danger";
};

/**
 * THE SET / NEEDED COLOURS ARE FIXED VALUES, NOT THE `primary` / `warning` TOKENS
 * (user 2026-10-26, screenshot 3717: a set pill read as blue text on a solid teal
 * block). A `[data-skin]` repaints `bg-primary*` as its own solid fill — the same
 * repaint `button.tsx` records for the primary button — so a "soft" primary ground
 * came out dark under text that stayed `text-primary`. These pairs are the app's
 * link blue / danger / amber on their own pale grounds, ≥ 4.5:1 each, and nothing
 * re-points them.
 */
const SET_BLUE = { box: "border-[#037bb8] bg-[#e8f3fb]", text: "text-[#035c8c]" };
const SET_RED = { box: "border-[#d92d20] bg-[#fdecea]", text: "text-[#b42318]" };
const NEEDED = { box: "border-[#d9a400] bg-[#fff7e0]", text: "text-[#8a5800]" };

export function FilterPill({
  id,
  label,
  options,
  value,
  onChange,
  required = false,
  anyLabel = "Any",
  anyCount,
  placeholder = "Choose",
  note,
  emptyText = "Nothing to choose",
  disabled = false,
  tone,
  wide = false,
  zeroPickable = false,
}: {
  id?: string;
  label: string;
  options: FilterPillOption[];
  value: string;
  onChange: (value: string) => void;
  required?: boolean;
  anyLabel?: string;
  /** The count beside "Any" — every row the other filters leave. */
  anyCount?: number;
  placeholder?: string;
  /** One line under the list's title — how the choices are worked out. */
  note?: string;
  emptyText?: string;
  disabled?: boolean;
  /** "danger" paints the SET pill red instead of blue (Order by: Late). */
  tone?: "danger";
  wide?: boolean;
  /** A 0 count still picks — the count is information, not a gate (Raise PO's Item Class, 2026-10-26). */
  zeroPickable?: boolean;
}) {
  const autoId = useId();
  const triggerId = id ?? `fp-${autoId}`;
  const listId = `${triggerId}-list`;
  const [open, setOpen] = useState(false);
  const [hi, setHi] = useState(0);
  const wrapRef = useRef<HTMLDivElement>(null);
  const hold = useRequiredHold(required && !value, { required, label });

  // The list: "Any" first on an optional pill, then the options.
  const items: (FilterPillOption & { any?: boolean })[] = required
    ? options
    : [{ value: "", label: anyLabel, count: anyCount, any: true }, ...options];
  const enabled = (i: number) => items[i] && (zeroPickable || !(items[i].count === 0 && items[i].value !== value));
  const current = options.find((o) => o.value === value);
  const set = !!current;

  function openList() {
    if (disabled) return;
    const at = Math.max(0, items.findIndex((o) => o.value === value));
    setHi(enabled(at) ? at : items.findIndex((_, i) => enabled(i)));
    setOpen(true);
  }
  function pick(i: number) {
    if (!enabled(i)) return;
    onChange(items[i].value);
    setOpen(false);
  }
  function step(dir: 1 | -1) {
    for (let i = hi + dir; i >= 0 && i < items.length; i += dir) {
      if (enabled(i)) return setHi(i);
    }
  }
  function onKeyDown(e: KeyboardEvent<HTMLButtonElement>) {
    if (!open) {
      if (e.key === "ArrowDown") {
        e.preventDefault();
        openList();
      }
      return; // Enter, Tab and the rest belong to the keyboard contract
    }
    if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      setOpen(false);
    } else if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      step(e.key === "ArrowDown" ? 1 : -1);
    } else if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      e.stopPropagation();
      pick(hi);
    } else if (e.key === "Tab") {
      setOpen(false);
    }
  }

  const shown = current?.label ?? (required ? placeholder : anyLabel);
  return (
    <div
      ref={wrapRef}
      className="relative inline-flex"
      onBlur={(e) => {
        if (!wrapRef.current?.contains(e.relatedTarget as Node | null)) setOpen(false);
      }}
    >
      <button
        id={triggerId}
        type="button"
        role="combobox"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={listId}
        aria-activedescendant={open ? `${listId}-${hi}` : undefined}
        aria-label={`${label}: ${shown}`}
        data-field-trigger
        data-field-empty={value ? "false" : "true"}
        {...hold}
        disabled={disabled}
        onClick={() => (open ? setOpen(false) : openList())}
        onKeyDown={onKeyDown}
        className={cn(
          // 32px, the dense-bar height (One button shape): a whole filter set fits ONE row (user 2026-10-26).
          // 12px and 8px sides (screenshot 3719): ten pills on one row, Progress no longer wrapping alone.
          "inline-flex h-8 max-w-[13rem] items-center gap-1 rounded-control border bg-surface pl-2 text-xs whitespace-nowrap transition-colors",
          "hover:border-[#037bb8] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50",
          set && !required ? "pr-6" : "pr-1.5",
          required && !set && NEEDED.box,
          !required && set && (tone === "danger" ? SET_RED.box : SET_BLUE.box),
        )}
      >
        <span className={cn("text-muted-foreground", !required && set && (tone === "danger" ? SET_RED.text : SET_BLUE.text))}>
          {label}
          {required ? <span aria-hidden className="text-danger">*</span> : null}
        </span>
        <Truncated
          touch={false}
          className={cn(
            "min-w-0 font-semibold",
            required && !set && NEEDED.text,
            !required && set && (tone === "danger" ? SET_RED.text : SET_BLUE.text),
          )}
        >
          {shown}
        </Truncated>
        {set && !required ? null : <ChevronDown aria-hidden className="size-3 shrink-0 text-muted-foreground" />}
      </button>
      {set && !required ? (
        <button
          type="button"
          tabIndex={-1}
          aria-label={`Clear ${label}`}
          onClick={() => onChange("")}
          className={cn(
            "absolute top-1/2 right-1 grid size-4.5 -translate-y-1/2 place-items-center rounded hover:bg-surface",
            tone === "danger" ? SET_RED.text : SET_BLUE.text,
          )}
        >
          <X aria-hidden className="size-3.5" />
        </button>
      ) : null}
      {open ? (
        <div
          id={listId}
          role="listbox"
          aria-label={label}
          className={cn(
            "absolute top-[calc(100%+6px)] left-0 z-30 max-h-80 overflow-auto rounded-lg border bg-surface p-1.5 shadow-lg",
            wide ? "w-80" : "w-60",
          )}
        >
          <div className="px-2 pt-1 pb-1.5 text-[11px] font-bold tracking-wide text-muted-foreground uppercase">{label}</div>
          {note ? <div className="px-2 pb-2 text-xs text-muted-foreground">{note}</div> : null}
          {items.length === 0 ? <div className="px-2 py-2 text-sm text-muted-foreground">{emptyText}</div> : null}
          {items.map((o, i) => {
            const on = o.value === value;
            const off = !enabled(i);
            return (
              <div
                key={o.value || "__any__"}
                id={`${listId}-${i}`}
                role="option"
                aria-selected={on}
                aria-disabled={off || undefined}
                // mousedown, not click: the trigger keeps focus, so the panel does not blur shut first.
                onMouseDown={(e) => {
                  e.preventDefault();
                  pick(i);
                }}
                onMouseEnter={() => !off && setHi(i)}
                className={cn(
                  "grid cursor-pointer grid-cols-[14px_minmax(0,1fr)_auto] items-center gap-2 rounded-md px-2 py-1.5 text-sm",
                  i === hi && !off && "bg-surface-muted",
                  off && "cursor-default text-muted-foreground/60",
                )}
              >
                <span
                  aria-hidden
                  className={cn("size-3.5 rounded-full border-[1.5px] border-muted-foreground", on && "border-4 border-[#037bb8]", off && "opacity-50")}
                />
                <span className="flex min-w-0 flex-col">
                  {/* touch={false}: an option commits on mousedown, so a long-press would reveal AND pick. */}
                  <Truncated touch={false}>{o.label}</Truncated>
                  {o.sublabel ? (
                    <Truncated touch={false} className="text-xs text-muted-foreground">
                      {o.sublabel}
                    </Truncated>
                  ) : null}
                </span>
                {o.count != null ? (
                  <span className={cn("text-xs font-semibold tabular-nums text-muted-foreground", o.tone === "danger" && !off && "text-danger")}>
                    {o.count}
                  </span>
                ) : null}
              </div>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}
