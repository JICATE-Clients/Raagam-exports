"use client";

import { useId, useRef, useState, type KeyboardEvent } from "react";
import { Check, ChevronDown, Search, X } from "lucide-react";
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
 * **`multiple`** (user 2026-10-26: "Multi-Select … for all primary filter fields")
 * — `value` is a list. Picking TICKS and the list stays open for the next tick;
 * "Any" clears every tick; the pill reads "RE +1". Enter / Space tick the
 * highlighted row the same way, Escape or Tab close. A required multi pill holds
 * the cursor until at least one is ticked.
 *
 * **A LONG LIST CARRIES A SEARCH BOX** (user 2026-10-27: "add search option for the
 * filters"). Past `SEARCH_FROM` choices the panel opens with a box over the list;
 * typing — in the box, or straight on the trigger while the list is open — narrows
 * the choices by label and second line. "Any" and every ticked choice stay in the
 * list whatever is typed, so a search never hides what is set. ↑ ↓ Enter work from
 * the box exactly as from the trigger; Tab and Escape close and hand focus back.
 * `searchable` forces it on or off for one pill.
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
/**
 * THE RESTING PILL IS A CONTROL, SO IT IS DRAWN AS ONE (user 2026-10-26, screenshot
 * 3729: "the normal state filter look un visible"). The default hairline on a white
 * pill over the #fafbfc filter band was ~1.2:1 — the pill was only findable by its
 * words. #8090a1 is ≥ 3:1 against both grounds (WCAG 1.4.11, a control's edge), the
 * label steps up from muted grey to slate, and a 1px shadow lifts it off the band.
 */
const IDLE = { box: "border-[#8090a1] bg-surface shadow-[0_1px_1px_rgba(16,24,40,0.06)]", text: "text-[#475467]" };

type FilterPillCommon = {
  id?: string;
  label: string;
  options: FilterPillOption[];
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
  /** Search box over the list. Default: on past `SEARCH_FROM` choices. */
  searchable?: boolean;
};

/** A list longer than this opens with a search box — six fit on screen without one. */
const SEARCH_FROM = 6;
export type FilterPillProps =
  | (FilterPillCommon & { multiple?: false; value: string; onChange: (value: string) => void })
  | (FilterPillCommon & { multiple: true; value: string[]; onChange: (value: string[]) => void });

export function FilterPill(props: FilterPillProps) {
  const {
    id,
    label,
    options,
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
  } = props;
  const searchable = props.searchable ?? options.length > SEARCH_FROM;
  const multiple = props.multiple === true;
  /** What is chosen, as a list whichever shape the caller holds. */
  const picked: string[] = props.multiple ? props.value : props.value ? [props.value] : [];
  const clear = () => (props.multiple ? props.onChange([]) : props.onChange(""));
  const autoId = useId();
  const triggerId = id ?? `fp-${autoId}`;
  const listId = `${triggerId}-list`;
  const [open, setOpen] = useState(false);
  const [hi, setHi] = useState(0);
  const [query, setQuery] = useState("");
  const wrapRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const hold = useRequiredHold(required && picked.length === 0, { required, label });

  const isOn = (o: FilterPillOption & { any?: boolean }) => (o.any ? picked.length === 0 : picked.includes(o.value));
  // A choice that would leave nothing is HIDDEN, not greyed (user 2026-10-27, screenshot 3742:
  // "non used category … don't need to show it"). One already picked stays, so it can be unticked;
  // a `zeroPickable` pill keeps every choice because there a 0 still picks.
  const q = searchable ? query.trim().toLowerCase() : "";
  const visible = (zeroPickable ? options : options.filter((o) => o.count !== 0 || picked.includes(o.value))).filter(
    (o) => !q || picked.includes(o.value) || `${o.label} ${o.sublabel ?? ""}`.toLowerCase().includes(q),
  );
  // The list: "Any" first on an optional pill, then the options.
  const items: (FilterPillOption & { any?: boolean })[] = required
    ? visible
    : [{ value: "", label: anyLabel, count: anyCount, any: true }, ...visible];
  const enabled = (i: number) => items[i] && (zeroPickable || !(items[i].count === 0 && !isOn(items[i])));
  const chosen = options.filter((o) => picked.includes(o.value));
  const set = chosen.length > 0;

  /** A tick was made since the list opened — leaving the pill with the mouse then closes it. */
  const tickedRef = useRef(false);
  function openList() {
    if (disabled) return;
    tickedRef.current = false;
    setQuery("");
    const at = Math.max(0, items.findIndex((o) => isOn(o)));
    setHi(enabled(at) ? at : items.findIndex((_, i) => enabled(i)));
    setOpen(true);
  }
  /** `keepOpen` — a mouse tick, or Space: the list stays open for the next one. */
  function pick(i: number, keepOpen = false) {
    if (!enabled(i)) return;
    const o = items[i];
    if (!props.multiple) {
      props.onChange(o.value);
      close();
      advance();
      return;
    }
    // "Any" clears them all.
    if (o.any) props.onChange([]);
    else props.onChange(picked.includes(o.value) ? picked.filter((v) => v !== o.value) : [...picked, o.value]);
    // A MOUSE TICK KEEPS THE LIST OPEN until the pointer leaves the pill (user 2026-10-27,
    // screenshot 3765: "suddenly close after choosing one value — wait until user moving to
    // outside of the filter area"; this replaces 3747's close-on-every-tick). Enter, from
    // the keyboard, where there is no "outside" to move to, still closes and moves on.
    tickedRef.current = true;
    if (!keepOpen) {
      close();
      advance();
    }
  }
  /**
   * AUTO-MOVE TO THE NEXT FILTER (user 2026-10-27: "auto move after choosing only in
   * dropdown"). A choice that closes the list hands the cursor to the next pill in the same
   * row — PO Type → Order Type → Buyer → Item Class → … — so the row is walked without
   * the mouse. Only after a CHOICE: Esc, a click outside and Ctrl/Space ticks stay put.
   * A tick later, because a choice can enable the next pill (Vendor waits for Item Class).
   * The last pill, or one with nothing enabled after it, keeps the cursor on itself.
   */
  function advance() {
    const me = triggerRef.current;
    setTimeout(() => {
      // The row is the nearest ancestor holding more than this pill — a pill may sit in its own wrapper.
      const sel = "button[data-filter-pill]";
      let row = wrapRef.current?.parentElement ?? null;
      while (row && row.querySelectorAll(sel).length < 2) row = row.parentElement;
      const pills = row ? [...row.querySelectorAll<HTMLButtonElement>(sel)] : [];
      const next = pills.slice(pills.indexOf(me as HTMLButtonElement) + 1).find((b) => !b.disabled);
      (next ?? me)?.focus();
    }, 0);
  }
  function step(dir: 1 | -1) {
    for (let i = hi + dir; i >= 0 && i < items.length; i += dir) {
      if (enabled(i)) return setHi(i);
    }
  }
  /** A new query moves the highlight to the first choice it leaves. */
  function search(next: string) {
    setQuery(next);
    const nq = next.trim().toLowerCase();
    const left = (zeroPickable ? options : options.filter((o) => o.count !== 0 || picked.includes(o.value))).filter(
      (o) => !nq || picked.includes(o.value) || `${o.label} ${o.sublabel ?? ""}`.toLowerCase().includes(nq),
    );
    const first = left.findIndex((o) => zeroPickable || o.count !== 0 || picked.includes(o.value));
    setHi(first < 0 ? 0 : first + (required ? 0 : 1));
  }
  function close() {
    setOpen(false);
    setQuery("");
  }
  function onKeyDown(e: KeyboardEvent<HTMLElement>) {
    const inBox = e.currentTarget instanceof HTMLInputElement;
    if (open && searchable && !inBox && !e.ctrlKey && !e.metaKey && !e.altKey) {
      // Typing on the trigger while the list is open is typing into the search.
      if (e.key.length === 1 && (e.key !== " " || query !== "")) {
        e.preventDefault();
        return search(query + e.key);
      }
      if (e.key === "Backspace") {
        e.preventDefault();
        return search(query.slice(0, -1));
      }
    }
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
      close();
      if (inBox) triggerRef.current?.focus();
    } else if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      step(e.key === "ArrowDown" ? 1 : -1);
    } else if (e.key === "Enter" || (e.key === " " && !inBox)) {
      e.preventDefault();
      e.stopPropagation();
      // Enter picks and closes; Space ticks and keeps the list open, as on a checkbox.
      const keep = e.key === " " && multiple;
      // A closing pick moves the cursor on (`advance`), which also covers the search box unmounting.
      pick(hi, keep);
    } else if (e.key === "Tab") {
      if (inBox) {
        // The box is about to unmount; hand the cursor back to the pill it belongs to.
        e.preventDefault();
        e.stopPropagation();
        triggerRef.current?.focus();
      }
      close();
    }
  }

  const shown =
    chosen.length === 0 ? (required ? placeholder : anyLabel) : chosen.length === 1 ? chosen[0].label : `${chosen[0].label} +${chosen.length - 1}`;
  return (
    <div
      ref={wrapRef}
      // min-w-0 + the cap HERE, not on the button (user 2026-10-27, screenshot 3744: picking
      // a Buyer and an Order pushed Budget and Progress onto a second row). A flex item will
      // not shrink below its content without min-w-0, so a set pill's longer value + ✕ grew
      // the row past its width; now the row can squeeze the widest pills, whose value
      // truncates (full text on hover) while the label beside it stays whole.
      className="relative inline-flex max-w-[11rem] min-w-0"
      onBlur={(e) => {
        if (!wrapRef.current?.contains(e.relatedTarget as Node | null)) close();
      }}
      // The panel is inside this wrapper, so leaving it means leaving the pill AND its list.
      // Only after a tick — opening a list and drifting off it is not a choice.
      onMouseLeave={() => {
        if (open && tickedRef.current) {
          close();
          advance();
        }
      }}
    >
      <button
        ref={triggerRef}
        id={triggerId}
        type="button"
        role="combobox"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={listId}
        aria-activedescendant={open ? `${listId}-${hi}` : undefined}
        aria-label={`${label}: ${chosen.length > 1 ? chosen.map((o) => o.label).join(", ") : shown}`}
        data-field-trigger
        data-filter-pill
        data-field-empty={set ? "false" : "true"}
        {...hold}
        disabled={disabled}
        onClick={() => (open ? close() : openList())}
        onKeyDown={onKeyDown}
        className={cn(
          // 32px, the dense-bar height (One button shape): a whole filter set fits ONE row (user 2026-10-26).
          // 12px and 8px sides (screenshot 3719): ten pills on one row, Progress no longer wrapping alone.
          // 11rem, not 13 (screenshot 3730): with Orders added, Progress wrapped alone again. Only a long
          // Item Class / Vendor ever reaches the cap, and its full name still shows on hover (Truncated).
          "inline-flex h-8 max-w-full min-w-0 items-center gap-1 rounded-control border bg-surface pl-2 text-xs whitespace-nowrap transition-colors",
          "hover:border-[#037bb8] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50",
          set && !required ? "pr-6" : "pr-1.5",
          required && !set && NEEDED.box,
          !required && set && (tone === "danger" ? SET_RED.box : SET_BLUE.box),
          // A required pill once chosen rests like any other — set, but nothing more to do.
          ((!required && !set) || (required && set)) && IDLE.box,
        )}
      >
        <span className={cn("shrink-0", IDLE.text, !required && set && (tone === "danger" ? SET_RED.text : SET_BLUE.text))}>
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
        {set && !required ? null : <ChevronDown aria-hidden className={cn("size-3 shrink-0", IDLE.text)} />}
      </button>
      {set && !required ? (
        <button
          type="button"
          tabIndex={-1}
          aria-label={`Clear ${label}`}
          onClick={clear}
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
          aria-multiselectable={multiple || undefined}
          className={cn(
            "absolute top-[calc(100%+6px)] left-0 z-30 max-h-80 overflow-auto rounded-lg border bg-surface p-1.5 shadow-lg",
            wide ? "w-80" : "w-60",
          )}
        >
          <div className="px-2 pt-1 pb-1.5 text-[11px] font-bold tracking-wide text-muted-foreground uppercase">{label}</div>
          {note ? <div className="px-2 pb-2 text-xs text-muted-foreground">{note}</div> : null}
          {searchable ? (
            <div className="sticky -top-1.5 z-10 -mx-1.5 mb-1 border-b bg-surface px-1.5 pt-0.5 pb-1.5">
              <div className="flex h-8 items-center gap-1.5 rounded-control border border-[#8090a1] px-2 focus-within:ring-2 focus-within:ring-ring">
                <Search aria-hidden className="size-3.5 shrink-0 text-muted-foreground" />
                {/* caps-input: exempt -- a search query is not a stored value */}
                <input
                  type="search"
                  value={query}
                  onChange={(e) => search(e.target.value)}
                  onKeyDown={onKeyDown}
                  placeholder={`Search ${label.toLowerCase()}`}
                  aria-label={`Search ${label}`}
                  aria-controls={listId}
                  autoComplete="off"
                  data-1p-ignore
                  data-lpignore="true"
                  data-form-type="other"
                  className="h-full min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground"
                />
              </div>
            </div>
          ) : null}
          {searchable && q && visible.length === 0 ? (
            <div className="px-2 py-2 text-sm text-muted-foreground">Nothing matches “{query.trim()}”</div>
          ) : null}
          {items.length === 0 && !q ? <div className="px-2 py-2 text-sm text-muted-foreground">{emptyText}</div> : null}
          {items.map((o, i) => {
            const on = isOn(o);
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
                  pick(i, multiple);
                }}
                onMouseEnter={() => !off && setHi(i)}
                className={cn(
                  "grid cursor-pointer grid-cols-[14px_minmax(0,1fr)] items-center gap-2 rounded-md px-2 py-1.5 text-sm",
                  i === hi && !off && "bg-surface-muted",
                  off && "cursor-default text-muted-foreground/60",
                )}
              >
                {multiple ? (
                  // A tick box, not a radio dot: several can be on at once.
                  <span
                    aria-hidden
                    className={cn(
                      "grid size-3.5 place-items-center rounded-[3px] border-[1.5px] border-muted-foreground",
                      on && "border-[#037bb8] bg-[#037bb8] text-white",
                      off && "opacity-50",
                    )}
                  >
                    {on ? <Check className="size-2.5" strokeWidth={3.5} /> : null}
                  </span>
                ) : (
                  <span
                    aria-hidden
                    className={cn("size-3.5 rounded-full border-[1.5px] border-muted-foreground", on && "border-4 border-[#037bb8]", off && "opacity-50")}
                  />
                )}
                <span className="flex min-w-0 flex-col">
                  {/* touch={false}: an option commits on mousedown, so a long-press would reveal AND pick. */}
                  <Truncated touch={false}>{o.label}</Truncated>
                  {o.sublabel ? (
                    <Truncated touch={false} className="text-xs text-muted-foreground">
                      {o.sublabel}
                    </Truncated>
                  ) : null}
                </span>
                {/* NO NUMBER BESIDE AN OPTION (user 2026-10-27, screenshot 3740: "no need number
                    behind the filter … for all filters"). `count` still decides which choices are
                    greyed (0 = would empty the list); it is just no longer printed. */}
              </div>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}
